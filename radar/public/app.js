/* ============================================================
   PARTY RADAR — frontend app (vanilla JS, zero deps)
   ============================================================ */
'use strict';

const API = {
  state: () => fetch('/api/state').then(r => r.json()),
  venue: (id) => fetch('/api/venue/' + id).then(r => r.json()),
  area: (id) => fetch('/api/area/' + id).then(r => r.json()),
  checkin: (venueId, coords) => post('/api/checkin', { venueId, coords }),
  report: (payload) => post('/api/report', payload),
  pulse: (venueId, state) => post('/api/pulse', { venueId, state }),
  hoursFlag: (venueId) => post('/api/hours-flag', { venueId }),
  me: () => fetch('/api/me').then(r => r.json()),
  deleteMedia: (id) => post('/api/media/delete', { id }),
  deleteReport: (id) => post('/api/report/delete', { id }),
  deleteAccount: (token, email, name) => post('/api/auth/delete', { token, email, name }),
  chat: (messages, userLoc) => {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 30000); // allow for the server's one retry
    return fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages, userLoc }), signal: ac.signal })
      .then((r) => r.json()).finally(() => clearTimeout(t));
  },
};
function post(url, body) {
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
}

// In the demo we simulate the user standing at the venue so proximity checks
// pass; flip to real GPS for production. (The proximity/anti-abuse logic on the
// server is real either way.)
const USE_REAL_GPS = false;
function locationFor(venue) {
  if (USE_REAL_GPS && navigator.geolocation) {
    return new Promise((res) => navigator.geolocation.getCurrentPosition(
      (p) => res({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => res(null), { timeout: 4000 }
    ));
  }
  return Promise.resolve(venue ? venue.coords : null);
}

// ---------- shared state ----------
const S = { data: null, tab: 'near', activeVenue: null, radarOn: false, filter: 'all', query: '', sheetOpen: false, reportPick: false, userLoc: null, locLabel: null, booted: false };

function haversineKm(a, b) {
  const R = 6371, toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng), la1 = toRad(a.lat), la2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
// distance units (km/mi) — user-selectable in Settings, applied everywhere
function currentUnits() { try { return localStorage.getItem('clubbit_units') === 'mi' ? 'mi' : 'km'; } catch { return 'km'; } }
function setUnits(u) { try { localStorage.setItem('clubbit_units', u === 'mi' ? 'mi' : 'km'); } catch {} }
function distLabel(km) {
  if (currentUnits() === 'mi') {
    const mi = km * 0.621371;
    return mi < 0.1 ? Math.round(mi * 5280) + ' ft' : mi < 10 ? mi.toFixed(1) + ' mi' : Math.round(mi) + ' mi';
  }
  return km < 1 ? Math.round(km * 1000) + ' m' : km < 10 ? km.toFixed(1) + ' km' : Math.round(km) + ' km';
}
// "Events near you" radius. Round step values PER UNIT (so miles are 5,10,20…,
// not the direct 6,12,19… conversion). The radius is stored in km for filtering.
const EV_STEPS_KM = [10, 20, 30, 50, 75, 100, 150, 250, 500, 'all'];
const EV_STEPS_MI = [5, 10, 20, 30, 50, 75, 100, 150, 300, 'all'];
function evSteps() { return currentUnits() === 'mi' ? EV_STEPS_MI : EV_STEPS_KM; }
function stepToKm(step) { return step === 'all' ? 'all' : (currentUnits() === 'mi' ? Math.round(step * 1.60934) : step); }
// closest round step (in the current unit) to a stored km value
function kmToStep(km) {
  if (km === 'all') return 'all';
  const inUnit = currentUnits() === 'mi' ? km * 0.621371 : km;
  const steps = evSteps().filter((s) => s !== 'all');
  return steps.reduce((best, s) => Math.abs(s - inUnit) < Math.abs(best - inUnit) ? s : best, steps[0]);
}
function eventRadiusKm() { try { const v = localStorage.getItem('clubbit_ev_radius'); if (v === 'all') return 'all'; const n = +v; return Number.isFinite(n) && n > 0 ? n : 50; } catch { return 50; } }
function setEventRadius(v) { try { localStorage.setItem('clubbit_ev_radius', v === 'all' ? 'all' : String(v)); } catch {} }
function evRadiusLabel() {
  const km = eventRadiusKm();
  if (km === 'all') return 'All events';
  return kmToStep(km) + (currentUnits() === 'mi' ? ' mi' : ' km');
}
function cityOf(v) { const a = (S.data.areas || []).find((x) => x.id === v.neighborhood); return (a && a.city) || v.neighborhoodName; }

// ---------- band / label helpers ----------
function bandKey(score) {
  if (score >= 84) return 'red'; if (score >= 70) return 'pop'; if (score >= 56) return 'busy';
  if (score >= 42) return 'heat'; if (score >= 26) return 'chill'; return 'quiet';
}
// Map pins are coloured by how FULL the venue is right now (live crowd), not the
// blended radar score — closed venues read grey. Falls back to the score if a
// snapshot somehow lacks a fullness figure.
function fullnessBand(v) {
  if (v.open === false) return 'quiet';
  const f = (v.fullness && typeof v.fullness.est === 'number') ? v.fullness.est : v.radar.score;
  return bandKey(f);
}
// clean, Google-Maps-style semantic palette (quiet→heating→busy→popping→red hot)
const BAND_COLOR = {
  red: { core: '#ea4335', glow: '234,67,53' }, pop: { core: '#fb8c00', glow: '251,140,0' },
  busy: { core: '#f9ab00', glow: '249,171,4' }, heat: { core: '#1a73e8', glow: '26,115,232' },
  chill: { core: '#9aa0a6', glow: '154,160,166' }, quiet: { core: '#9aa0a6', glow: '154,160,166' },
};
function momClass(state) {
  return { exploding: 'c-red', surging: 'c-red', heating: 'c-up', steady: 'c-steady', cooling: 'c-down' }[state] || 'c-steady';
}
function momLabel(m) { const s = String(m.label || '').toLowerCase(); return s.charAt(0).toUpperCase() + s.slice(1); }
const VIBE_EMOJI = { dead: '😴', chill: '🙂', popping: '🔥', packed: '🤯' };

// category glyphs shown inside a pin when the venue has no community photo yet
const PIN_ICONS = {
  cocktail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16l-8 8z"/><path d="M12 13v6"/><path d="M8 21h8"/></svg>',
  music: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 17V5l10-2v12"/><circle cx="6.5" cy="17" r="2.5"/><circle cx="16.5" cy="15" r="2.5"/></svg>',
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0 0 12 0"/><path d="M12 17v3"/></svg>',
  wine: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3h8l-1 5a3 3 0 0 1-6 0z"/><path d="M12 14v6"/><path d="M8.5 20h7"/></svg>',
  rooftop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21V9l5-3v15"/><path d="M9 21V11l7-3v13"/><path d="M3 21h18"/></svg>',
  beer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9h9v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z"/><path d="M15 11h2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-2"/><path d="M9 9V6M12 9V6"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>',
};
function venueIcon(v) {
  const c = v.category, k = v.kind;
  if (k === 'Club' || c === 'Dancing') return PIN_ICONS.music;      // clubs / dancing
  if (k === 'Rooftop' || c === 'Rooftops') return PIN_ICONS.rooftop; // rooftops
  if (k === 'Venue' || c === 'Live') return PIN_ICONS.mic;           // live music
  if (k === 'Wine Bar' || c === 'Wine') return PIN_ICONS.wine;       // wine bars
  if (c === 'Cocktails') return PIN_ICONS.cocktail;                  // cocktail bars
  if (c === 'Late Night') return PIN_ICONS.moon;                     // late-night spots
  return PIN_ICONS.beer;                                             // plain bars
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function ago(min) { if (min < 1) return 'now'; if (min < 60) return Math.round(min) + 'm'; return Math.round(min / 60) + 'h'; }
function queueText(q) { return { none: 'No queue', '<10': '<10 min', '10-20': '10–20 min', '20-30': '20–30 min', '30+': '30+ min', guestlist: 'Guest list', unknown: 'Queue ?' }[q] || q; }
// Prefer the server's already-localized label (e.g. "£15", "50 zł"); fall back
// to a EUR string for older payloads.
function entryText(v) {
  if (v && typeof v === 'object') {
    if (v.entryLabel) return v.entryLabel;
    v = v.entry;
  }
  return (v == null) ? '—' : (v === 0 ? 'Free' : '€' + v);
}
// client-side money formatter mirroring lib/money.js, using the currency
// descriptor the server sends with each venue
function fmtCur(eur, cur) {
  if (eur == null) return '—';
  if (eur === 0) return 'Free';
  if (!cur || !cur.rate) return '€' + eur;
  const amt = Math.max(cur.step, Math.round(eur * cur.rate / cur.step) * cur.step);
  const PRE = { EUR: '€', USD: '$', GBP: '£' };
  const sym = PRE[cur.code];
  return sym ? sym + amt : amt + ' ' + cur.code;
}

// ---------- tiny DOM utils ----------
const $ = (s) => document.querySelector(s);
function toast(msg, ms = 2200) {
  const t = $('#toast'); t.innerHTML = msg; t.hidden = false;
  clearTimeout(t._t); t._t = setTimeout(() => { t.hidden = true; }, ms);
}

/* ============================================================
   CANVAS RADAR MAP
   ============================================================ */
class RadarMap {
  constructor() {
    this.venues = []; this.areas = []; this.bounds = null;
    this.selected = null; this.t0 = performance.now();
    this._markers = []; this._labelMarkers = []; this._ready = false; this.map = null;
    this.c = document.getElementById('radarCanvas');
    this.ctx = this.c.getContext('2d');
    if (typeof maplibregl !== 'undefined') {
      try { this._initMap(); } catch (e) { console.warn('map init failed', e); this.map = null; }
    }
    if (!this.map) this._initFallback();
    this._resize();
    window.addEventListener('resize', () => this._resize());
    if (window.ResizeObserver) { this._ro = new ResizeObserver(() => this._resize()); this._ro.observe(this.c.parentElement); }
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
    // safety: never let the loading skeleton stick around forever
    setTimeout(() => { const sk = document.getElementById('mapSkeleton'); if (sk && !sk.classList.contains('gone')) { sk.classList.add('gone'); setTimeout(() => { try { sk.remove(); } catch (e) {} }, 550); } }, 10000);
  }
  _initMap() {
    // keyless OpenFreeMap vector basemap that follows the app theme: "dark" in dark
    // mode, light "positron" in light mode — MapLibre GL renders it.
    // Open straight on the user's LAST known spot (read synchronously from
    // localStorage) so the map renders there immediately — no Athens-then-fly wait.
    let _c0 = [23.727, 37.978], _z0 = 13;
    try {
      const s = (typeof loadLoc === 'function') ? loadLoc() : null;
      if (s && !s.skip && typeof s.lat === 'number' && typeof s.lng === 'number') { _c0 = [s.lng, s.lat]; _z0 = 11; }
    } catch (e) {}
    this.map = new maplibregl.Map({
      container: 'map',
      style: mapStyleFor(currentTheme()),
      center: _c0, zoom: _z0, minZoom: 1, maxZoom: 18,
      attributionControl: false, dragRotate: false, pitchWithRotate: false,
      renderWorldCopies: true,
    });
    this.map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
    if (this.map.touchZoomRotate) this.map.touchZoomRotate.disableRotation();
    // render as a 3D globe when zoomed out (MapLibre v5+); falls back silently
    const enableGlobe = () => { try { if (this.map && this.map.setProjection) this.map.setProjection({ type: 'globe' }); } catch (e) {} };
    this.map.on('style.load', enableGlobe);
    const ready = () => { if (this._ready) return; this._ready = true; enableGlobe(); this._buildMarkers(); this._initialCamera(); this._maybeHideSkeleton(); };
    this.map.on('load', ready);
    this.map.on('idle', ready); // fires after first real render (self-heals a 0-size start)
    this.map.on('error', (e) => console.warn('map error', e && e.error && e.error.message));
    this.map.on('click', (e) => this._tap(e.point.x, e.point.y));
    // If the user pans/zooms the map themselves (a gesture has an originalEvent;
    // programmatic camera moves don't), never auto-recenter to their pin afterwards —
    // leave them where they chose to look.
    const userGesture = (e) => { if (e && e.originalEvent) this._userMoved = true; };
    this.map.on('dragstart', userGesture);
    this.map.on('zoomstart', userGesture);
    this.map.on('rotatestart', userGesture);
    // Smoothness: don't rebuild markers on every zoom frame — MapLibre repositions
    // the existing pins on the GPU during a gesture (smooth). Only recompute the
    // marker set (cull / cluster-switch / de-overlap) once the gesture settles.
    this.map.on('moveend', () => { this._syncSoon(); if (typeof renderFilters === 'function') renderFilters(); });
    this.map.on('zoomend', () => this._syncSoon());
    // hide far-side markers live while spinning the globe (no back-through flashing)
    this.map.on('move', () => this._scheduleCull());
    // safety net: only drop to the simple map when WebGL genuinely isn't available.
    // A slow tile/style load must NOT blank the map (that caused light mode to show
    // an empty canvas) — if WebGL works we keep waiting for GL to render.
    setTimeout(() => {
      if (this._ready) return;
      if (webglAvailable()) return; // give MapLibre more time; it will render
      console.warn('WebGL unavailable — using fallback map');
      try { this.map.remove(); } catch (e) {}
      this.map = null; this._initFallback(); this._resize();
    }, 9000);
  }
  _initFallback() {
    // no WebGL / library (offline): plain light backdrop + bounds projection, still tappable
    this.c.style.pointerEvents = 'auto';
    this.c.addEventListener('click', (e) => {
      const r = this.c.getBoundingClientRect();
      this._tap(e.clientX - r.left, e.clientY - r.top);
    });
    const m = document.getElementById('map');
    if (m) m.style.background = currentTheme() === 'dark' ? '#14151c' : '#e9edf2';
    this._fallback = true; this._maybeHideSkeleton();
  }
  _resize() {
    const el = this.c.parentElement.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.vw = el.width; this.vh = el.height;
    this.c.width = el.width * this.dpr; this.c.height = el.height * this.dpr;
    this.c.style.width = el.width + 'px'; this.c.style.height = el.height + 'px';
    if (this.map) this.map.resize();
  }
  setData(d) {
    const first = !this.bounds;
    this.bounds = d.bounds; this.venues = d.venues; this.areas = d.areas;
    this._cityCenterCache = null; // venues changed → recompute stable cluster anchors
    if (!this.map || this._ready) this._buildMarkers();
    if (first) this._initialCamera();
    this._maybeHideSkeleton();
  }
  // Reveal the MAP as soon as its basemap is up (don't wait for venue data) — the map
  // appears first and the venues then fade in on top, instead of a fake-pin skeleton.
  _maybeHideSkeleton() {
    if (!(this._ready || this._fallback)) return;
    const sk = document.getElementById('mapSkeleton');
    if (sk && !sk.classList.contains('gone')) { sk.classList.add('gone'); setTimeout(() => { try { sk.remove(); } catch (e) {} }, 550); }
  }
  // Create the DOM marker for one venue (structure only; live state via _applyPinState)
  _markerFor(v) {
    const col = BAND_COLOR[fullnessBand(v)].core;
    const el = document.createElement('div');
    if (v.photo && !v.lgbtq) {
      el.className = 'pin photo';
      el.innerHTML = `<div class="pin-body" style="--pc:${col}"><img class="pin-photo" src="${v.photo}" alt="" loading="lazy" /></div>`;
    } else {
      el.className = 'pin' + (v.lgbtq ? ' lgbtq' : '');
      el.innerHTML = `<div class="pin-body" style="--pc:${col}"><span class="pin-ic">${venueIcon(v)}</span></div>`;
    }
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      // a stacked pin (multiple venues within a few px) opens a list of them so you
      // can pick either — co-located venues never separate no matter how far you zoom.
      if (el._stackCount > 1 && el._stackMembers && el._stackMembers.length > 1) showPinStack(el._stackMembers);
      else openVenue(v.id);
    });
    const wrap = document.createElement('div'); wrap.className = 'pin-wrap'; wrap.appendChild(el);
    wrap.style.zIndex = '4'; // venue pins sit ABOVE neighbourhood labels
    const marker = new maplibregl.Marker({ element: wrap, anchor: 'bottom', opacityWhenCovered: '0' }).setLngLat([v.coords.lng, v.coords.lat]);
    marker._lng = v.coords.lng; marker._lat = v.coords.lat; marker._el = el; marker._vid = v.id;
    return marker;
  }
  // Update a venue pin's live state (colour / open / selected) in place — no DOM churn
  _applyPinState(el, v) {
    const band = fullnessBand(v);
    el.classList.toggle('closed', v.open === false);
    if (!(v.photo && !v.lgbtq)) el.classList.toggle('amber', band === 'busy');
    el.classList.toggle('sel', this.selected === v.id);
    const body = el.querySelector('.pin-body'); if (body) body.style.setProperty('--pc', BAND_COLOR[band].core);
  }
  // group venues that overlap on screen (within ~30px) into stacks so pins stop
  // hiding behind each other; the strongest-radar venue represents the stack.
  _stackGroups(vs) {
    const pts = [];
    for (const v of vs) {
      let x = -9999, y = -9999;
      try { const p = this.map.project([v.coords.lng, v.coords.lat]); x = p.x; y = p.y; } catch (e) {}
      pts.push({ v, x, y });
    }
    pts.sort((a, b) => b.v.radar.score - a.v.radar.score); // strongest venue leads its stack
    // only merge pins that genuinely sit ON TOP of each other (roughly one pin
    // radius apart). Once zooming separates them they show individually — no badge.
    const PIX = 17, groups = [];
    for (const p of pts) {
      let g = null;
      for (const gg of groups) { const dx = gg.x - p.x, dy = gg.y - p.y; if (dx * dx + dy * dy < PIX * PIX) { g = gg; break; } }
      if (g) { g.count++; g.members.push(p.v); }
      else groups.push({ v: p.v, x: p.x, y: p.y, count: 1, members: [p.v] });
    }
    return groups;
  }
  // show/update the "+N venues here" badge on a stacked pin
  _applyPinCount(el, count, members) {
    el._stackCount = count;
    el._stackMembers = members || null;
    let b = el.querySelector('.pin-count');
    if (count > 1) {
      if (!b) { b = document.createElement('span'); b.className = 'pin-count'; el.appendChild(b); }
      b.textContent = count > 99 ? '99+' : count; b.hidden = false;
    } else if (b) { b.hidden = true; }
  }
  _labelFor(a) {
    const band = bandKey(a.nightScore);
    const el = document.createElement('div');
    el.className = 'hz-label';
    el.style.zIndex = '1'; // neighbourhood labels sit BEHIND venue pins
    el.innerHTML = `<div class="area-name">${esc(a.name)}</div><div class="area-badge bg-${band}">${a.hotzone ? '🔥 ' : ''}${esc(a.label)} · ${a.nightScore}</div>`;
    el.addEventListener('click', (ev) => { ev.stopPropagation(); openArea(a.id); });
    return new maplibregl.Marker({ element: el, anchor: 'center', opacityWhenCovered: '0' }).setLngLat([a.center.lng, a.center.lat]);
  }
  // Predicate: is a {lat,lng} inside the current viewport (+ margin)?
  _inViewFn() {
    try {
      const b = this.map.getBounds();
      let w = b.getWest(), e = b.getEast(), s = b.getSouth(), n = b.getNorth();
      const mx = Math.max((e - w) * 0.35, 1.5), my = Math.max((n - s) * 0.35, 1.5);
      w -= mx; e += mx; s -= my; n += my;
      const wrap = w > e; // viewport crosses the antimeridian
      return (c) => c && c.lat >= s && c.lat <= n && (wrap ? (c.lng >= w || c.lng <= e) : (c.lng >= w && c.lng <= e));
    } catch (e) { return () => true; }
  }
  // One representative venue per city (highest Party Radar score wins) — a light,
  // Venues currently in view (viewport-culled). Used when zoomed in (z>=6).
  _wantedVenues() {
    const matching = this.venues.filter(venueMatches);
    const inView = this._inViewFn();
    let vis = matching.filter((v) => inView(v.coords));
    if (!vis.length) vis = matching; // fallback if getBounds glitches
    // cap the number of DOM pins so a dense city stays smooth to zoom/pan. Keep the
    // highest Party-Radar-score venues, but STICKILY prefer pins that are already on
    // screen so zooming/panning doesn't swap the visible set (pins popping in/out).
    const CAP = 90;
    if (vis.length > CAP) {
      const shown = this._markerById || {};
      vis = vis.slice().sort((a, b) =>
        ((shown[b.id] ? 1e6 : 0) + b.radar.score) - ((shown[a.id] ? 1e6 : 0) + a.radar.score)
      ).slice(0, CAP);
    }
    return vis;
  }
  // A STABLE geographic centre per city, computed once from ALL its venues (not
  // just the ones currently on screen). Cluster bubbles anchor here so they stay
  // put while you zoom/pan — otherwise a viewport-dependent centroid makes every
  // bubble drift around as the set of in-view venues changes.
  _cityCenters() {
    if (this._cityCenterCache) return this._cityCenterCache;
    const g = {};
    for (const v of this.venues) {
      if (!v.coords) continue;
      const c = v.city || '?';
      (g[c] || (g[c] = { lat: 0, lng: 0, n: 0 }));
      g[c].lat += v.coords.lat; g[c].lng += v.coords.lng; g[c].n++;
    }
    const out = {};
    for (const c in g) out[c] = { lat: g[c].lat / g[c].n, lng: g[c].lng / g[c].n, total: g[c].n };
    this._cityCenterCache = out;
    return out;
  }
  // A count "cluster" bubble marker — shows how many venues are in that city.
  // Tapping it flies into the city (zoom 11.8) so its individual pins appear.
  _clusterFor(w) {
    const el = document.createElement('div');
    el.className = 'cluster';
    el.innerHTML = `<div class="cl-in"><span class="cl-count">${w.n}</span></div>`;
    el.title = `${w.name} · ${w.n} venue${w.n === 1 ? '' : 's'}`;
    el.addEventListener('click', (ev) => { ev.stopPropagation(); if (this.map) this.map.flyTo({ center: [w.center.lng, w.center.lat], zoom: 11.8, duration: 900 }); });
    const m = new maplibregl.Marker({ element: el, anchor: 'center', opacityWhenCovered: '0' }).setLngLat([w.center.lng, w.center.lat]);
    m._el = el; m._lat = w.center.lat; m._lng = w.center.lng; return m;
  }
  // Sync markers to the current view. Two modes:
  //   • zoomed OUT (z<6): one COUNT bubble per city ("how many venues are there"),
  //     which also keeps the globe light and smooth to spin.
  //   • zoomed IN  (z>=6): individual venue pins for whatever is in view.
  // Markers are added/removed by delta and never re-added, so occluded pins on the
  // far side of the globe never flash.
  _syncMarkers() {
    if (!this.map || !this._ready) return;
    try {
      if (!this._markerById) this._markerById = {};
      if (!this._labelById) this._labelById = {};
      if (!this._clusterById) this._clusterById = {};
      const z = this.map.getZoom();
      // cluster/pin switch with hysteresis: a dead zone [5.7, 6.3] so slow zooming
      // (raised below so regional/metro views show ONE count bubble per city instead
      // of a messy mix of individual pins and stack badges)
      // near the boundary doesn't flicker bubbles and pins in and out.
      if (this._clusterMode === undefined) this._clusterMode = z < 8.6;
      if (this._clusterMode && z > 9.1) this._clusterMode = false;   // zoomed into a city → individual pins
      else if (!this._clusterMode && z < 8.6) this._clusterMode = true; // zoomed out → one bubble per city
      const clusterMode = this._clusterMode;

      // ---- count bubbles (clusters) ----
      // ONE bubble per CITY, showing that city's own venue count (e.g. NYC = 10),
      // anchored at a fixed centre so it stays put. Cities are NEVER merged into
      // regional mega-bubbles — zooming out keeps per-city counts instead of
      // combining them into one giant "300". Tap a bubble to dive into that city.
      const wantC = {};
      if (clusterMode) {
        const inView = this._inViewFn();
        const centers = this._cityCenters();               // fixed per-city anchors + totals
        // per-city counts only change when the filter/search changes — cache them so
        // panning/zooming doesn't re-scan all venues on every move.
        const ckey = (S.filter || 'all') + '|' + (S.query || '');
        let g = this._cityCountCache;
        if (!g || this._cityCountKey !== ckey) {
          g = {};
          for (const v of this.venues) { if (!venueMatches(v)) continue; const c = v.city || '?'; g[c] = (g[c] || 0) + 1; }
          this._cityCountCache = g; this._cityCountKey = ckey;
        }
        for (const c in g) {
          const ctr = centers[c];
          if (!ctr) continue;
          if (!inView(ctr)) continue;                      // city centre off-screen → skip
          const id = 'city_' + c;
          wantC[id] = { id, name: c, n: g[c], center: ctr, members: 1 };
        }
        // FALLBACK: the viewport filter (map.getBounds) can glitch at the
        // globe↔flat transition (~z5-7) and return nothing, which made the whole
        // map go empty on zoom-out. If that happens, ignore the viewport and show
        // cities anyway (the cull still hides the far side) — never a blank map.
        if (!Object.keys(wantC).length) {
          for (const c in g) {
            const ctr = centers[c]; if (!ctr) continue;
            const id = 'city_' + c;
            wantC[id] = { id, name: c, n: g[c], center: ctr, members: 1 };
          }
        }
        // Build bubbles for every in-view city (NOT just the front of the globe), so
        // as you spin, cities on the near side keep showing — the far side is hidden
        // per-frame by the cull, not dropped here. Cap only to keep it smooth: keep
        // the biggest cities. Generous so the world never looks empty; the optimized
        // cull handles the count fine.
        const cap = z < 4 ? 130 : z < 6 ? 180 : 400;
        const ids = Object.keys(wantC);
        if (ids.length > cap) {
          ids.sort((a, b) => wantC[b].n - wantC[a].n);
          for (let i = cap; i < ids.length; i++) delete wantC[ids[i]];
        }
      }
      for (const id of Object.keys(this._clusterById)) {
        if (!wantC[id]) { this._fadeRemove(this._clusterById[id]); delete this._clusterById[id]; }
      }
      for (const id in wantC) {
        const w = wantC[id]; let m = this._clusterById[id];
        if (!m) { m = this._clusterFor(w); m.addTo(this.map); this._clusterById[id] = m; this._fadeIn(m.getElement()); }
        else { const b = m._el.querySelector('.cl-count'); if (b) b.textContent = w.n; m.setLngLat([w.center.lng, w.center.lat]); }
      }

      // ---- individual venue pins (only when zoomed in) ----
      // merge overlapping pins into stacks (one pin + a count badge) so close-together
      // venues don't hide behind each other; zooming in fans the stack out.
      const wanted = {};
      if (!clusterMode) for (const g of this._stackGroups(this._wantedVenues())) wanted[g.v.id] = g;
      for (const id of Object.keys(this._markerById)) {
        if (!wanted[id]) { this._fadeRemove(this._markerById[id]); delete this._markerById[id]; }
      }
      for (const id in wanted) {
        const g = wanted[id];
        let m = this._markerById[id];
        if (!m) { m = this._markerFor(g.v); m.addTo(this.map); this._markerById[id] = m; this._fadeIn(m.getElement()); }
        this._applyPinState(m._el, g.v);
        this._applyPinCount(m._el, g.count, g.members);
      }
      this._markers = Object.values(this._markerById);

      // ---- neighbourhood labels (only when zoomed into a city) ----
      const inView = this._inViewFn();
      const wantA = {};
      if (z >= 11.5) for (const a of this.areas) { if (inView(a.center)) wantA[a.id] = a; }
      for (const id of Object.keys(this._labelById)) {
        if (!wantA[id]) { this._labelById[id].remove(); delete this._labelById[id]; }
      }
      for (const id in wantA) {
        if (!this._labelById[id]) { const lm = this._labelFor(wantA[id]); lm.addTo(this.map); this._labelById[id] = lm; }
      }
      this._labelMarkers = Object.values(this._labelById);
      // hide any far-side globe markers we just added (the cull otherwise only runs
      // while moving — a static globe would flash back-side bubbles through it)
      this._cullBackface();
    } catch (e) { console.warn('marker sync failed', e); }
  }
  // --- Snapchat-style smooth appear/disappear: markers fade in when added and
  // fade out before removal (on an inner element so MapLibre's occlusion opacity
  // on the marker root never fights the transition). ---
  // On the 3D globe (zoomed out), a lat/lng on the FAR side should not paint — DOM
  // markers there otherwise flash through as you spin. True if the point is on the
  // hemisphere facing the camera (only checked at globe zoom; always true when flat).
  _onFrontHemisphere(coords) {
    if (!this.map || !coords) return true;
    try {
      if (this.map.getZoom() >= 5.5) return true; // mercator / zoomed in — no globe back-face
      const c = this.map.getCenter(); const toR = (d) => d * Math.PI / 180;
      const cosd = Math.sin(toR(c.lat)) * Math.sin(toR(coords.lat))
        + Math.cos(toR(c.lat)) * Math.cos(toR(coords.lat)) * Math.cos(toR(coords.lng - c.lng));
      return cosd > 0.12; // angle < ~83° from the centre → on the visible face
    } catch (e) { return true; }
  }
  // rAF-throttled so many 'move' events in one frame cost a single cull pass.
  _scheduleCull() {
    if (this._cullRAF) return;
    this._cullRAF = requestAnimationFrame(() => { this._cullRAF = null; this._cullBackface(); });
  }
  // Hide markers on the globe's far side while spinning/panning so they never flash
  // through. The camera centre + its trig are computed ONCE (not per marker), which
  // is what keeps a world full of bubbles smooth to spin.
  _cullBackface() {
    if (!this.map) return;
    const clusters = this._clusterById || {}, pins = this._markerById || {};
    const globe = this.map.getZoom() < 5.5;
    if (!globe) { // flat/zoomed-in: clear any leftover hidden state, nothing to cull
      for (const id in clusters) { const el = clusters[id].getElement(); if (el && el.style.visibility) el.style.visibility = ''; }
      for (const id in pins) { const el = pins[id].getElement(); if (el && el.style.visibility) el.style.visibility = ''; }
      return;
    }
    const c = this.map.getCenter(), R = Math.PI / 180;
    const sLat = Math.sin(c.lat * R), cLat = Math.cos(c.lat * R), cLng = c.lng;
    const cull = (obj) => {
      for (const id in obj) {
        const m = obj[id], el = m.getElement(); if (!el) continue;
        const cosd = sLat * Math.sin(m._lat * R) + cLat * Math.cos(m._lat * R) * Math.cos((m._lng - cLng) * R);
        el.style.visibility = cosd > 0.02 ? '' : 'hidden'; // show ~full near hemisphere
      }
    };
    cull(clusters); cull(pins);
  }
  _mkInner(root) { return root && root.querySelector('.pin, .cl-in'); }
  _fadeIn(root) {
    const c = this._mkInner(root); if (!c) return;
    c.classList.add('mk-enter');
    requestAnimationFrame(() => requestAnimationFrame(() => { c.classList.remove('mk-enter'); }));
  }
  _fadeRemove(marker) {
    // on the globe (zoomed out) remove instantly — a fading marker would otherwise
    // linger and flash on the far side as you spin
    if (!marker || marker._removing || (this.map && this.map.getZoom() < 5.5)) { try { marker.remove(); } catch (e) {} return; }
    marker._removing = true;
    const c = this._mkInner(marker.getElement());
    if (c) c.classList.add('mk-enter');
    setTimeout(() => { try { marker.remove(); } catch (e) {} }, 300);
  }
  _buildMarkers() { this._syncMarkers(); }             // alias (filter/first build re-eval all)
  // Throttle (not debounce): update markers WHILE zooming/panning so pins appear as
  // you move, instead of only ~120ms after you stop.
  _syncSoon() {
    const t = Date.now();
    if (this._lastSync && t - this._lastSync < 140) {
      clearTimeout(this._syncT);
      this._syncT = setTimeout(() => { this._lastSync = Date.now(); this._syncMarkers(); }, 140);
      return;
    }
    this._lastSync = t;
    this._syncMarkers();
  }
  _updateLabelVis() { this._syncSoon(); }
  refreshSelection() { this._syncMarkers(); }
  setUserLocation(loc) {
    this.userLoc = loc;
    if (!this.map) return;
    if (!this._userEl) { this._userEl = document.createElement('div'); this._userEl.className = 'user-dot'; this._userEl.style.zIndex = '500'; }
    if (!this._userMarker) this._userMarker = new maplibregl.Marker({ element: this._userEl }).setLngLat([loc.lng, loc.lat]).addTo(this.map);
    else this._userMarker.setLngLat([loc.lng, loc.lat]);
  }
  flyToLatLng(lat, lng, z = 12.5) { if (this.map && this._ready) this.map.flyTo({ center: [lng, lat], zoom: z, duration: 450, speed: 2.2, essential: true }); }
  // initial camera: a remembered location wins over the whole-country fit (runs once)
  _initialCamera() {
    if (this._camDone) return;
    if (this.map && !this._ready) return; // wait for the GL map to load
    // The user dot and the remembered-centre jump don't need venue data, so they must
    // NOT wait on `this.bounds` (which only exists after /api/state loads — up to a
    // cold-start 30s). Waiting caused the map to suddenly jump to the pin long after
    // launch. Only the whole-scene `fit()` fallback needs bounds; defer just that.
    if (S.userLoc && S._userIsGps) this.setUserLocation(S.userLoc);
    // Once the user has panned/zoomed themselves, honour it — don't recenter to the pin.
    if (this._userMoved) { this._camDone = true; S._rememberFly = false; return; }
    const saved = (typeof loadLoc === 'function') ? (() => { try { return loadLoc(); } catch (e) { return null; } })() : null;
    const remembered = saved && !saved.skip && typeof saved.lat === 'number' && typeof saved.lng === 'number';
    if (S.userLoc && S._rememberFly) {
      this._camDone = true;
      S._rememberFly = false;
      const t = S._flyTarget || S.userLoc;
      this.map.jumpTo({ center: [t.lng, t.lat], zoom: 11 }); // instant, no animation — full-city view
    } else if (remembered) {
      this._camDone = true; // map already opened on the remembered spot; nothing to do
    } else {
      // no remembered spot → show the whole scene, but that needs venue bounds
      if (!this.bounds && this.map) return; // try again once data arrives
      this._camDone = true;
      this.fit(true);
    }
  }
  // lat/lng -> screen pixels (via MapLibre, or a linear fallback within the stage)
  proj(coords) {
    if (this.map && this._ready) { const p = this.map.project([coords.lng, coords.lat]); return { x: p.x, y: p.y }; }
    const b = this.bounds; if (!b) return { x: -99, y: -99 };
    const pad = 46;
    const nx = (coords.lng - b.minLng) / (b.maxLng - b.minLng);
    const ny = 1 - (coords.lat - b.minLat) / (b.maxLat - b.minLat);
    return { x: pad + nx * (this.vw - pad * 2), y: 70 + ny * (this.vh - 70 - 170) };
  }
  zoomK() { return (this.map && this._ready) ? Math.pow(2, this.map.getZoom() - 14) : 1; }
  fit(instant) {
    if (this.map && this._ready && this.bounds) {
      const b = this.bounds;
      this.map.fitBounds([[b.minLng, b.minLat], [b.maxLng, b.maxLat]], { padding: 34, duration: instant ? 0 : 700, maxZoom: 16 });
      this._updateLabelVis();
    }
    this.zoomed = false; const zr = document.getElementById('zoomReset'); if (zr) zr.hidden = true;
  }
  // Frame a set of venues (e.g. search results) so their pins are actually on
  // screen — otherwise a search for an area lists results in the sheet but the
  // map stays on your location and looks empty.
  fitToVenues(vs) {
    if (!this.map || !this._ready || !vs || !vs.length) return;
    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180, n = 0;
    for (const v of vs) { const c = v.coords; if (!c) continue; n++; minLat = Math.min(minLat, c.lat); maxLat = Math.max(maxLat, c.lat); minLng = Math.min(minLng, c.lng); maxLng = Math.max(maxLng, c.lng); }
    if (!n) return;
    if (maxLat - minLat < 0.01 && maxLng - minLng < 0.01) { this.flyToLatLng((minLat + maxLat) / 2, (minLng + maxLng) / 2, 13.5); }
    else this.map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 56, duration: 700, maxZoom: 14 });
    this.zoomed = true; const zr = document.getElementById('zoomReset'); if (zr) zr.hidden = false;
  }
  // swap the basemap to match light/dark. DOM markers survive setStyle; the
  // persistent 'style.load' listener re-enables the globe projection afterwards.
  setTheme(mode) {
    if (this._fallback) { const m = document.getElementById('map'); if (m) m.style.background = mode === 'dark' ? '#14151c' : '#e9edf2'; return; }
    if (!this.map) return;
    try {
      this.map.setStyle(mapStyleFor(mode));
      // re-draw pins once the new style has loaded (markers are DOM, but re-sync to be safe)
      this.map.once('style.load', () => { try { this._syncMarkers && this._syncMarkers(); } catch (e) {} });
    } catch (e) {}
  }
  focusArea(area) {
    if (this.map && this._ready) this.map.flyTo({ center: [area.center.lng, area.center.lat], zoom: 15.5, duration: 800 });
    this.zoomed = true; const zr = document.getElementById('zoomReset'); if (zr) zr.hidden = false;
  }
  _tap(px, py) {
    // Only hit-test the pins actually ON the map (they already honour the active
    // filter + stacking). Scanning every venue used to open a nearby CLOSED /
    // filtered-out venue whose pin wasn't even shown when you tapped near a pin.
    let best = null, bestD = 30;
    for (const m of (this._markers || [])) {
      let s; try { s = this.proj({ lat: m._lat, lng: m._lng }); } catch (e) { continue; }
      const d = Math.hypot(s.x - px, s.y - py);
      if (d < bestD) { bestD = d; best = m; }
    }
    if (best) {
      const el = best._el; // a stacked pin opens its picker; otherwise open the venue
      if (el && el._stackCount > 1 && el._stackMembers && el._stackMembers.length > 1) showPinStack(el._stackMembers);
      else openVenue(best._vid);
      return;
    }
    for (const a of this.areas) { // tapping a neighbourhood opens its area sheet
      const s = this.proj(a.center);
      if (Math.hypot(s.x - px, s.y - py) < 46) { openArea(a.id); return; }
    }
  }
  loop(now) {
    // when the GL map is up and the radar wash is off, the overlay canvas has
    // nothing to draw — skip the per-frame clear (clear once on the way to idle)
    const idle = this.map && this._ready && !S.radarOn;
    if (!idle) { this.render(now); this._wasActive = true; }
    else if (this._wasActive) {
      const ctx = this.ctx; ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); ctx.clearRect(0, 0, this.vw, this.vh);
      this._wasActive = false;
    }
    requestAnimationFrame(this.loop);
  }
  render(now) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.vw, this.vh);
    if (!(this.vw > 2 && this.vh > 2) || !this.bounds) return;
    if (this.map && !this._ready) return;
    const k = Math.max(0.4, Math.min(3, this.zoomK()));

    // Optional RADAR heat layer — a soft, tasteful activity wash (toggle only).
    if (S.radarOn) {
      ctx.globalCompositeOperation = 'multiply';
      for (const v of this.venues) {
        const s = this.proj(v.coords);
        const band = BAND_COLOR[bandKey(v.radar.score)];
        const rad = (22 + (v.radar.score / 100) * 46) * k;
        const inten = 0.05 + (v.radar.score / 100) * 0.22;
        if (!Number.isFinite(s.x) || !Number.isFinite(s.y) || !(rad > 0)) continue;
        const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, rad);
        g.addColorStop(0, `rgba(${band.glow},${inten})`);
        g.addColorStop(1, `rgba(${band.glow},0)`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(s.x, s.y, rad, 0, 7); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    // Offline fallback (no Leaflet): draw simple pin dots on the canvas.
    if (!this.map) {
      for (const v of this.venues) {
        const s = this.proj(v.coords);
        if (!Number.isFinite(s.x)) continue;
        const band = bandKey(v.radar.score);
        ctx.fillStyle = BAND_COLOR[band].core;
        ctx.beginPath(); ctx.arc(s.x, s.y, 15, 0, 7); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = band === 'busy' ? '#3c2c00' : '#fff';
        ctx.font = '700 11px Roboto Mono, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(v.radar.score, s.x, s.y);
      }
    }
  }
}

/* ============================================================
   RENDER: sheet lists
   ============================================================ */
// Airbnb-style list card: big photo (heart + open pill), then title + rating, the
// neighbourhood/kind, tonight's hours, the entry price, and live vibe badges.
function venueRow(v) {
  const closed = v.open === false;
  const band = closed ? 'quiet' : bandKey(v.radar.score);
  const photo = v.googlePhoto || v.photo || null;
  const rating = (v.google && v.google.rating) ? v.google.rating : null;
  const ratings = (v.google && v.google.ratings) ? v.google.ratings : null;
  const saved = isSaved(v.id);
  const entry = entryText(v);
  const priceTxt = entry === 'Free' ? 'Free entry' : (entry === '—' ? 'Entry varies' : entry + ' entry');
  const hoursLine = closed
    ? (v.hours && v.hours.opensLabel ? 'Opens ' + v.hours.opensLabel : 'Closed now')
    : (v.hours && v.hours.closesLabel ? 'Open now · till ' + v.hours.closesLabel : 'Open now');
  const hot = !closed && ['surging', 'exploding', 'heating'].includes(v.momentum.state);
  const photoInner = photo
    ? `<img class="lc-img" src="${esc(photo)}" alt="" loading="lazy" onerror="this.parentNode.classList.add('noimg');this.remove()"/>`
    : `<span class="lc-ph">${venueIcon(v)}</span>`;
  return `<div class="lcard${closed ? ' closed' : ''}" onclick="rowClick('${v.id}')">
    <div class="lc-photo" style="--pc:${BAND_COLOR[band].core}">
      ${photoInner}
      <button class="lc-heart${saved ? ' on' : ''}" aria-label="Save" onclick="event.stopPropagation();toggleSave('${v.id}');this.classList.toggle('on')">
        <svg viewBox="0 0 24 24"><path d="M12 20.5C7 16.5 3.5 13.4 3.5 9.6 3.5 7 5.5 5 8 5c1.6 0 3 .9 4 2.3C13 5.9 14.4 5 16 5c2.5 0 4.5 2 4.5 4.6 0 3.8-3.5 6.9-8.5 10.9z"/></svg>
      </button>
      <span class="lc-status ${closed ? 'shut' : 'now'}">${closed ? 'Closed' : 'Open now'}</span>
    </div>
    <div class="lc-body">
      <div class="lc-row1">
        <span class="lc-title">${esc(v.name)}${v.verified ? ' <span class="verified">✔</span>' : ''}</span>
        ${rating ? `<span class="lc-rating">★ ${rating}${ratings ? ` (${ratings})` : ''}</span>` : ''}
      </div>
      <div class="lc-sub">${esc(v.neighborhoodName)} · ${esc(v.kind)}${v._dist != null ? ' · ' + distLabel(v._dist) : ''}</div>
      <div class="lc-sub">${esc(hoursLine)}</div>
      <div class="lc-price"><b>${esc(priceTxt)}</b></div>
      <div class="lc-badges">
        <span class="lc-badge c-${band}">${closed ? 'Closed' : esc(v.radar.label)}</span>
        ${hot ? `<span class="lc-badge hot">🔥 ${v.momentum.state === 'heating' ? 'Heating up' : 'Popping'}${v.pct != null && v.pct > 0 ? ' +' + v.pct + '%' : ''}</span>` : ''}
      </div>
    </div>
  </div>`;
}
function areaCard(a) {
  const band = bandKey(a.nightScore);
  return `<div class="acard ${a.hotzone ? 'hot' : ''}" onclick="openArea('${a.id}')">
    <div class="acard-top">
      <div><div class="aname">${esc(a.name)}</div>
        <div class="vlabel c-${band}" style="margin-top:3px">${a.hotzone ? '🔥 ' : ''}${esc(a.label)}</div></div>
      <div class="ascore c-${band}">${a.nightScore}</div>
    </div>
    <div class="acard-sub">
      ${a.popping ? `<span class="chip bg-pop">${a.popping} POPPING</span>` : ''}
      ${a.packed ? `<span class="chip bg-red">${a.packed} PACKED</span>` : ''}
      ${a.surging ? `<span class="chip bg-heat">${a.surging} SURGING</span>` : ''}
      ${!a.popping && !a.packed && !a.surging ? `<span class="chip bg-chill">${a.venueCount} venues</span>` : ''}
    </div>
    <div class="acard-foot">
      <span>Best for <b>${a.bestFor.join(' · ')}</b></span>
      <span>Peak <b>${esc(a.peakWindow)}</b></span>
    </div>
  </div>`;
}
const FEED_IC = {
  surge: ['↑', 'pop'], vibe: ['●', 'red'], area: ['◎', 'heat'],
  special: ['★', 'busy'], queue: ['◷', 'chill'], report: ['◉', 'heat'],
};
function feedItem(f) {
  const [ic, band] = FEED_IC[f.kind] || ['•', 'chill'];
  return `<div class="feed-item">
    <div class="feed-time">${ago(f.ageMin)}${f.ageMin < 1 ? '' : ' ago'}</div>
    <div class="feed-ic" style="background:${BAND_COLOR[band].core}">${ic}</div>
    <div class="feed-txt">${esc(f.text)}
      ${f.sub ? `<div class="fsub c-${band}">${esc(f.sub)}</div>` : ''}
      ${f.area ? `<div class="farea">${esc(f.area)}</div>` : ''}</div>
  </div>`;
}
function renderSheet() {
  const d = S.data; if (!d) return;
  const body = $('#sheetBody');
  if (S.tab === 'near') {
    let vs = [...d.venues].filter(venueMatches);
    let title = 'Trending now';
    const searching = !!(S.query || '').trim();
    if (searching) {
      // a search spans the whole map — never restrict to what's near you
      if (S.userLoc) vs.forEach((v) => { v._dist = haversineKm(S.userLoc, v.coords); });
      const qc = (S.query || '').trim().toLowerCase();
      if ((qc === 'event' || qc === 'events') && S.userLoc) {
        vs.sort((a, b) => a._dist - b._dist); title = 'Venues with events · nearest first';
      } else {
        vs.sort((a, b) => b.radar.score - a.radar.score);
        title = `Results for “${S.query.trim()}”`;
      }
    } else if (S.userLoc) {
      vs.forEach((v) => { v._dist = haversineKm(S.userLoc, v.coords); });
      const near = vs.filter((v) => v._dist <= 60);
      if (near.length) { vs = near.sort((a, b) => b.radar.score - a.radar.score); title = S.locLabel || 'Best near you'; }
      else { vs.sort((a, b) => a._dist - b._dist); vs = vs.slice(0, 15); title = 'Nearest scene · ' + cityOf(vs[0]); }
    } else {
      vs.sort((a, b) => b.radar.score - a.radar.score);
    }
    const banner = S.reportPick ? `<div class="pick-banner">Choose a place to report the vibe</div>` : '';
    const head = `<div class="section-h"><h3>${esc(title)} <span class="live-dot"></span></h3>
      <span class="count">${vs.length} place${vs.length === 1 ? '' : 's'}</span></div>`;
    const evCta = searching ? '' : eventsCtaHtml(); // surface events in the main list too
    body.innerHTML = banner + head + evCta + (vs.length ? vs.map(venueRow).join('') : '<div class="empty">No places match that filter.</div>');
  } else if (S.tab === 'areas') {
    const as = [...d.areas].sort((a, b) => b.nightScore - a.nightScore);
    body.innerHTML = `<div class="section-h"><h3>Neighbourhoods</h3>
      <span class="count">${d.city}</span></div>` + as.map(areaCard).join('');
  } else if (S.tab === 'saved') {
    const vs = loadSaved().map((id) => d.venues.find((v) => v.id === id)).filter(Boolean);
    if (S.userLoc) vs.forEach((v) => { v._dist = haversineKm(S.userLoc, v.coords); });
    body.innerHTML = `<div class="section-h"><h3>Saved spots</h3><span class="count">${vs.length}</span></div>` +
      (vs.length ? vs.map(venueRow).join('') : '<div class="empty">No saved spots yet.<br>Open any venue and tap “☆ Save for later”.</div>');
  } else if (S.tab === 'feed') {
    const title = S.userLoc ? 'Near you tonight' : 'Tonight';
    body.innerHTML = `<div class="section-h"><h3>${title} <span class="live-dot"></span></h3>
      <span class="count">${esc(S.locLabel || d.city || '')}</span></div>` + eventsCtaHtml() + feedRows();
  }
}

// A "near you tonight" feed: nearby venues turned into actionable picks
// (go now, opening soon, peaking), each with an Instagram link for tonight's
// lineup/events. Built from the venues already loaded, ranked by proximity.
// The single source of truth for the "Near you tonight" feed. Returns an ordered
// list of { v, emoji, text, sub } picks. Both the rendered feed AND the bell badge
// count use this, so the number on the bell always equals the rows you see.
function feedItems() {
  const d = S.data; if (!d) return [];
  // Base the feed on venues NEAR you (or, before location is known, on what's in the
  // current map view) — never the whole world, so the bell never shows a global count.
  let vs;
  if (S.userLoc) {
    vs = d.venues.map((v) => { v._dist = haversineKm(S.userLoc, v.coords); return v; });
    const near = vs.filter((v) => v._dist <= 40);
    vs = near.length ? near : vs.slice().sort((a, b) => a._dist - b._dist).slice(0, 25);
  } else {
    vs = d.venues.filter((v) => (typeof inScope === 'function' ? inScope(v) : true));
    if (!vs.length) vs = d.venues.slice(0, 25);
  }
  const seen = new Set();
  const items = [];
  const add = (v, emoji, text, sub) => {
    if (seen.has(v.id) || items.length >= 30) return; seen.add(v.id);
    items.push({ v, emoji, text, sub });
  };
  // ONLY currently-open venues appear in notifications, so the bell count always
  // equals how many spots near you are open right now.
  const openV = vs.filter((v) => v.open).sort((a, b) => b.radar.score - a.radar.score);
  const dist = (v) => v._dist != null ? ' · ' + distLabel(v._dist) : '';
  // 1) tonight's top pick
  if (openV[0]) add(openV[0], '⭐', `Tonight: head to ${openV[0].name}`, `${openV[0].radar.label} now · ${openV[0].neighborhoodName}${openV[0].hours ? ' · till ' + openV[0].hours.closesLabel : ''}`);
  // 2) popping / heating up right now
  openV.filter((v) => ['surging', 'exploding', 'heating'].includes(v.momentum.state))
    .sort((a, b) => b.momentum.M - a.momentum.M).slice(0, 4)
    .forEach((v) => add(v, '🔥', `${v.name} is ${v.momentum.state === 'heating' ? 'heating up' : 'popping off'}`, `${v.neighborhoodName}${v.pct > 0 ? ' · +' + v.pct + '%' : ''}${dist(v)}`));
  // 3) peaks later tonight
  openV.filter((v) => v.expectedPeak).slice(0, 3)
    .forEach((v) => add(v, '⏰', `${v.name} peaks around ${v.expectedPeak}`, `${v.neighborhoodName}${dist(v)}`));
  // 4) every other open venue near you
  openV.forEach((v) => add(v, '🎉', `${v.name} is open now`, `${v.radar.label} · ${v.neighborhoodName}${v.hours && v.hours.closesLabel ? ' · till ' + v.hours.closesLabel : ''}${dist(v)}`));
  return items;
}
function feedRows() {
  const items = feedItems();
  if (!items.length) return '<div class="empty">No venues near you right now — try zooming the map or picking a city.</div>';
  return items.map(({ v, emoji, text, sub }) => {
    const ic = v.googlePhoto
      ? `<div class="feed-ic photo"><img src="${esc(v.googlePhoto)}" alt="" loading="lazy" onerror="this.parentNode.classList.remove('photo');this.parentNode.style.background='${BAND_COLOR[bandKey(v.radar.score)].core}';this.replaceWith(document.createTextNode('${emoji}'))" /><span class="feed-ic-tag">${emoji}</span></div>`
      : `<div class="feed-ic" style="background:${BAND_COLOR[bandKey(v.radar.score)].core}">${emoji}</div>`;
    return `<div class="feed-item" onclick="rowClick('${v.id}')">
      ${ic}
      <div class="feed-txt"><b>${esc(text)}</b>
        <div class="fsub">${esc(sub)}</div>
        ${v.instagram ? `<button class="feed-ig" onclick="event.stopPropagation();openInsta('${v.id}')">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.1" fill="currentColor" stroke="none"/></svg>
          What's on tonight</button>` : ''}</div>
    </div>`;
  }).join('');
}

/* ============================================================
   VENUE DETAIL
   ============================================================ */
async function openVenue(id) {
  S.activeVenue = id; map.selected = id; map.refreshSelection && map.refreshSelection();
  closeSheet();
  const ov = $('#venueOverlay'); ov.hidden = false;
  // Show the venue INSTANTLY from the data we already loaded (/api/state) instead of
  // waiting on a network round-trip, then quietly upgrade with the full detail
  // (user photos + full events) when it arrives.
  const cached = (S.data && S.data.venues || []).find((x) => x.id === id);
  let shown = false;
  // the cached (state) snapshot is lighter than the full payload — if rendering it
  // throws for any missing field, fall back to the skeleton and the full fetch so
  // the venue ALWAYS opens.
  if (cached) { try { S.activeVenueData = cached; renderVenue(cached); shown = true; } catch (e) { shown = false; } }
  if (!shown) $('#venueCard').innerHTML = '<div class="vc-hero skel" style="height:220px"></div>';
  try {
    const v = await API.venue(id);
    if (S.activeVenue !== id) return;
    S.activeVenueData = v; // full detail incl. media + full events
    // quiet upgrade — don't replay the entrance animation if the cached card is
    // already showing (that re-animation is the "it refreshes again" the user saw)
    renderVenue(v, { noAnim: shown });
  } catch (e) { if (!shown) $('#venueCard').innerHTML = '<div class="empty">Couldn’t load this venue — try again.</div>'; }
}
function closeVenue() { $('#venueOverlay').hidden = true; S.activeVenue = null; S.activeVenueData = null; map.selected = null; map.refreshSelection && map.refreshSelection(); }

// tap any community photo/video to view it full screen, with the poster's avatar
// Full-screen Clubbit media viewer: dark overlay, aspect-preserving (never crops),
// horizontal swipe across a report's media, pinch/double-tap zoom on photos, native
// video controls, and a subtle bottom metadata line ("Nick · Reported 9 min ago").
let _lbItems = [], _lbCur = 0;
function setLbMeta(m) {
  const mEl = $('#lbMeta'); if (!mEl) return;
  if (m && (m.name || m.sub)) {
    mEl.innerHTML = `${m.photo ? `<img class="lb-mface" src="${esc(m.photo)}" alt="" onerror="this.remove()" />` : ''}<span class="lb-mtxt">${m.name ? `<b>${esc(m.name)}</b>` : ''}${m.sub ? `<span>${esc(m.sub)}</span>` : ''}</span>`;
    mEl.hidden = false;
  } else mEl.hidden = true;
}
// items carry their own metadata ({url,type,id,name,photo,sub}) so the top-right
// chip updates as you swipe from one report's media to the next.
function showMediaViewer(items, index) {
  const lb = $('#lightbox'), track = $('#lbTrack'); if (!lb || !track || !items || !items.length) return;
  const start = Math.max(0, Math.min(index || 0, items.length - 1));
  const multi = items.length > 1;
  _lbItems = items; _lbCur = start;
  track.classList.toggle('single', !multi);
  track.innerHTML = items.map((m, i) => `<div class="lb-slide">${
    m.type === 'video'
      ? `<video src="${m.url}" controls playsinline ${i === start ? 'autoplay' : ''} loop></video>`
      : `<img src="${m.url}" alt="" draggable="false" />`}</div>`).join('');
  setLbMeta(items[start]);
  lb.hidden = false;
  requestAnimationFrame(() => { track.scrollLeft = start * track.clientWidth; });
  wireLbZoom(track, multi);
  track.onscroll = () => {
    const idx = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
    if (idx !== _lbCur && _lbItems[idx]) { _lbCur = idx; setLbMeta(_lbItems[idx]); }
  };
}
// pinch + double-tap zoom (and pan while zoomed) on the viewer's photos; swipe
// between slides stays native. Zooming a photo suspends horizontal swipe.
function wireLbZoom(track, multi) {
  track.querySelectorAll('.lb-slide img').forEach((img) => {
    let scale = 1, tx = 0, ty = 0, startDist = 0, startScale = 1, sx = 0, sy = 0, pan = false, last = 0;
    const ptrs = new Map();
    const apply = () => { img.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`; };
    const zoomed = () => scale > 1.02;
    const mode = (on) => { img.style.touchAction = on ? 'none' : (multi ? 'pan-x' : 'none'); track.style.overflowX = on ? 'hidden' : (multi ? 'auto' : 'hidden'); };
    img.style.transformOrigin = 'center'; img.style.touchAction = multi ? 'pan-x' : 'none';
    img.addEventListener('pointerdown', (e) => {
      ptrs.set(e.pointerId, e); try { img.setPointerCapture(e.pointerId); } catch (_) {} img.style.transition = 'none';
      if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; startDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1; startScale = scale; }
      else if (zoomed()) { pan = true; sx = e.clientX - tx; sy = e.clientY - ty; }
    });
    img.addEventListener('pointermove', (e) => {
      if (!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, e);
      if (ptrs.size === 2 && !multi) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); scale = Math.min(4, Math.max(1, startScale * (d / startDist))); mode(true); apply(); }
      else if (pan && zoomed()) { tx = e.clientX - sx; ty = e.clientY - sy; apply(); }
    });
    const end = (e) => {
      ptrs.delete(e.pointerId);
      if (ptrs.size === 0) { pan = false; if (!zoomed()) { scale = 1; tx = 0; ty = 0; img.style.transition = 'transform .16s ease'; apply(); mode(false); } }
    };
    img.addEventListener('pointerup', end); img.addEventListener('pointercancel', end);
    img.addEventListener('click', () => { const n = Date.now(); if (n - last < 300) { img.style.transition = 'transform .16s ease'; if (zoomed()) { scale = 1; tx = 0; ty = 0; mode(false); } else { scale = 2.4; mode(true); } apply(); } last = n; });
  });
}
function closeLightbox() { const lb = $('#lightbox'); if (!lb) return; lb.hidden = true; $('#lbTrack').innerHTML = ''; }
// back-compat single-media entry (community strip / profile callers)
function openLightbox(url, type, by) { showMediaViewer([{ url, type, name: by ? (by.name || null) : null, photo: by ? (by.photo || null) : null, sub: by ? (by.sub || null) : null }], 0); }
window.openLightbox = openLightbox;
// community "Photos & videos" strip: resolve the media (+poster) from venue data
window.lbShow = function (id) {
  const v = S.activeVenueData; const list = (v && v.media) || [];
  const m = list.find((x) => x.id === id); if (!m) return;
  const sub = m.ageMin != null ? reportClock(m.ageMin, v && v.tzOffset) + (m.ageMin >= 1 ? ' · ' + freshLabel(m.ageMin).replace('Reported ', '') : '') : null;
  showMediaViewer([{ url: m.url, type: m.type, id: m.id, name: (m.by && m.by.name) || null, photo: (m.by && m.by.photo) || null, sub }], 0);
};
// a report's media — opens the full-screen viewer across EVERY report's media, so
// you can swipe from one report to the next; starts at the tapped item.
window.lrShow = function (ri, mi) {
  const v = S.activeVenueData; if (!v) return;
  const items = []; let start = 0;
  (v.recentReports || []).forEach((r, idx) => {
    reportMediaList(r).forEach((m, j) => {
      if (idx === ri && j === (mi || 0)) start = items.length;
      const rel = freshLabel(r.ageMin).replace('Reported ', '');
      items.push({ url: m.url, type: m.type, id: m.id, name: r.name + (r.age ? ', ' + r.age : ''), photo: r.photo || null, sub: reportClock(r.ageMin, v.tzOffset) + ' · ' + rel });
    });
  });
  if (!items.length) return;
  showMediaViewer(items, start);
};
// profile media: it's the current user's own upload → show their name
window.lbShowMine = function (url, type) {
  const p = myProfile();
  showMediaViewer([{ url, type, name: p.firstName || 'You', sub: null }], 0);
};

// A short "what this place is" line, used when Google has no editorial blurb.
// ---- reporter levels (client-side; the more you report, the higher your tier) ----
const LEVELS = [
  { min: 0,  name: 'Newcomer', emoji: '🌱' },
  { min: 10, name: 'Regular',  emoji: '🎟️' },
  { min: 20, name: 'Scout',    emoji: '🧭' },
  { min: 30, name: 'Insider',  emoji: '🌟' },
  { min: 50, name: 'Legend',   emoji: '👑' },
];
// 'YYYY-MM-DD' -> short weekday for a tonight/this-week event label
function eventDay(d) { try { return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(d + 'T12:00:00').getDay()]; } catch (e) { return 'Soon'; } }
function reportCount() { try { return +localStorage.getItem('clubbit_reports_count') || 0; } catch (e) { return 0; } }
function setReportCount(n) { try { localStorage.setItem('clubbit_reports_count', String(n)); } catch (e) {} }
function levelFor(n) {
  let cur = LEVELS[0], next = null;
  for (let i = 0; i < LEVELS.length; i++) { if (n >= LEVELS[i].min) cur = LEVELS[i]; else { next = LEVELS[i]; break; } }
  return { name: cur.name, emoji: cur.emoji, min: cur.min, count: n, next };
}
function myProfile() { try { return JSON.parse(localStorage.getItem('clubbit_profile')) || {}; } catch (e) { return {}; } }
function myFace(p) { p = p || myProfile(); return p.profilePhoto || (p.gender === 'Woman' ? '/clubbit-face-f.png' : p.gender === 'Man' ? '/clubbit-face-m.png' : p.gender === 'Non-binary' ? '/clubbit-face-nb.png' : '/clubbit-mascot.png'); }

// "Nick, 26 · Scout reported — packed · 12 min ago" cards
const VIBE_WORD = { dead: 'quiet', chill: 'chilled', popping: 'popping', packed: 'packed' };
const QUEUE_LABEL = { none: 'No queue', '<10': 'Under 10 min', '10-20': '10–20 min', '20-30': '20–30 min', '30+': '30+ min', guestlist: 'Guest list' };
const MIX_LABEL = { more_women: 'More women', even: 'Even mix', more_men: 'More men' };
// "Reported 2 min ago" — clear, live freshness wording (the info is meant to be live)
function freshLabel(min) {
  if (min < 1) return 'Reported just now';
  if (min < 60) { const m = Math.round(min); return `Reported ${m} min ago`; }
  const h = Math.round(min / 60); return `Reported ${h} hour${h > 1 ? 's' : ''} ago`;
}
// the clock time a report was posted, in the venue's local timezone ("11:24 PM")
function reportClock(ageMin, tzOffset) {
  const ts = Date.now() - (ageMin || 0) * 60000;
  const d = new Date(ts + (tzOffset || 0) * 3600 * 1000);
  const h = d.getUTCHours(), m = d.getUTCMinutes();
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}
// Forecast header label for a CLOSED venue — the night of its next opening
// ("Fri night", "Sat night"…), computed in the venue's local timezone. A daytime
// opening just uses the weekday. `mins` = minutes from now until that opening.
function openSessionLabel(mins, tzOffset) {
  const d = new Date(Date.now() + (mins || 0) * 60000 + (tzOffset || 0) * 3600 * 1000);
  let dow = d.getUTCDay(); const h = d.getUTCHours();
  if (h < 6) dow = (dow + 6) % 7; // an after-midnight opening belongs to the previous evening
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dow];
  return (h >= 17 || h < 6) ? `${day} night` : day;
}
// Compact summary chips — skipped fields are simply omitted (never shown empty).
function reportChips(v, r) {
  const chips = [`<span class="lr-chip vibe">${esc(cap(VIBE_WORD[r.vibe] || r.vibe))}</span>`];
  if (r.queue && QUEUE_LABEL[r.queue]) chips.push(`<span class="lr-chip">${esc(QUEUE_LABEL[r.queue])}</span>`);
  if (r.entry != null) chips.push(`<span class="lr-chip">${r.entry === 0 ? 'Free' : esc(fmtCur(r.entry, v.currency))}</span>`);
  if (r.mix && MIX_LABEL[r.mix]) chips.push(`<span class="lr-chip">${esc(MIX_LABEL[r.mix])}</span>`);
  if (r.music) chips.push(`<span class="lr-chip">${esc(r.music)}</span>`);
  return chips.join('');
}
function reportMediaList(r) {
  return Array.isArray(r.media) && r.media.length ? r.media
    : (r.mediaUrl ? [{ url: r.mediaUrl, type: r.mediaType, id: r.mediaId }] : []);
}
const REP_NOTE_IC = '<svg class="lr-noteic" viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M21 6h-2v9H7v2a1 1 0 0 0 1 1h9l4 4V7a1 1 0 0 0-1-1zM17 2H3a1 1 0 0 0-1 1v13l4-4h11a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1z"/></svg>';
// A live-report card as a polished media-forward post preview: avatar over the media
// (top-left), the media as the hero, then a bottom section with the byline, key
// report chips and a 2-line note snippet. Falls back to a clean data card with no
// media. Tapping the media opens the full-screen viewer.
function liveReportCard(v, r, i) {
  const id = `lr_${v.id}_${i}`;
  const list = reportMediaList(r);
  const hasMedia = list.length > 0;
  const menu = (r.mine && r.id)
    ? `<div class="lr-menuwrap"><button class="lr-menu" aria-label="Report options" onclick="event.stopPropagation();toggleRepMenu('${id}')"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg></button><div class="lr-menupop" id="${id}_m" hidden><button class="lr-del" onclick="event.stopPropagation();deleteMyReport('${r.id}')">Delete report</button></div></div>`
    : '';
  const face = `<img class="lr-face" src="${esc(r.photo || '/clubbit-mascot.png')}" alt="" onerror="this.src='/clubbit-mascot.png'" />`;
  const clock = reportClock(r.ageMin, v.tzOffset);
  const nameHtml = `<div class="lr-name"><b>${esc(r.name)}${r.age ? ', ' + r.age : ''}</b>${r.tag ? `<span class="lr-tag">${esc(r.tag)}</span>` : ''}${r.mine ? `<span class="lr-you">You</span>` : ''}</div>`;
  const noteHtml = r.note
    ? `<div class="lr-note${r.note.length > 90 ? ' long' : ''}">${REP_NOTE_IC}<div class="lr-notebody"><span class="lr-notetext">“${esc(r.note)}”</span><button class="lr-notemore" onclick="event.stopPropagation();this.closest('.lr-note').classList.toggle('open')"><span class="mt">More</span><span class="lt">Less</span></button></div></div>` : '';
  const hasVideo = list.some((m) => m.type === 'video');
  const countBadge = list.length > 1
    ? `<span class="lr-mcount">${hasVideo ? '▶' : '❏'} ${list.length}</span>` : '';
  // hero: media with avatar + "Live report" label overlaid; tap → full-screen viewer
  const hero = hasMedia ? `<div class="lr-hero" onclick="lrShow(${i},0)">
      ${list[0].type === 'video'
        ? `<video class="lr-heroimg" src="${list[0].url}" muted playsinline loop autoplay preload="metadata"></video><span class="lr-playic" aria-hidden="true"><svg viewBox="0 0 24 24" width="24" height="24" fill="#fff"><path d="M8 5v14l11-7z"/></svg></span>`
        : `<img class="lr-heroimg" src="${list[0].url}" alt="" loading="lazy" />`}
      <img class="lr-face on-media" src="${esc(r.photo || '/clubbit-mascot.png')}" alt="" onerror="this.src='/clubbit-mascot.png'" />
      <span class="lr-type">Live report</span>
      <div class="lr-heroact" onclick="event.stopPropagation()">${countBadge}${menu}</div>
    </div>` : '';
  // body: byline (avatar inline only when there's no hero) + chips + note snippet
  const body = `<div class="lr-body">
      <div class="lr-byline">
        ${hasMedia ? '' : face}
        <div class="lr-id">${nameHtml}<div class="lr-time">${hasMedia ? '' : '<span class="lr-type inline">Report</span> · '}${freshLabel(r.ageMin)} · <span class="lr-clock">${clock}</span></div></div>
        ${hasMedia ? '' : `<div class="lr-actions">${menu}</div>`}
      </div>
      <div class="lr-chips">${reportChips(v, r)}</div>
      ${noteHtml}
    </div>`;
  return `<div class="lr-card${r.mine ? ' mine' : ''}${hasMedia ? ' has-media' : ' no-media'}" id="${id}">${hero}${body}</div>`;
}
function toggleRepMenu(id) {
  const pop = document.getElementById(id + '_m'); if (!pop) return;
  // close other open menus first
  document.querySelectorAll('.lr-menupop').forEach((p) => { if (p !== pop) p.hidden = true; });
  pop.hidden = !pop.hidden;
}
window.toggleRepMenu = toggleRepMenu;
function recentReportsBlock(v) {
  const rs = (v.recentReports || []).filter((r) => r && r.name);
  if (!rs.length) return '';
  return `<div class="reports-block">
    <div class="section-h"><h3>Live reports</h3><span class="count">${rs.length}</span></div>
    <div class="lr-list">${rs.map((r, i) => liveReportCard(v, r, i)).join('')}</div>
  </div>`;
}
function cap(s) { return String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1); }
// "What people are saying" + the community photos, grouped into one block that
// sits at the bottom of the venue card (below the buttons).
function communityBlock(v) {
  const reports = recentReportsBlock(v); // '' when there are none
  // Media already shown inside the LIVE REPORTS cards — don't repeat it in the strip.
  const shownIds = new Set((v.recentReports || []).map((r) => r.mediaId).filter(Boolean));
  const media = (v.media || []).filter((m) => !shownIds.has(m.id));
  // With reports present the strip is a venue-wide gallery of everything ELSE that's
  // been shared here; without reports it's just the venue's photos & videos.
  const stripTitle = reports ? 'More from this venue' : 'Photos &amp; videos';
  const strip = media.length ? `<div class="vc-media"${reports ? ' style="margin-top:14px"' : ''}>
      ${reports ? '<div class="cb-sub">' + stripTitle + '</div>' : '<div class="section-h"><h3>' + stripTitle + '</h3><span class="count">' + media.length + '</span></div>'}
      <div class="media-strip">${media.map(m => `<div class="media-thumbwrap">${
        m.by && m.by.photo ? `<img class="media-by" src="${esc(m.by.photo)}" alt="${esc(m.by.name || '')}" onerror="this.remove()" />` : ''}${
        m.type === 'video'
        ? `<video class="media-thumb" src="${m.url}" muted playsinline loop autoplay preload="metadata" onclick="lbShow('${m.id}')"></video>`
        : `<img class="media-thumb" src="${m.url}" alt="Community photo" loading="lazy" onclick="lbShow('${m.id}')" />`}</div>`).join('')}</div>
    </div>` : '';
  if (!reports && !strip) return '';
  return `<div class="community-block">${reports}${strip}</div>`;
}

// ---- best-effort photo moderation: block explicit/personal shots (NSFW) so the
// gallery stays about the venue. Lazy-loads a small on-device model; fails open. ----
let _nsfwModel = null, _nsfwTried = false;
function loadScriptOnce(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }
async function getNsfw() {
  if (_nsfwModel || _nsfwTried) return _nsfwModel;
  _nsfwTried = true;
  try {
    if (!window.tf) await loadScriptOnce('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.20.0/dist/tf.min.js');
    if (!window.nsfwjs) await loadScriptOnce('https://cdn.jsdelivr.net/npm/nsfwjs@4.2.1/dist/nsfwjs.min.js');
    _nsfwModel = await window.nsfwjs.load();
  } catch (e) { _nsfwModel = null; }
  return _nsfwModel;
}
async function isInappropriate(dataUrl) {
  const model = await getNsfw();
  if (!model) return false; // model unavailable → don't block
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl; });
    const preds = await model.classify(img);
    const p = Object.fromEntries(preds.map((x) => [x.className, x.probability]));
    return (p.Porn || 0) + (p.Hentai || 0) > 0.6 || (p.Sexy || 0) > 0.9;
  } catch (e) { return false; }
}

// close hour (0–29, where 24–29 = 0–5 AM after midnight) parsed from the hours
// label, so wording can say "late-night" only when the venue really is late.
function closeHour24(v) {
  const lbl = v.hours && (v.hours.closesLabel || v.hours.nextCloseLabel);
  if (!lbl) return null;
  const m = String(lbl).match(/(\d{1,2})(?::(\d\d))?\s*(am|pm)?/i);
  if (!m) return null;
  let h = parseInt(m[1], 10); const ap = (m[3] || '').toLowerCase();
  if (ap === 'pm' && h < 12) h += 12; else if (ap === 'am' && h === 12) h = 0;
  if (h >= 0 && h <= 6) h += 24; // after-midnight closings sort after evening ones
  return h;
}
function bHash(s) { let h = 5381; s = String(s); for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return Math.abs(h); }
// A short, varied "what it is" line — the venue TYPE, what it's good for, its music
// and dress — so every venue reads a little differently (not just "A bar in Florence").
function venueBlurb(v) {
  const kindWord = { Club: 'nightclub', Bar: 'cocktail bar', Rooftop: 'rooftop bar', 'Wine Bar': 'wine bar', Pub: 'pub', Venue: 'live-music venue' }[v.kind] || (v.category === 'Dancing' ? 'club' : 'bar');
  const g = v.lgbtq ? 'LGBTQ+ ' : '';
  // Use the DETERMINISTIC typical genre (musicHint) for the description, never the
  // live report consensus (v.music) — otherwise the blurb changed every time you
  // reopened a venue as reports aged in and out. Genre is a stable venue identity.
  const music = (v.musicHint && typeof v.musicHint === 'string' && v.musicHint.toLowerCase() !== 'mixed') ? v.musicHint : null;
  const ch = closeHour24(v);
  const lateNight = ch != null && ch >= 25; // closes 1 AM or later
  const dress = v.dress && v.dress.code ? v.dress.code : null;
  const pick = (arr) => arr[bHash(v.id) % arr.length];
  const purpose = v.category === 'Dancing'
    ? (lateNight ? pick(['dancing into the early hours', 'a proper late-night dancefloor', 'a big night on the floor'])
      : pick(['dancing and drinks', 'a lively night out', 'music and dancing']))
    : v.kind === 'Wine Bar' ? pick(['wine and small plates', 'a relaxed glass of wine', 'an easy-going evening'])
      : v.kind === 'Rooftop' ? pick(['drinks with a view', 'sunset drinks and a good crowd', 'a rooftop session'])
        : v.kind === 'Pub' ? pick(['pints and a laid-back crowd', 'a casual pint', 'a relaxed drink'])
          : pick(['cocktails and a good crowd', 'drinks and a laid-back night', 'a chilled night out']);
  let s = `A ${g}${kindWord} in ${v.neighborhoodName}, ${v.city} — good for ${purpose}.`;
  if (music) s += ` Expect ${music}.`;
  if (dress === 'Dress to impress') s += ' Dress to impress — the door can be picky.';
  else if (dress === 'Casual / all-black' || dress === 'Casual clubwear') s += ' Casual, dark clubwear fits the vibe.';
  else if (dress === 'Beach & resort') s += ' Beachwear by day, light resort style at night.';
  else if (dress === 'Smart casual' || dress === 'Relaxed smart') s += ' Smart casual — a step up from jeans and a tee.';
  else if (dress) s += ` ${dress}.`;
  return s;
}
// Description ("what it is") + "what people say" pros/cons distilled from Google reviews.
function reviewsBlock(v) {
  const g = v.google, r = g && g.review;
  const full = (r && r.summary) ? r.summary : venueBlurb(v);
  const tags = venueTagline(v);
  const pros = (r && r.pros) || [], cons = (r && r.cons) || [];
  const hasReviews = pros.length || cons.length;
  const chip = (t, cls) => `<span class="rev-chip ${cls}">${cls === 'pro' ? '✓' : '△'} ${esc(t)}</span>`;
  return `<div class="reviews">
    <div class="about-line"><span class="about-lab">About:</span><span class="about-tags">${esc(tags)}</span></div>
    <p class="about-full" hidden>${esc(full)}</p>
    <button class="about-more" onclick="vcMore(this)">More</button>
    ${hasReviews ? `<div class="rev-people">What people say</div>` : ''}
    ${pros.length ? `<div class="rev-chips">${pros.map(p => chip(p, 'pro')).join('')}</div>` : ''}
    ${cons.length ? `<div class="rev-chips cons">${cons.map(c => chip(c, 'con')).join('')}</div>` : ''}
    ${hasReviews ? `<div class="rev-src">From Google reviews</div>` : ''}
  </div>`;
}

// Clubbit mascot that matches how alive the venue is — sleeping when dead, chilling
// with a drink when steady, dancing when busy, going wild when packed.
function mascotFor(score) {
  return score >= 80 ? 'packed' : score >= 55 ? 'busy' : score >= 28 ? 'chill' : 'quiet';
}
// Show the mascot that matches the user's onboarding gender. The man has full
// activity poses (sleeping→dancing); woman / non-binary / other use their own
// mascot for every state (until gendered activity poses exist).
function mascotSrc(score) {
  let g = ''; try { g = (myProfile().gender || '').toLowerCase(); } catch (e) {}
  if (g === 'woman') return '/clubbit-mascot-f.png';
  if (g && g !== 'man') return '/clubbit-mascot-nb.png'; // non-binary / prefer not to say / other
  return '/mascot-' + mascotFor(score) + '.png'; // man (or unset) → activity poses
}
// A short "what it is" line: type · music · dress — the full description hides behind More.
function venueTagline(v) {
  const type = { Club: 'Nightclub', Bar: (v.category === 'Cocktails' ? 'Cocktails' : 'Bar'), Rooftop: 'Rooftop', 'Wine Bar': 'Wine bar', Pub: 'Pub', Venue: 'Live music' }[v.kind] || 'Bar';
  const music = (v.musicHint && v.musicHint !== 'Mixed') ? v.musicHint : null;
  const dress = v.dress && v.dress.code ? v.dress.code : null;
  return [type, music, dress].filter(Boolean).join(' · ');
}
window.vcMore = (btn) => { const p = btn.previousElementSibling; if (!p) return; const open = p.hasAttribute('hidden'); if (open) p.removeAttribute('hidden'); else p.setAttribute('hidden', ''); btn.textContent = open ? 'Less' : 'More'; };

function renderVenue(v, opts) {
  // opts.noAnim: the venue is already on screen (this is the quiet upgrade to the
  // full payload) — render without replaying the entrance animation so it doesn't
  // look like the card "refreshed".
  const still = !!(opts && opts.noAnim);
  const band = bandKey(v.radar.score);
  const bc = BAND_COLOR[band];
  const mc = momClass(v.momentum.state);
  // decision + forecast are only in the full payload (not the cached state snapshot);
  // render those sections only when present so an instant cached card doesn't crash.
  const dec = v.decision || null;
  const decClass = dec ? (dec.verdict === 'GO NOW' ? 'go' : dec.verdict === 'WAIT' ? 'wait' : dec.verdict === 'CLOSED' ? 'closed' : 'your') : 'your';
  const momPct = Math.min(50, Math.abs(v.momentum.M) * 1.6);
  const momDir = v.momentum.M >= 0;
  const fc = (v.forecast && v.forecast.points) || [];
  // only the ACTUAL open session comes back now (no closed hours) — defend against any
  // stale closed points. Bars use their TRUE percent as height (not normalised to the
  // chart's own max) so a bar's size always matches its % and is comparable venue-to-
  // venue — an 83% bar is always taller than a 65% one.
  const fcPts = fc.filter((p) => p.open !== false);
  // when closed, the first bar is the next opening (mins > 0) → the header reads the
  // opening night ("Fri night"); when open it's the live "next N hours" window.
  const fcClosedStart = fcPts.length > 0 && fcPts[0].mins !== 0;
  const fcCount = fcClosedStart ? openSessionLabel(fcPts[0].mins, v.tzOffset) : `next ${fcPts.length} hour${fcPts.length === 1 ? '' : 's'}`;
  const srcLabel = { community: 'COMMUNITY', venue: 'VENUE UPDATE', estimate: 'ESTIMATE', live: 'LIVE', besttime: 'FOOT TRAFFIC', closed: 'CLOSED' }[v.source] || 'ESTIMATE';
  const closed = v.open === false;
  const gRating = v.google && v.google.rating
    ? `<span class="g-rating">★ ${v.google.rating}${v.google.ratings ? ` (${v.google.ratings})` : ''} Google</span>` : '';
  const openChip = v.hours
    ? `<span class="open-chip ${closed ? 'shut' : 'now'}">${closed
        ? (v.season && v.season.closed ? 'Closed for the season · reopens ' + (v.season.reopen || v.hours.opensLabel)
           : 'Closed · opens ' + v.hours.opensLabel) // closing time lives in the Forecast card, not here
        : 'Open now · till ' + v.hours.closesLabel}</span>` : '';
  const seasonTag = v.season ? `<span class="season-tag">☀️ ${esc(v.season.label)}</span>` : '';
  // when the venue is in a different timezone than you, make clear its hours are
  // shown in the VENUE's local time (so "opens 11 PM Fri" is the club's time)
  const userOff = -new Date().getTimezoneOffset() / 60;
  const tzNote = (v.tzOffset != null && v.hours && Math.round(v.tzOffset) !== Math.round(userOff))
    ? `<div class="vc-tznote"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg><span>It's ${esc(v.localTime || '')} there</span></div>`
    : '';
  S.cardEvents = v.tonight || null; // full week's list for the events modal
  const eventBlock = v.tonight ? (() => {
    const ev = v.tonight;
    const when = ev.isTonight ? 'Tonight' : eventDay(ev.date);
    const who = ev.artists && ev.artists.length ? ev.artists.join(', ') : ev.name;
    const cover = ev.image
      ? `<span class="ve-cover"><img src="${esc(ev.image)}" alt="" loading="lazy" onerror="this.parentNode.classList.add('noimg');this.remove()"/></span>`
      : `<span class="ve-cover noimg">🎤</span>`;
    const multi = (ev.count || 1) > 1;
    const inner = `${cover}<span class="ve-txt"><b>${when}${ev.time ? ' · ' + esc(ev.time) : ''}</b><span class="ve-name">${esc(who)}</span>${multi ? `<span class="ve-more">+${ev.more} more this week</span>` : ''}</span>${multi ? `<span class="ve-go">All ${ev.count} ›</span>` : (ev.url ? '<span class="ve-go">Tickets ›</span>' : '')}`;
    return multi
      ? `<button type="button" class="vc-event" onclick="showVenueEvents()">${inner}</button>`
      : `<a class="vc-event"${ev.url ? ` href="${esc(ev.url)}" target="_blank" rel="noopener"` : ''}>${inner}</a>`;
  })() : '';

  const _card = $('#venueCard'); _card.classList.toggle('vc-still', still);
  _card.innerHTML = `
  <div class="vc-grip"><span></span></div>
  <button class="vc-close" onclick="closeVenue()">✕</button>
  <div class="vc-hero">
    <div class="vc-eyebrow">
      <span>${esc(v.neighborhoodName)} · ${esc(v.kind)}</span>
      ${seasonTag}
    </div>
    <div class="vc-headrow">
      ${v.googlePhoto ? `<img class="vc-photo" src="${esc(v.googlePhoto)}" alt="${esc(v.name)}" loading="lazy" onerror="this.remove()" />` : ''}
      <div class="vc-headtext">
        <div class="vc-title">${esc(v.name)} ${v.verified ? '<span style="color:var(--blue);font-size:16px">✓</span>' : ''}</div>
        <div class="vc-status">${openChip}${gRating}</div>
      </div>
    </div>
    ${tzNote}
    ${eventBlock}

    <div class="pr-hero${closed ? ' closed' : ''}">
      <img class="pr-mascot m-${mascotFor(v.radar.score)}" src="${mascotSrc(v.radar.score)}" alt="" />
      <div class="pr-main">
        <div class="pr-top"><span class="pr-num" style="color:${closed ? 'var(--muted)' : bc.core}">${closed ? '—' : v.radar.score}</span>${closed ? '' : `<span class="pr-lab c-${band}">${esc(v.radar.label)}</span>`}</div>
        <div class="pr-track"><i style="width:${Math.max(closed ? 0 : 4, v.radar.score)}%;background:${closed ? 'var(--muted)' : bc.core}"></i></div>
        <div class="pr-sub"><span class="pr-sub-lab">Party Radar</span>${closed ? ' · No live activity' : ''}</div>
      </div>
    </div>
  </div>

  <div class="vc-body">
    ${closed
      ? `<div class="report-cta closed-cta" aria-disabled="true">
          <div class="cc-main">
            <span class="rc-ic">🌙</span>
            <span class="rc-txt"><b>Venue is closed</b><small>Vibe reporting unlocks when the venue opens${v.hours && v.hours.opensLabel ? ' ' + esc(v.hours.opensLabel) : ''}</small></span>
          </div>
          <button class="rc-correct" onclick="reportOpenCorrection('${v.id}', this)">It's actually open</button>
        </div>`
      : `<button class="report-cta" onclick="startReport('${v.id}')">
          <span class="rc-ic">⚡</span>
          <span class="rc-txt"><b>I'm here — report the vibe</b><small>Show everyone what it's like right now</small></span>
          <span class="rc-go">›</span></button>`}
    ${v.liveBusyness != null ? `<div class="live-busy"><span class="lb-dot"></span><b>${v.liveBusyness}%</b> ${v.liveSource === 'live' ? 'busy right now' : "typical for now"} · <span class="lb-src">BestTime</span></div>` : ''}
    <div class="stat-grid four">
      <div class="stat"><div class="k">How full</div><div class="v">${closed ? '—' : v.fullness.est + '%'}</div>
        <div class="vs">${closed ? 'Unavailable' : 'Est. ' + v.fullness.low + '–' + v.fullness.high + '%'}</div></div>
      <div class="stat"><div class="k">Queue</div><div class="v">${closed ? '—' : queueText(v.queue || 'none')}</div>
        <div class="vs">${closed ? 'Unavailable' : (v.queueEstimated ? 'Estimated' : 'Reported')}</div></div>
      <div class="stat"><div class="k">Entry</div><div class="v">${entryText(v)}</div>
        ${v.special ? `<div class="vs c-busy">${esc(v.special)}</div>` : `<div class="vs">${v.entryEstimated ? 'Typical' : 'Reported'}</div>`}</div>
      <div class="stat"><div class="k">Music</div><div class="v" style="font-size:15px">${esc(v.musicHint || v.music || 'Mixed')}</div>
        <div class="vs">Typical genre</div></div>
    </div>

    ${v.owner ? `<div class="owner-note"><b>Venue update</b> · ${ago(v.owner.ageMin)} ago: status ${esc(v.owner.status)}${v.owner.lastEntry ? ' · last entry ' + esc(v.owner.lastEntry) : ''}</div>` : ''}

    ${reviewsBlock(v)}

    ${v.dress ? `<div class="dress"><span class="dress-ic">👔</span><div class="dress-txt"><b>Dress code · ${esc(v.dress.code)}</b><div class="dress-tip">${esc(v.dress.tip)}</div></div></div>` : ''}

    ${(fcPts.length || dec) ? `<div class="forecast${closed ? ' fc-closed' : ''}">
      ${fcPts.length ? `<div class="section-h"><h3>Forecast</h3><span class="count">${esc(fcCount)}</span></div>
      <div class="fc-bars">
        ${(() => { const closedStart = fcPts.length > 0 && fcPts[0].mins !== 0; // no "Now" bar → first bar is the opening hour
          return fcPts.map((p, i) => { const h = Math.max(3, Math.min(100, p.pct)); return `<div class="fc-col${p.mins === 0 ? ' now' : ''}${p.peak ? ' peak' : ''}" style="--i:${i}">
          <div class="fc-track"><div class="fc-bar" style="height:${h}%"></div><span class="fc-pct" style="bottom:calc(${h}% + 5px)">${p.pct}%</span></div>
          <div class="fc-lab">${esc(p.label)}</div>${(closedStart && i === 0) ? `<span class="fc-opens">opens</span>` : ''}${p.closes ? `<span class="fc-closes">closes</span>` : ''}</div>`; }).join(''); })()}
      </div>
      ${v.expectedPeak ? `<div class="peak-flag"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M12 2.6l2.9 5.87 6.48.94-4.69 4.57 1.11 6.45L12 17.9l-5.79 3.05 1.1-6.45L2.63 9.94l6.48-.94z"/></svg>Expected peak <b>${esc(v.expectedPeak)}</b></div>` : ''}` : ''}
      ${dec ? `<div class="decision ${decClass}">
        <div class="dec-verdict">${(dec.verdict === 'GO NOW' ? '✓ ' : dec.verdict === 'WAIT' ? '◷ ' : dec.verdict === 'CLOSED' ? '🌙 ' : '') + titleCase(dec.verdict)}</div>
        <div class="dec-head">${esc(dec.headline)}</div>
        <ul class="dec-reasons">${(dec.reasons || []).map(r => `<li>${esc(r)}</li>`).join('')}</ul>
      </div>` : ''}
    </div>` : ''}

    ${v._checkedIn ? `<div class="pulse-row"><span class="pq">Still popping?</span>
      <button class="pulse-btn" onclick="sendPulse('${v.id}','busier')">Busier</button>
      <button class="pulse-btn" onclick="sendPulse('${v.id}','yes')">Yes</button>
      <button class="pulse-btn" onclick="sendPulse('${v.id}','slowing')">Slowing</button></div>` : ''}

    <div class="vc-actions">
      <button class="btn btn-primary full" onclick="takeMeThere('${v.id}')">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg>
        Take me there</button>
      <div class="vc-actrow">
        ${v.instagram ? `<button class="btn btn-ig-out" onclick="openInsta('${v.id}')">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" stroke="none"/></svg>
          Instagram</button>` : ''}
        <button class="btn btn-save2${isSaved(v.id) ? ' on' : ''}" onclick="toggleSave('${v.id}',this)"><svg class="bs-star" viewBox="0 0 24 24" width="16" height="16" style="vertical-align:-3px;margin-right:5px"><path d="M12 2.6l2.9 5.87 6.48.94-4.69 4.57 1.11 6.45L12 17.9l-5.79 3.05 1.1-6.45L2.63 9.94l6.48-.94z"/></svg><span class="bs-txt">${isSaved(v.id) ? 'Saved' : 'Save'}</span></button>
      </div>
    </div>

    ${communityBlock(v)}

    <div class="note">Anonymous and aggregated · no individual locations are ever shown</div>
  </div>`;
}
function titleCase(s) { s = String(s).toLowerCase(); return s.charAt(0).toUpperCase() + s.slice(1); }

// SVG conic-style dial for the radar score
function dial(score, color) {
  const r = 42, circ = 2 * Math.PI * r, off = circ * (1 - score / 100);
  return `<svg width="96" height="96" viewBox="0 0 96 96">
    <circle cx="48" cy="48" r="${r}" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="7"/>
    <circle cx="48" cy="48" r="${r}" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round"
      stroke-dasharray="${circ}" stroke-dashoffset="${off}" transform="rotate(-90 48 48)"
      style="filter:drop-shadow(0 0 6px ${color});transition:stroke-dashoffset .6s"/>
    </svg>
    <div class="pr-num"><b>${score}</b><small>/ 100</small></div>`;
}

/* ============================================================
   AREA DETAIL (reuse venue overlay container)
   ============================================================ */
async function openArea(id) {
  map.selected = null; closeSheet();
  const area = S.data.areas.find(a => a.id === id);
  if (area) map.focusArea(area);
  const full = await API.area(id);
  const band = bandKey(full.nightScore);
  const ov = $('#venueOverlay'); ov.hidden = false;
  $('#venueCard').innerHTML = `
    <div class="vc-grip"><span></span></div>
    <button class="vc-close" onclick="closeVenue()">✕</button>
    <div class="vc-hero">
      <div class="vc-eyebrow"><span class="src-tag bg-${band}">${full.hotzone ? 'Hot zone' : 'Area'}</span><span>${esc(full.city)}</span></div>
      <div class="vc-title">${esc(full.name)}</div>
      <div class="pr-block">
        <div class="pr-num" style="color:${BAND_COLOR[band].core}">${full.nightScore}</div>
        <div class="pr-right">
          <div class="pr-label c-${band}">${esc(full.label)}</div>
          <div class="pr-track"><i style="width:${full.nightScore}%;background:${BAND_COLOR[band].core}"></i></div>
          <div class="pr-sub"><span class="lab">Night score</span>
            ${full.popping ? `<span>${full.popping} popping</span>` : ''}${full.packed ? `<span>· ${full.packed} packed</span>` : ''}${full.surging ? `<span>· ${full.surging} surging</span>` : ''}</div>
        </div>
      </div>
    </div>
    <div class="vc-body">
      <div class="peak-flag" style="margin-top:2px">★ Peak window <b style="margin-left:4px">${esc(full.peakWindow)}</b> · Best for ${full.bestFor.join(' · ')}</div>
      <div class="section-h" style="margin-top:16px"><h3>Venues</h3><span class="count">${full.venues.length}</span></div>
      ${full.venues.map(venueRow).join('')}
    </div>`;
}

/* ============================================================
   CHECK-IN + PULSE
   ============================================================ */
async function checkIn(id) {
  const btn = $('#hereBtn'); if (btn) { btn.disabled = true; btn.textContent = 'Checking in…'; }
  const venue = S.data.venues.find(v => v.id === id);
  const coords = await locationFor(venue);
  const res = await API.checkin(id, coords);
  if (res.accepted) {
    toast('📍 Checked in — you\'re on the radar');
    const v = res.venue; v._checkedIn = true;
    renderVenue(v);
  } else {
    const msg = { duplicate: 'Already checked in here recently', too_far: 'You\'re too far from this venue', rate_limited: 'Slow down a moment' }[res.reason] || 'Could not check in';
    toast('⚠️ ' + msg);
    if (btn) { btn.disabled = false; btn.textContent = "I'm here"; }
  }
  refreshSoon();
}
async function sendPulse(id, state) {
  await API.pulse(id, state);
  toast({ busier: '🤯 Even busier — logged', yes: '🔥 Still popping — logged', slowing: '🙂 Slowing down — logged' }[state]);
  refreshSoon();
}

/* ============================================================
   REPORT THE VIBE — fast multi-step flow
   ============================================================ */
const REPORT_STEPS = [
  { key: 'vibe', q: 'How is it?', required: true, grid: false, opts: [
    { v: 'dead', m: '/mascot-quiet.png', l: 'Dead', s: 'Almost empty' },
    { v: 'chill', m: '/mascot-chill.png', l: 'Chill', s: 'Relaxed crowd' },
    { v: 'popping', m: '/mascot-busy.png', l: 'Popping', s: 'Busy and lively' },
    { v: 'packed', m: '/mascot-packed.png', l: 'Packed', s: 'Very crowded' }] },
  { key: 'media', q: 'Add a photo or video', type: 'media', required: true },
  { key: 'queue', q: 'Queue?', grid: false, opts: [
    { v: 'none', l: 'None' }, { v: '<10', l: 'Under 10 min' }, { v: '10-20', l: '10–20 min' },
    { v: '20-30', l: '20–30 min' }, { v: '30+', l: '30+ min' }] },
  { key: 'entry', q: 'Entry?', grid: false, opts: [
    { v: 0, l: 'Free' }, { v: 5, l: '€5' }, { v: 10, l: '€10' }, { v: 15, l: '€15' },
    { v: 20, l: '€20+' }, { v: 'guestlist', l: 'Guest list' }, { v: 'other', l: 'Other' }] },
  { key: 'mix', q: 'Crowd mix?', grid: false, optional: true, opts: [
    { v: 'more_women', l: 'More women', m: '/clubbit-mascot-f.png', s: 'Mostly women' },
    { v: 'even', l: 'Even mix', m: '/mascot-pair.png', s: 'Balanced crowd' },
    { v: 'more_men', l: 'More men', m: '/clubbit-mascot.png', s: 'Mostly men' }] },
  { key: 'music', q: 'Music right now?', grid: true, optional: true, opts: [
    { v: 'House', l: 'House', c: 'house' }, { v: 'Techno', l: 'Techno', c: 'techno' }, { v: 'Hip-Hop', l: 'Hip-hop', c: 'hiphop' },
    { v: 'R&B', l: 'R&B', c: 'rnb' }, { v: 'Afrobeats', l: 'Afrobeats', c: 'afro' }, { v: 'Commercial', l: 'Commercial', c: 'comm' },
    { v: 'Latin', l: 'Latin', c: 'latin' }, { v: 'Other', l: 'Other', c: 'other' }] },
  { key: 'note', q: 'Anything to add?', type: 'note', optional: true },
];
const R = { venueId: null, step: 0, answers: {}, media: null };
function startReport(id) {
  closeVenue();
  R.venueId = id; R.step = 0; R.answers = {}; R.media = null;
  $('#reportOverlay').hidden = false;
  renderReport();
}
function closeReport() { $('#reportOverlay').hidden = true; }
// "It's actually open" on a CLOSED venue — an opening-hours correction/verification
// signal ONLY. It never submits a vibe report and never flips the venue to open on a
// single tap; the server just records that the listed hours may be wrong.
async function reportOpenCorrection(id, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Thanks — flagged'; }
  try { await API.hoursFlag(id); } catch (e) {}
  toast("Thanks — we'll double-check the hours");
}
window.reportOpenCorrection = reportOpenCorrection;
// small "people in line" cue for the queue step — n dots filled (0–4), growing with
// the wait; a subtle Clubbit motif instead of an emoji
function queueDots(n) {
  let s = '<span class="q-ic"><svg class="q-dots" viewBox="0 0 58 12" width="46" height="10" aria-hidden="true">';
  for (let i = 0; i < 4; i++) s += `<circle cx="${6 + i * 15}" cy="6" r="4" class="${i < n ? 'on' : 'off'}"/>`;
  return s + '</svg></span>';
}
// Left-side indicator for the stacked answer steps (queue + entry): a 4-dot
// intensity ramp for levels, a star for guest list, a neutral dash for "other".
// Returns { cls, html } — cls reuses the queue q0–q4 classes so the colour ramp,
// card tint and dot colours are shared across both steps.
const REP_STAR_SVG = '<span class="q-ic"><svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true"><path d="M12 2.6l2.9 5.87 6.48.94-4.69 4.57 1.11 6.45L12 17.9l-5.79 3.05 1.1-6.45L2.63 9.94l6.48-.94z"/></svg></span>';
const REP_DASH_SVG = '<span class="q-ic"><svg viewBox="0 0 24 12" width="20" height="10" aria-hidden="true"><rect x="4" y="5" width="16" height="2.4" rx="1.2" fill="currentColor"/></svg></span>';
function reportIndicator(step, o, i) {
  if (step.key === 'queue') return { cls: ' q-opt q' + i, html: queueDots(i) };
  if (step.key === 'entry') {
    const tier = { 0: 0, 5: 1, 10: 2, 15: 3, 20: 4 }[o.v];
    if (tier != null) return { cls: ' q-opt q' + tier, html: queueDots(tier) };
    if (o.v === 'guestlist') return { cls: ' q-opt e-guest', html: REP_STAR_SVG };
    return { cls: ' q-opt e-other', html: REP_DASH_SVG }; // Other
  }
  return { cls: '', html: '' };
}
function renderReport() {
  $('#reportOverlay').classList.remove('vibe');
  const venue = S.data.venues.find(v => v.id === R.venueId);
  const step = REPORT_STEPS[R.step];
  $('#reportOverlay').classList.toggle('mstep', step.type === 'media'); // media-step spacing tweaks
  $('#reportOverlay').classList.toggle('qstep', step.key === 'queue');   // queue-step spacing tweaks
  $('#reportOverlay').classList.toggle('estep', step.key === 'entry');   // entry has 7 options → a bit more compact
  $('#reportOverlay').classList.toggle('mixstep', step.key === 'mix');   // big mascots → reclaim top space
  $('#reportOverlay').classList.toggle('musicstep', step.key === 'music'); // 2-col genre cards
  $('#reportOverlay').classList.toggle('notestep', step.type === 'note');  // free-text note step
  const sel = R.answers[step.key];
  const inner = $('#reportInner');
  const hint = step.type === 'media' ? "Show what it's like right now"
    : step.type === 'note' ? 'Optional. A few words about the venue or the night. (max 500)'
    : step.optional ? 'Optional. Tap to add, or skip' : 'Tap your answer';
  // localise the entry-price chips to the venue's currency (€10 → 1000 din, etc.)
  const opts = (step.opts && step.key === 'entry' && venue) ? step.opts.map((o) =>
    (typeof o.v === 'number' && o.v > 0) ? { ...o, l: fmtCur(o.v, venue.currency) + (o.v >= 20 ? '+' : '') } : o) : step.opts;
  const noteVal = R.answers.note || '';
  // free-text "Other" input for entry (custom price) and music (custom genre)
  const otherInput =
    (step.key === 'entry' && sel === 'other')
      ? `<div class="rep-other"><input id="repOther" type="number" inputmode="numeric" min="0" max="500" placeholder="Enter amount" value="${R.answers.entryOther != null ? esc(String(R.answers.entryOther)) : ''}" /></div>`
      : (step.key === 'music' && sel === 'Other')
      ? `<div class="rep-other"><input id="repOther" type="text" maxlength="24" placeholder="Type the genre" value="${R.answers.musicOther ? esc(R.answers.musicOther) : ''}" /></div>`
      : '';
  const mid = step.type === 'media' ? mediaStepHtml()
    : step.type === 'note' ? `<div class="rep-note">
        <textarea id="repNote" maxlength="500" placeholder="e.g. great crowd, easy door, live DJ till late…">${esc(noteVal)}</textarea>
        <span class="rep-note-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg></span>
        <div class="rep-notecount"><span id="noteCount">${noteVal.length}</span>/500</div>
      </div>`
    : `<div class="${step.grid ? 'rep-grid' : 'rep-opts'}${step.key === 'music' ? ' music' : ''}">
      ${opts.map((o, i) => { const val = typeof o.v === 'number' ? o.v : `'${o.v}'`; const on = sel === o.v ? ' sel' : '';
        // vibe options render as branded mascot cards (mascot · label · helper · check)
        if (o.m) return `<button class="rep-opt vibe v-${o.v}${on}" onclick="pickReport('${step.key}', ${val})"><span class="rvm-wrap"><img class="rvm" src="${o.m}" alt="" onerror="this.style.visibility='hidden'" /></span><span class="rv-txt"><b>${o.l}</b>${o.s ? `<small>${esc(o.s)}</small>` : ''}</span><span class="rv-check">✓</span></button>`;
        // music: same card system with a subtle per-genre colour dot on the left
        const gc = (step.key === 'music' && o.c) ? ` m-${o.c}` : '';
        const sw = (step.key === 'music') ? '<span class="m-dot" aria-hidden="true"></span>' : '';
        // queue + entry: full-width cards with a left intensity/level indicator
        const ind = reportIndicator(step, o, i);
        return `<button class="rep-opt ${step.grid ? 'sm' : ''}${ind.cls}${gc}${(o.v === 'other' || o.wide) ? ' wide' : ''}${on}" onclick="pickReport('${step.key}', ${val})">${ind.html}${sw}${o.e ? `<span class="emoji">${o.e}</span>` : ''}<span>${o.l}</span></button>`;
      }).join('')}
      ${otherInput}
    </div>`;
  inner.innerHTML = `
    <div class="rep-head">
      <div class="rep-venue">Reporting · <b>${esc(venue.name)}</b></div>
      <div class="rep-head-r"><span class="rep-count">${R.step + 1} of ${REPORT_STEPS.length}</span><button class="rep-x" onclick="closeReport()">✕</button></div>
    </div>
    <div class="rep-progress">${REPORT_STEPS.map((_, i) => `<i class="${i < R.step ? 'on' : i === R.step ? 'on cur' : ''}"></i>`).join('')}</div>
    <div class="rep-q">${step.q}</div>
    <div class="rep-hint">${hint}</div>
    ${mid}
    ${step.optional ? `<div class="rep-skiprow"><button class="rep-skiplink" onclick="nextReport(true)">Skip</button></div>` : ''}
    <div class="rep-nav">
      ${R.step > 0 ? `<button class="rep-skip" onclick="prevReport()">Back</button>` : ''}
      <button class="rep-next" ${sel == null ? 'disabled' : ''} onclick="nextReport()">
        ${R.step === REPORT_STEPS.length - 1 ? 'Submit' : 'Next'}</button>
    </div>`;
  if (step.type === 'media') wireMediaStep();
  if (step.type === 'note') {
    const ta = $('#repNote');
    if (ta) { ta.oninput = () => { R.answers.note = ta.value; const c = $('#noteCount'); if (c) c.textContent = ta.value.length; const nx = $('#reportInner .rep-next'); if (nx) nx.disabled = ta.value.trim().length === 0; }; }
  }
  const other = $('#repOther');
  if (other) {
    other.focus();
    other.oninput = () => {
      if (step.key === 'entry') { const n = parseInt(other.value, 10); R.answers.entryOther = (isFinite(n) && n >= 0) ? Math.min(n, 500) : null; }
      else if (step.key === 'music') { R.answers.musicOther = other.value.trim().slice(0, 24) || null; }
    };
  }
}

function mediaStepHtml() {
  const m = R.media;
  if (m) {
    const preview = m.type === 'video'
      ? `<video class="media-preview" src="${m.dataUrl}" muted playsinline autoplay loop></video><span class="md-play" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span>`
      : `<img class="media-preview" src="${m.dataUrl}" alt="preview" />`;
    return `<div class="rep-media">
      <input type="file" id="mediaInput" accept="image/*,video/*" style="display:none" />
      <div class="media-drop has">${preview}<span class="md-check" aria-hidden="true">✓</span><span class="md-added">Added</span></div>
      <button class="media-retake" id="mediaRetake">Choose a different one</button>
    </div>`;
  }
  return `<div class="rep-media">
    <input type="file" id="mediaInput" accept="image/*,video/*" style="display:none" />
    <div class="md-req">Required</div>
    <div class="media-drop">
      <span class="md-cam"><img src="/report-camera.png" alt="" onerror="this.parentNode.style.display='none'" /></span>
      <span class="md-t">Add a photo or video</span>
      <div class="md-actions">
        <button class="md-act primary" id="mediaPhoto"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>Take a photo</button>
        <button class="md-act" id="mediaVideo"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>Record a video</button>
        <button class="md-act" id="mediaGallery"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.6"/><path d="M21 15l-5-5L5 21"/></svg>Choose from gallery</button>
      </div>
    </div>
  </div>`;
}
const REPORT_GEO_RADIUS_M = 300; // must be within ~300m of the venue to attach media
// Flip to true to require the reporter to be physically at the venue before adding a
// photo/video. Off for now so the report flow can be walked through from anywhere.
const REPORT_REQUIRE_AT_VENUE = false;
// Confirm the reporter is physically at the venue before letting them take or upload
// a photo/video — a vibe report has to come from the actual spot, not staged elsewhere.
async function ensureAtVenue() {
  if (!REPORT_REQUIRE_AT_VENUE) return { ok: true }; // location check disabled
  const venue = S.data && S.data.venues.find((v) => v.id === R.venueId);
  if (!venue || !venue.coords) return { ok: true };
  // if the device genuinely can't read location, don't lock people out of reporting
  const canGeo = hasNativeGeo() || (navigator.geolocation && window.isSecureContext);
  if (!canGeo) return { ok: true };
  let loc;
  try {
    const p = await getPosition({ enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
    loc = { lat: p.coords.latitude, lng: p.coords.longitude };
    S.userLoc = loc; S._userIsGps = true;
  } catch (e) { return { ok: false, noGps: true, venue }; }
  const dist = haversineKm(loc, venue.coords) * 1000; // metres
  return { ok: dist <= REPORT_GEO_RADIUS_M, dist, venue };
}
function wireMediaStep() {
  const inp = $('#mediaInput'); if (!inp) return;
  inp.onchange = onMediaPick;
  // Give the camera an explicit mode — accepting BOTH image + video WITH capture makes
  // many Android devices open a video-only camera, so photo capture asks for image/*
  // only and video capture for video/* only. Gallery uses no capture.
  const openPicker = async (accept, capture) => {
    if (REPORT_REQUIRE_AT_VENUE) {
      toast('Checking you’re at the venue…', 1000);
      const chk = await ensureAtVenue();
      if (!chk.ok) {
        if (chk.noGps) { toast('Turn on location so we can confirm you’re at the venue — report photos have to be taken there', 4000); }
        else { const away = chk.dist >= 1000 ? (chk.dist / 1000).toFixed(1) + ' km' : Math.round(chk.dist) + ' m'; toast(`You need to be at ${chk.venue.name} to add a photo — you’re about ${away} away`, 4000); }
        return;
      }
    }
    inp.setAttribute('accept', accept);
    if (capture) inp.setAttribute('capture', 'environment'); else inp.removeAttribute('capture');
    inp.click();
  };
  const photo = $('#mediaPhoto'); if (photo) photo.onclick = () => openPicker('image/*', true);
  const video = $('#mediaVideo'); if (video) video.onclick = () => openPicker('video/*', true);
  const gal = $('#mediaGallery'); if (gal) gal.onclick = () => openPicker('image/*,video/*', false);
  const rt = $('#mediaRetake'); if (rt) rt.onclick = () => { R.media = null; delete R.answers.media; renderReport(); };
}
async function onMediaPick(e) {
  const f = e.target.files && e.target.files[0]; if (!f) return;
  if (f.type.startsWith('image/')) {
    const dataUrl = await compressImage(f);
    if (!dataUrl) return toast('Could not read that image');
    if (await isInappropriate(dataUrl)) { toast('Please post a photo of the venue — explicit or personal photos aren’t allowed', 3200); return; }
    R.media = { type: 'image', dataUrl };
  } else if (f.type.startsWith('video/')) {
    if (f.size > 13 * 1024 * 1024) return toast('Video too large — keep it under ~13 MB');
    R.media = { type: 'video', dataUrl: await fileToDataUrl(f) };
  } else { return toast('Please choose a photo or video'); }
  R.answers.media = R.media.type;
  renderReport();
}
function fileToDataUrl(file) {
  return new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(null); r.readAsDataURL(file); });
}
function compressImage(file) {
  return new Promise((res) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 1280; let w = img.naturalWidth, h = img.naturalHeight;
      const s = Math.min(1, max / Math.max(w, h)); w = Math.round(w * s); h = Math.round(h * s);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      try { res(c.toDataURL('image/jpeg', 0.82)); } catch { res(null); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); res(null); };
    img.src = url;
  });
}
function pickReport(key, val) {
  R.answers[key] = val;
  renderReport(); // just select — the user taps Next to move on
}
function prevReport() { if (R.step > 0) { R.step--; renderReport(); } }
function nextReport(skip) {
  if (skip) delete R.answers[REPORT_STEPS[R.step].key];
  const step = REPORT_STEPS[R.step];
  if (!step.optional && R.answers[step.key] == null) return;
  if (R.step < REPORT_STEPS.length - 1) { R.step++; renderReport(); }
  else submitReport();
}
async function submitReport() {
  const venue = S.data.venues.find(v => v.id === R.venueId);
  const coords = await locationFor(venue);
  const a = R.answers;
  // attach the reporter's identity + current tier so it shows as "Nick, 26 · Scout reported"
  const prof = myProfile();
  const beforeCount = reportCount();
  const myLevel = levelFor(beforeCount);
  const reporter = { name: prof.firstName || null, age: prof.calculatedAge || null, tag: myLevel.name, photo: myFace(prof) };
  const entryVal = a.entry === 'other' ? (a.entryOther != null ? a.entryOther : null) : a.entry;
  const musicVal = a.music === 'Other' ? (a.musicOther || null) : a.music;
  const payload = { venueId: R.venueId, vibe: a.vibe, queue: a.queue, entry: entryVal, mix: a.mix, music: musicVal, note: (a.note || '').trim().slice(0, 500) || null, coords, media: R.media, reporter };
  $('#reportOverlay').classList.remove('vibe');
  $('#reportInner').innerHTML = `<div class="rep-done"><div class="big">•••</div><h2>Sending…</h2></div>`;
  const res = await API.report(payload);
  if (res && res.error) { toast(res.needMedia ? 'A photo or video is required' : ('Could not send: ' + res.error)); R.step = 1; renderReport(); return; }
  // level up: count this contribution and see if we crossed a tier
  setReportCount(beforeCount + 1);
  const newLevel = levelFor(beforeCount + 1);
  const leveledUp = newLevel.name !== myLevel.name;
  const badge = res.badges && res.badges.length ? res.badges[res.badges.length - 1] : null;
  $('#reportInner').innerHTML = `<div class="rep-done">
    <div class="rd-fx" aria-hidden="true">
      <span class="rd-beam b1"></span><span class="rd-beam b2"></span>
      <span class="rd-orb o1"></span><span class="rd-orb o2"></span><span class="rd-orb o3"></span>
      <i class="rd-spark s1"></i><i class="rd-spark s2"></i><i class="rd-spark s3"></i><i class="rd-spark s4"></i><i class="rd-spark s5"></i><i class="rd-spark s6"></i>
    </div>
    <div class="rd-mascotwrap"><img class="rd-mascot solo" src="/mascot-busy.png" alt="" onerror="this.style.display='none'" /></div>
    <h2>All good to go <img class="rd-title-cam" src="/report-camera.png" alt="" onerror="this.style.display='none'" /></h2>
    <p class="rd-sub">Thanks, you're on the radar.<br>Now go enjoy the club!</p>
    ${leveledUp
      ? `<div class="rep-badge">${newLevel.emoji}<span>Level up! You're now a <b>${esc(newLevel.name)}</b></span></div>`
      : `<div class="rep-levelnote">${newLevel.emoji} <b>${esc(newLevel.name)}</b>${newLevel.next ? ` <span class="rl-sep">·</span> <span class="rl-next">${newLevel.next.min - newLevel.count} more to ${esc(newLevel.next.name)}</span>` : ` <span class="rl-sep">·</span> <span class="rl-next">max level</span>`}</div>`}
    ${badge ? `<div class="rep-badge">🏅 ${esc(badge)} unlocked</div>` : ''}
    <div class="rd-donerow"><button class="rep-next" onclick="afterReport('${R.venueId}')">Done</button></div>
  </div>`;
  refreshSoon();
}
function afterReport(id) { closeReport(); openVenue(id); }

// open Google Maps directions to the ACTUAL bar — routed by its name (and exact
// Google place id when we have it), never the approximate map pin.
// Venues whose name/neighborhood defeats an automatic Maps match get a hand-verified
// destination query here (keyed by exact venue name). These always win.
const MAPS_OVERRIDE = {
  'Le Dépôt': 'Le Dépôt, 10 Rue aux Ours, 75003 Paris', // not a Google business listing; pin the address
};
function mapsTypeWord(v) {
  const g = v.lgbtq ? 'gay ' : '';
  if (v.kind === 'Club' || v.category === 'Dancing') return g + 'nightclub';
  if (v.kind === 'Rooftop' || v.category === 'Rooftops') return g + 'rooftop bar';
  if (v.kind === 'Venue' || v.category === 'Live') return g + 'music venue';
  if (v.kind === 'Wine Bar' || v.category === 'Wine') return g + 'wine bar';
  return g + 'bar';
}
function openInsta(id) {
  // the server endpoint resolves the real profile (cached) and redirects
  window.open('/api/ig/' + id, '_blank', 'noopener');
}
function takeMeThere(id) {
  const v = (S.activeVenueData && S.activeVenueData.id === id ? S.activeVenueData : (S.data.venues || []).find((x) => x.id === id));
  if (!v) return toast('Location unavailable');
  // hand-verified destination for venues that resolve wrong automatically
  if (MAPS_OVERRIDE[v.name]) {
    window.open('https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(MAPS_OVERRIDE[v.name]), '_blank', 'noopener');
    return;
  }
  const pid = v.google && v.google.placeId;
  // For LGBTQ+ venues, a bare place id / name can land on a same-named straight or
  // strip venue (e.g. "Pleasure" Belgrade → a strip club). Always route those by a
  // gay-qualified name query so Maps picks the right place. For everyone else, use
  // the exact place id when we have it; otherwise a type-qualified name query so
  // Maps routes to e.g. "Drugstore nightclub" (the club), never a pharmacy.
  let url;
  if (v.lgbtq || !pid) {
    const q = [`${v.name} ${mapsTypeWord(v)}`, v.neighborhoodName, v.city].filter(Boolean).join(', ');
    url = 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(q);
  } else {
    const q = [v.name, v.neighborhoodName, v.city].filter(Boolean).join(', ');
    url = 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(q) + '&destination_place_id=' + encodeURIComponent(pid);
  }
  window.open(url, '_blank', 'noopener');
}

/* ============================================================
   LIVE DATA + boot
   ============================================================ */
let map;

// category filters shown as chips over the map
const FILTERS = [
  { k: 'all', label: 'All' },
  { k: 'open', label: 'Open now', pred: (v) => v.open },
  { k: 'club', label: 'Clubs', kinds: ['Club'] },
  { k: 'bar', label: 'Bars', kinds: ['Bar', 'Wine Bar'] },
  { k: 'rooftop', label: 'Rooftops', kinds: ['Rooftop'] },
  { k: 'live', label: 'Live Music', kinds: ['Venue'] },
  { k: 'lgbtq', label: 'LGBTQ+', pred: (v) => v.lgbtq },
];
function filterHit(f, v) { return f.pred ? f.pred(v) : f.kinds.includes(v.kind); }
function matchFilter(v) {
  const f = FILTERS.find((x) => x.k === S.filter);
  return !f || f.k === 'all' || filterHit(f, v);
}
// city → country (+ region aliases) so searching a country/region finds its venues
const CITY_COUNTRY = {
  Athens:'Greece', Thessaloniki:'Greece', Mykonos:'Greece', Santorini:'Greece', Heraklion:'Greece Crete', Chania:'Greece Crete', Patras:'Greece', Rhodes:'Greece', Corfu:'Greece', Nafplio:'Greece', Zakynthos:'Greece Zante', Malia:'Greece Crete',
  London:'UK England', Manchester:'UK England', Birmingham:'UK England', Leeds:'UK England', Liverpool:'UK England', Bristol:'UK England', Newcastle:'UK England', Edinburgh:'UK Scotland', Glasgow:'UK Scotland', Sheffield:'UK England', Cardiff:'UK Wales', Belfast:'UK Northern Ireland', Dublin:'Ireland',
  Lisbon:'Portugal', Porto:'Portugal', Albufeira:'Portugal Algarve',
  Barcelona:'Spain', Madrid:'Spain', Valencia:'Spain', Seville:'Spain', Ibiza:'Spain Balearics', Magaluf:'Spain Mallorca Balearics',
  Rome:'Italy', Milan:'Italy',
  Berlin:'Germany', Munich:'Germany', Cologne:'Germany', Hamburg:'Germany', Frankfurt:'Germany', Leipzig:'Germany',
  Paris:'France', Lyon:'France', Marseille:'France', Nice:'France',
  Amsterdam:'Netherlands', Rotterdam:'Netherlands', Brussels:'Belgium', Antwerp:'Belgium', Ghent:'Belgium',
  Zurich:'Switzerland', Geneva:'Switzerland', Vienna:'Austria', Prague:'Czechia', Budapest:'Hungary',
  Warsaw:'Poland', 'Kraków':'Poland', 'Poznań':'Poland', Sopot:'Poland',
  Bucharest:'Romania', Mamaia:'Romania', Sofia:'Bulgaria', 'Sunny Beach':'Bulgaria',
  Belgrade:'Serbia', Zagreb:'Croatia', Hvar:'Croatia', Novalja:'Croatia', Ljubljana:'Slovenia', Bratislava:'Slovakia', Sarajevo:'Bosnia', Tirana:'Albania', Budva:'Montenegro', Pristina:'Kosovo', 'Chișinău':'Moldova', Kyiv:'Ukraine',
  Moscow:'Russia', 'Saint Petersburg':'Russia', Minsk:'Belarus', Vilnius:'Lithuania', Riga:'Latvia', Tallinn:'Estonia',
  Tbilisi:'Georgia', Yerevan:'Armenia', Baku:'Azerbaijan',
  Helsinki:'Finland', Stockholm:'Sweden', Copenhagen:'Denmark', Oslo:'Norway', Reykjavik:'Iceland', Luxembourg:'Luxembourg',
  'Ayia Napa':'Cyprus', Istanbul:'Turkey', Beirut:'Lebanon', 'Tel Aviv':'Israel', Dubai:'UAE Emirates',
  'New York':'USA United States', Miami:'USA United States Florida', 'Los Angeles':'USA United States California', 'Las Vegas':'USA United States Nevada', Chicago:'USA United States', 'San Francisco':'USA United States California', Detroit:'USA United States', Washington:'USA United States', Atlanta:'USA United States', Austin:'USA United States Texas', 'New Orleans':'USA United States', Houston:'USA United States Texas', Dallas:'USA United States Texas', 'San Antonio':'USA United States Texas',
  Nashville:'USA United States Tennessee', Denver:'USA United States Colorado', 'Kansas City':'USA United States Missouri', 'St. Louis':'USA United States Missouri', Minneapolis:'USA United States Minnesota', Indianapolis:'USA United States Indiana', Columbus:'USA United States Ohio', Memphis:'USA United States Tennessee', Milwaukee:'USA United States Wisconsin', 'Oklahoma City':'USA United States Oklahoma', 'Salt Lake City':'USA United States Utah', Cincinnati:'USA United States Ohio', Phoenix:'USA United States Arizona Scottsdale',
  Montreal:'Canada', Toronto:'Canada', Vancouver:'Canada',
  'Mexico City':'Mexico', 'Cancún':'Mexico', Tulum:'Mexico', 'Panama City':'Panama', 'San José':'Costa Rica', 'Guatemala City':'Guatemala', 'San Salvador':'El Salvador', Havana:'Cuba', 'San Juan':'Puerto Rico',
  'Bogotá':'Colombia', 'Medellín':'Colombia', Cartagena:'Colombia', Lima:'Peru', Santiago:'Chile', 'Buenos Aires':'Argentina', Montevideo:'Uruguay', 'São Paulo':'Brazil', 'Rio de Janeiro':'Brazil', 'Camboriú':'Brazil',
  Bangkok:'Thailand', Phuket:'Thailand', 'Koh Samui':'Thailand Islands', 'Koh Phangan':'Thailand Islands Full Moon', 'Koh Tao':'Thailand Islands', Krabi:'Thailand', 'Koh Phi Phi':'Thailand Islands', 'Ho Chi Minh City':'Vietnam', Hanoi:'Vietnam', Tokyo:'Japan', Osaka:'Japan', Seoul:'South Korea', Singapore:'Singapore', 'Kuala Lumpur':'Malaysia', Bali:'Indonesia', Jakarta:'Indonesia', Manila:'Philippines',
  Shanghai:'China', Beijing:'China', Chengdu:'China', Shenzhen:'China', 'Hong Kong':'Hong Kong', Taipei:'Taiwan',
  Mumbai:'India', Delhi:'India', Bangalore:'India', Goa:'India', Tashkent:'Uzbekistan', Almaty:'Kazakhstan',
  'Cape Town':'South Africa', Johannesburg:'South Africa', Durban:'South Africa', Lagos:'Nigeria', Nairobi:'Kenya', Marrakech:'Morocco', Casablanca:'Morocco', Cairo:'Egypt', Dakar:'Senegal', Accra:'Ghana', 'Addis Ababa':'Ethiopia',
  Kampala:'Uganda', 'Dar es Salaam':'Tanzania', Kigali:'Rwanda', Abidjan:'Ivory Coast', Tunis:'Tunisia', Luanda:'Angola', Maputo:'Mozambique', Zanzibar:'Tanzania', Mombasa:'Kenya', Harare:'Zimbabwe',
  Abuja:'Nigeria', 'Port Harcourt':'Nigeria', Kumasi:'Ghana', Douala:'Cameroon', Kinshasa:'DR Congo', Lusaka:'Zambia', Gaborone:'Botswana', Windhoek:'Namibia', Antananarivo:'Madagascar', Bamako:'Mali',
  Calgary:'Canada', Edmonton:'Canada', Winnipeg:'Canada', Ottawa:'Canada',
  Boise:'USA United States Idaho', Omaha:'USA United States Nebraska', Albuquerque:'USA United States New Mexico', Louisville:'USA United States Kentucky', 'El Paso':'USA United States Texas',
  'Brasília':'Brazil', Curitiba:'Brazil', 'Porto Alegre':'Brazil', 'Belo Horizonte':'Brazil', Recife:'Brazil', Fortaleza:'Brazil', Rosario:'Argentina', Mendoza:'Argentina', 'Asunción':'Paraguay', 'Santa Cruz':'Bolivia',
  Bishkek:'Kyrgyzstan', Astana:'Kazakhstan',
  Nassau:'Bahamas', Kingston:'Jamaica', 'Montego Bay':'Jamaica', Hamilton:'Bermuda', 'Santo Domingo':'Dominican Republic', 'Punta Cana':'Dominican Republic',
  'San Diego':'USA United States California', Honolulu:'USA United States Hawaii', Portland:'USA United States Oregon',
  'Phnom Penh':'Cambodia', Colombo:'Sri Lanka', Cebu:'Philippines', Hyderabad:'India', Pune:'India',
  Seattle:'USA United States Washington', Boston:'USA United States Massachusetts', Philadelphia:'USA United States Pennsylvania', Charlotte:'USA United States', Tampa:'USA United States Florida', Orlando:'USA United States Florida', Pittsburgh:'USA United States', Cleveland:'USA United States Ohio', Sacramento:'USA United States California', 'San Jose':'USA United States California',
  Naples:'Italy', Florence:'Italy', Malaga:'Spain', Bordeaux:'France', Stuttgart:'Germany', 'Gdańsk':'Poland', Split:'Croatia', Gothenburg:'Sweden',
  Chennai:'India', 'Da Nang':'Vietnam', 'Chiang Mai':'Thailand', Busan:'South Korea', Fukuoka:'Japan', Kolkata:'India',
  Managua:'Nicaragua', 'San Pedro Sula':'Honduras', 'Belize City':'Belize', 'Roatán':'Honduras', 'Bocas del Toro':'Panama', 'Antigua Guatemala':'Guatemala', 'León':'Nicaragua', 'Playa del Carmen':'Mexico',
  Quito:'Ecuador', Guayaquil:'Ecuador', Caracas:'Venezuela', 'La Paz':'Bolivia', 'Córdoba':'Argentina', 'Florianópolis':'Brazil', Salvador:'Brazil', Cusco:'Peru', 'Valparaíso':'Chile', Cali:'Colombia',
  Sydney:'Australia', Melbourne:'Australia', Brisbane:'Australia', Perth:'Australia', Auckland:'New Zealand',
  'Novi Sad':'Serbia', Rijeka:'Croatia', Dubrovnik:'Croatia', Dortmund:'Germany', Nuremberg:'Germany', Hannover:'Germany', Toulouse:'France', Nantes:'France', Lille:'France', Bilbao:'Spain', Granada:'Spain', Turin:'Italy', Bologna:'Italy', Palermo:'Italy Sicily', Nottingham:'UK England', Brighton:'UK England', 'Wrocław':'Poland', 'Łódź':'Poland', Utrecht:'Netherlands', Eindhoven:'Netherlands', Guadalajara:'Mexico', Monterrey:'Mexico', Adelaide:'Australia', 'Gold Coast':'Australia', Ahmedabad:'India', Jaipur:'India',
  'Düsseldorf':'Germany', Dresden:'Germany', Bremen:'Germany', Zaragoza:'Spain', Alicante:'Spain', Murcia:'Spain', Genoa:'Italy', Verona:'Italy', Catania:'Italy Sicily', Bari:'Italy', Strasbourg:'France', Montpellier:'France', Rennes:'France', Leicester:'UK England', Southampton:'UK England', Aberdeen:'UK Scotland', Braga:'Portugal', Faro:'Portugal Algarve', Coimbra:'Portugal', 'The Hague':'Netherlands', Groningen:'Netherlands', Katowice:'Poland', Szczecin:'Poland', Larissa:'Greece', Volos:'Greece', 'Goiânia':'Brazil', Manaus:'Brazil', Puebla:'Mexico', 'Mérida':'Mexico', Tijuana:'Mexico', Canberra:'Australia', Hobart:'Australia', Chandigarh:'India', Kochi:'India', Indore:'India', Pattaya:'Thailand', 'Hua Hin':'Thailand', 'Mar del Plata':'Argentina', Barranquilla:'Colombia', Izmir:'Turkey', Antalya:'Turkey', Bodrum:'Turkey', Nagoya:'Japan', Sapporo:'Japan', Daegu:'South Korea', Raleigh:'USA United States', Richmond:'USA United States', 'Nha Trang':'Vietnam', Surabaya:'Indonesia', Davao:'Philippines', Pretoria:'South Africa',
  'Birmingham AL':'USA United States Alabama', Anchorage:'USA United States Alaska', 'Little Rock':'USA United States Arkansas', 'New Haven':'USA United States Connecticut', Wilmington:'USA United States Delaware', 'Des Moines':'USA United States Iowa', Wichita:'USA United States Kansas', 'Portland ME':'USA United States Maine', Baltimore:'USA United States Maryland', Jackson:'USA United States Mississippi', Bozeman:'USA United States Montana', 'Manchester NH':'USA United States New Hampshire', 'Atlantic City':'USA United States New Jersey', Fargo:'USA United States North Dakota', Providence:'USA United States Rhode Island', Charleston:'USA United States South Carolina', 'Sioux Falls':'USA United States South Dakota', Burlington:'USA United States Vermont', Morgantown:'USA United States West Virginia', 'Jackson Hole':'USA United States Wyoming', Maui:'USA United States Hawaii',
  Ankara:'Turkey', Marmaris:'Turkey', 'Çeşme':'Turkey', Alanya:'Turkey', Karachi:'Pakistan', Lahore:'Pakistan', Islamabad:'Pakistan',
  Skopje:'North Macedonia Macedonia', Ohrid:'North Macedonia Macedonia',
  Syracuse:'USA United States New York', Siracusa:'Italy Sicily',
};
// a venue is "in view" if it's within the current map bounds — used so the
// filter counts reflect what's near you, growing only as you zoom out
function inScope(v) {
  if (!v || !v.coords) return true;
  if (!map || !map.map || !map._ready) return true;
  try { return map.map.getBounds().contains([v.coords.lng, v.coords.lat]); } catch (e) { return true; }
}
// bounded edit distance (early-exit) so a small typo still finds small areas
function editDist(a, b, max) {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > max) return max + 1;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i]; let best = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[n];
}
// substring match, then a typo-tolerant word match (so "albuferia" still finds Albufeira)
function fuzzyHit(q, hay) {
  if (hay.includes(q)) return true;
  if (q.length < 4 || q.includes(' ')) return false;
  const tol = q.length >= 7 ? 2 : 1;
  for (const w of hay.split(/[^a-z0-9]+/)) {
    if (w.length >= 4 && Math.abs(w.length - q.length) <= tol && editDist(w, q, tol) <= tol) return true;
  }
  return false;
}
function venueMatches(v) {
  if (!matchFilter(v)) return false;
  const q = (S.query || '').trim().toLowerCase();
  if (!q) return true;
  if (q === 'event' || q === 'events') return !!v.tonight; // search "events" → venues with a live lineup
  const hay = `${v.name} ${v.neighborhoodName} ${v.city} ${v.category} ${CITY_COUNTRY[v.city] || ''}`.toLowerCase();
  return fuzzyHit(q, hay);
}

// ---- instant-open cache ---------------------------------------------------
// The backend can take ~30s to answer the first /api/state (a cold Render dyno),
// during which the map would sit empty. So we keep a COMPACT copy of the last
// venues in localStorage and paint them immediately on launch, then quietly swap
// in fresh data when the network returns. Only the fields the map + list need are
// stored (no reviews/photos/hours), so it stays small enough to never hit quota.
const CACHE_KEY = 'clubbit:state:v1';
const CACHE_MAX_AGE = 12 * 3600 * 1000; // 12h — stale enough is far better than blank
function cacheState(d) {
  try {
    if (!d || !d.venues) return;
    const venues = d.venues.map((v) => ({
      id: v.id, name: v.name, neighborhood: v.neighborhood, neighborhoodName: v.neighborhoodName,
      city: v.city, category: v.category, kind: v.kind, coords: v.coords, verified: v.verified,
      lgbtq: v.lgbtq, hot: v.hot, radar: v.radar, momentum: v.momentum, vibe: v.vibe, pct: v.pct,
      open: v.open, photo: v.photo || null,
    }));
    const slim = { generatedAt: d.generatedAt, bounds: d.bounds, city: d.city, venues, areas: d.areas, clusters: d.clusters };
    localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), d: slim }));
  } catch (e) { /* private mode / quota — just skip caching */ }
}
function bootFromCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY); if (!raw) return false;
    const { t, d } = JSON.parse(raw);
    if (!d || !d.venues || !d.venues.length || Date.now() - t > CACHE_MAX_AGE) return false;
    S.data = d; S._cachePaint = true;
    map.setData(d); // pins + clusters appear instantly; camera can settle now, not in 30s
    renderFilters();
    if (S.tab === 'near' || S.tab === 'areas' || S.tab === 'feed') renderSheet();
    updateChrome();
    return true;
  } catch (e) { return false; }
}
async function refresh() {
  try {
    const d = await API.state();
    S.data = d; S._cachePaint = false;
    if (!S.booted) { S.booted = true; bootLocation(); }
    map.setData(d);
    renderFilters();
    // only re-render the sheet when it's showing a live list — never clobber
    // the Profile view (its own tab) with the auto-refresh.
    if (S.tab === 'near' || S.tab === 'areas' || S.tab === 'feed') renderSheet();
    updateChrome();
    cacheState(d);
  } catch (e) { console.error(e); }
}
let _rt, _searchFlyT;
function refreshSoon() { clearTimeout(_rt); _rt = setTimeout(refresh, 900); }

// The bell badge counts exactly the feed items you'll see on click — but stays
// hidden until at least one nearby club is actually OPEN (no count for a night
// when everything nearby is still closed).
function feedOpenCount() {
  const items = feedItems();
  if (!items.some((it) => it.v.open)) return 0;
  return items.length;
}
function updateChrome() {
  const d = S.data; if (!d) return;
  const badge = $('#feedBadge'); if (!badge) return;
  const n = feedOpenCount();
  if (n > 0) { badge.textContent = Math.min(99, n); badge.style.display = 'flex'; }
  else { badge.style.display = 'none'; }
}

/* ---- location gate: ask on open, then show best clubs near you ---- */
function populateGateCities() {
  const d = S.data; if (!d) return;
  const seen = {}, cities = [];
  d.areas.forEach((a) => {
    if (!seen[a.city]) { seen[a.city] = { city: a.city, lat: a.center.lat, lng: a.center.lng, n: 1 }; cities.push(seen[a.city]); }
    else { seen[a.city].lat += a.center.lat; seen[a.city].lng += a.center.lng; seen[a.city].n++; }
  });
  const row = $('#gateCities');
  row.innerHTML = cities.map((c, i) => `<button class="gate-city" data-i="${i}">${esc(c.city)}</button>`).join('');
  row.querySelectorAll('.gate-city').forEach((b) => (b.onclick = () => {
    const c = cities[+b.dataset.i]; useCity(c.city, c.lat / c.n, c.lng / c.n);
  }));
}
function showGate() { populateGateCities(); setGateStatus(''); $('#locateGate').hidden = false; }
function hideGate() { $('#locateGate').hidden = true; }
function saveLoc(o) { try { localStorage.setItem('pr_loc', JSON.stringify(o)); } catch (e) {} }
function loadLoc() { try { const s = localStorage.getItem('pr_loc'); return s ? JSON.parse(s) : null; } catch (e) { return null; } }

// saved venues (persisted in this browser)
function loadSaved() { try { return JSON.parse(localStorage.getItem('pr_saved')) || []; } catch (e) { return []; } }
function isSaved(id) { return loadSaved().includes(id); }
function toggleSave(id, btn) {
  let a = loadSaved();
  const now = !a.includes(id);
  a = now ? [id, ...a.filter((x) => x !== id)] : a.filter((x) => x !== id);
  try { localStorage.setItem('pr_saved', JSON.stringify(a)); } catch (e) {}
  // toggle the button's filled state in place — no toast popup
  if (btn) { btn.classList.toggle('on', now); const t = btn.querySelector('.bs-txt'); if (t) t.textContent = now ? 'Saved' : 'Save'; }
  if (S.tab === 'saved') renderSheet();
}
window.toggleSave = toggleSave;

// Is location permission ALREADY granted at the OS/browser level? (so we never
// re-prompt someone who already said yes on a previous session/sign-in.)
async function checkGeoPermission() {
  try {
    if (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.Geolocation && Capacitor.Plugins.Geolocation.checkPermissions) {
      const r = await Capacitor.Plugins.Geolocation.checkPermissions();
      return r.location || r.coarseLocation || 'prompt';
    }
  } catch (e) {}
  try {
    if (navigator.permissions && navigator.permissions.query) {
      const r = await navigator.permissions.query({ name: 'geolocation' });
      return r.state; // 'granted' | 'denied' | 'prompt'
    }
  } catch (e) {}
  return 'prompt';
}
// Fly to a GPS fix + remember it (shared by the gate's Allow button and silent boot).
function applyGps(loc, opts) {
  S.userLoc = loc; S._userIsGps = true;
  try { map.setUserLocation(loc); } catch (e) {}
  const nearest = (S.data && S.data.venues) ? S.data.venues.map((v) => ({ v, dkm: haversineKm(loc, v.coords) })).sort((a, b) => a.dkm - b.dkm)[0] : null;
  let t = loc, label = 'Best near you', z = 12.5;
  if (nearest && nearest.dkm > 60) { t = { lat: nearest.v.coords.lat, lng: nearest.v.coords.lng }; label = 'Nearest scene · ' + cityOf(nearest.v); z = 12; }
  S.locLabel = label;
  saveLoc({ lat: t.lat, lng: t.lng, label, mode: 'gps', userLat: loc.lat, userLng: loc.lng });
  // On the automatic on-load GPS fix, don't yank the camera if the user has already
  // panned/zoomed while things were loading — just leave them where they're looking.
  const yank = !((opts && opts.auto) && map && map._userMoved);
  S._rememberFly = false; // GPS has resolved; the pending remembered jump is moot
  if (yank) { try { map.flyToLatLng(t.lat, t.lng, z); } catch (e) {} }
  updateChrome();
  if (opts && opts.openSheet) { openSheet('near'); }
}
// reapply a remembered choice on load (no gate); or — if the OS already granted
// location — use it silently; only show the gate to first-timers who haven't decided.
async function bootLocation() {
  const saved = loadLoc();
  if (saved) {
    if (saved.skip) return; // remembered "browse the map"
    if (saved.mode === 'gps') { S.userLoc = { lat: saved.userLat, lng: saved.userLng }; S._userIsGps = true; S._flyTarget = { lat: saved.lat, lng: saved.lng }; S.locLabel = saved.label; S._rememberFly = true; try { if (typeof map !== 'undefined' && map) map.setUserLocation(S.userLoc); } catch (e) {} return; }
    if (saved.mode === 'gps-allowed') { S._userIsGps = true; silentGps(); return; } // allowed before, no fix cached yet
    S.userLoc = { lat: saved.lat, lng: saved.lng }; S.locLabel = saved.label; S._rememberFly = true;
    return;
  }
  // No remembered choice. Decide ONCE from the OS permission — and once decided,
  // remember it so we never ask again:
  let state = 'prompt';
  try { state = await checkGeoPermission(); } catch (e) {}
  if (state === 'granted') {
    // already allowed → remember that immediately (so a slow/failed GPS fix can
    // never bounce us back to the gate) and get a position silently. NEVER gate.
    saveLoc({ mode: 'gps-allowed', label: 'Near you' });
    silentGps();
    return;
  }
  if (state === 'denied') { saveLoc({ skip: true }); return; } // OS-denied → browse the map, don't nag
  showGate(); // genuinely undecided → ask once
}
// Get a GPS fix WITHOUT ever prompting or showing the gate; apply it if/when it
// arrives. Low-accuracy + a generous maxAge makes it fast and reliable (a network
// fix is fine for "near you"); a failure is harmless — permission stays remembered.
function silentGps() {
  getPosition({ enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 })
    .then((p) => applyGps({ lat: p.coords.latitude, lng: p.coords.longitude }, { auto: true }))
    .catch(() => {});
}
function skipGate() { saveLoc({ skip: true }); hideGate(); }

function useCity(city, lat, lng) {
  hideGate();
  S.userLoc = { lat, lng }; S.locLabel = 'Best in ' + city; S._userIsGps = false; S._flyTarget = null;
  saveLoc({ lat, lng, label: S.locLabel });
  map.flyToLatLng(lat, lng, 12.5);
  openSheet('near');
  toast('Best clubs in ' + city);
}
function setGateStatus(msg, isErr) {
  const el = $('#gateStatus'); if (!el) return;
  if (!msg) { el.hidden = true; return; }
  el.hidden = false; el.textContent = msg; el.classList.toggle('err', !!isErr);
}
// GPS via the Capacitor Geolocation plugin in the packaged app (the WebView's own
// navigator.geolocation is unreliable), falling back to the browser on the web.
function hasNativeGeo() { return !!(window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.Geolocation && Capacitor.Plugins.Geolocation.getCurrentPosition); }
function getPosition(opts) {
  if (hasNativeGeo()) {
    const G = Capacitor.Plugins.Geolocation;
    // Never re-prompt someone who already said yes: only call requestPermissions
    // when the OS state is still 'prompt'. Some plugin builds re-show the system
    // dialog on EVERY requestPermissions call — that's what made it ask on each
    // open. When already granted we go straight to getCurrentPosition (silent).
    return (async () => {
      try {
        const st = await checkGeoPermission();
        if (st !== 'granted' && G.requestPermissions) await G.requestPermissions().catch(() => {});
      } catch (e) {}
      return G.getCurrentPosition(opts);
    })();
  }
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('no-geo'));
    navigator.geolocation.getCurrentPosition(resolve, reject, opts);
  });
}
// crosshair button: recenter to the user's location (no popup if we already have it)
function recenterToMe() {
  if (S.userLoc) {
    // fly to the known spot IMMEDIATELY (no waiting on GPS)…
    map.flyToLatLng(S.userLoc.lat, S.userLoc.lng, 14);
    // …then quietly refresh the fix in the background and nudge if it moved — but
    // ONLY when location is already granted, so the recenter button never triggers
    // a permission prompt.
    if (S._userIsGps) {
      checkGeoPermission().then((st) => {
        if (st !== 'granted') return;
        getPosition({ enableHighAccuracy: true, timeout: 8000, maximumAge: 120000 }).then((p) => {
          const loc = { lat: p.coords.latitude, lng: p.coords.longitude };
          S.userLoc = loc; map.setUserLocation(loc); map.flyToLatLng(loc.lat, loc.lng, 14); updateChrome();
        }).catch(() => {});
      }).catch(() => {});
    }
  } else {
    showGate(); // no location yet — let them set it
  }
}
function requestLocation() {
  // native app uses the Capacitor plugin; on the web GPS needs a secure origin
  if (!hasNativeGeo() && !window.isSecureContext) {
    setGateStatus('Live location needs a secure (https) connection on this device. Pick your city below instead.', true);
    return;
  }
  if (!hasNativeGeo() && !navigator.geolocation) { setGateStatus("This browser can't share location — pick a city below.", true); return; }
  const allow = $('#gateAllow');
  allow.disabled = true; setGateStatus('Locating…');
  getPosition({ enableHighAccuracy: true, timeout: 9000, maximumAge: 60000 }).then((p) => {
    allow.disabled = false; setGateStatus('');
    const loc = { lat: p.coords.latitude, lng: p.coords.longitude };
    S.userLoc = loc; S._userIsGps = true;
    hideGate();
    updateChrome(); // refresh the bell count for the new location right away
    map.setUserLocation(loc);
    const nearest = S.data.venues.map((v) => ({ v, dkm: haversineKm(loc, v.coords) })).sort((a, b) => a.dkm - b.dkm)[0];
    let t = loc, label = 'Best near you', z = 12.5;
    if (nearest && nearest.dkm > 60) { t = { lat: nearest.v.coords.lat, lng: nearest.v.coords.lng }; label = 'Nearest scene · ' + cityOf(nearest.v); z = 12; }
    S.locLabel = label;
    saveLoc({ lat: t.lat, lng: t.lng, label, mode: 'gps', userLat: loc.lat, userLng: loc.lng });
    map.flyToLatLng(t.lat, t.lng, z);
    openSheet('near');
    toast('Showing the best spots near you');
  }).catch(async (err) => {
    allow.disabled = false;
    if (err && err.code === 1) { setGateStatus('Location permission was blocked — pick a city below.', true); return; }
    // Not a denial — permission is likely granted but the fix is slow (indoors/cold
    // GPS). Remember the grant so we never gate again, and let them into the app;
    // silentGps will drop a pin as soon as a position arrives.
    let granted = false; try { granted = (await checkGeoPermission()) === 'granted'; } catch (e) {}
    if (granted) { saveLoc({ mode: 'gps-allowed', label: 'Near you' }); S._userIsGps = true; hideGate(); silentGps(); return; }
    setGateStatus("Couldn't get your location — pick a city below.", true);
  });
}
function renderFilters() {
  const d = S.data; if (!d) return;
  const row = $('#filterRow');
  const sl = row.scrollLeft; // keep the chip strip's scroll position on refresh
  const scope = d.venues.filter(inScope); // only what's in the current map view
  row.innerHTML = FILTERS.map((f) => {
    const n = f.k === 'all' ? scope.length : scope.filter((v) => filterHit(f, v)).length;
    return `<button class="fchip ${S.filter === f.k ? 'active' : ''}" data-f="${f.k}">${f.label} (${n})</button>`;
  }).join('');
  row.scrollLeft = sl;
  row.querySelectorAll('.fchip').forEach((b) => (b.onclick = () => {
    S.filter = b.dataset.f; renderFilters(); map.setData(S.data); renderSheet();
  }));
}

// sheet open/close (modal, on demand)
function setBn(key) { document.querySelectorAll('.bn').forEach((x) => x.classList.toggle('active', x.dataset.nav === key)); }
function setTab(t) {
  if (t === 'profile') { showProfile(); return; }
  S.tab = t;
  setBn(t === 'saved' ? 'saved' : 'map');
  hideProfile();
  renderSheet();
}

function profFreqShort(f) {
  return { 'Less than once a month': '<1 night a month', '1–2 times a month': '1–2 nights a month',
    '3–5 times a month': '3–5 nights a month', '6–10 times a month': '6–10 nights a month',
    'More than 10 times a month': '10+ nights a month' }[f] || f;
}
function profGender(g) {
  return { man: 'Man', woman: 'Woman', 'non-binary': 'Non-binary', 'prefer-not': 'Prefer not to say' }[g] || g;
}
function profDob(iso) {
  if (!iso) return null;
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return iso;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}
function loadLocalProfile() { try { return JSON.parse(localStorage.getItem('clubbit_profile')) || {}; } catch { return {}; } }
function clubbitToken() { try { return localStorage.getItem('clubbit_token') || ''; } catch { return ''; } }
// Persist a profile locally and (if signed in) back to the account on the server.
function saveProfileEverywhere(prof) {
  prof.updatedAt = new Date().toISOString();
  try { localStorage.setItem('clubbit_profile', JSON.stringify(prof)); } catch {}
  const token = clubbitToken();
  if (token) {
    fetch('/api/auth/profile', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, profile: prof }),
    }).catch(() => {});
  }
}
// Center-crop an image file to a square JPEG data URL (for avatars).
function squareCropDataUrl(file, out = 512, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('read'));
    r.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('decode'));
      img.onload = () => {
        const s = Math.min(img.naturalWidth, img.naturalHeight);
        const sx = (img.naturalWidth - s) / 2, sy = (img.naturalHeight - s) / 2;
        const c = document.createElement('canvas'); c.width = c.height = out;
        c.getContext('2d').drawImage(img, sx, sy, s, s, 0, 0, out, out);
        resolve(c.toDataURL('image/jpeg', quality));
      };
      img.src = r.result;
    };
    r.readAsDataURL(file);
  });
}
// Interactive circular crop (pan + zoom over a circle) for the profile photo, so
// people can place & frame their face — same feel as onboarding. Resolves to a
// cropped data URL, or null if cancelled.
function cropPhoto(file) {
  return new Promise((resolve) => {
    const ov = $('#cropOv'), circle = $('#pfCropCircle'), img = $('#pfCropImg'), zoom = $('#pfCropZoom');
    const cancel = $('#pfCropCancel'), save = $('#pfCropSave');
    if (!ov || !circle) { resolve(null); return; }
    const src = URL.createObjectURL(file);
    let st = null, drag = null;
    const layout = () => {
      if (!st) return;
      const eff = st.coverBase * st.zoom, w = st.iw * eff, h = st.ih * eff, S = st.S;
      st.ox = Math.min(0, Math.max(S - w, st.ox));
      st.oy = Math.min(0, Math.max(S - h, st.oy));
      Object.assign(img.style, { position: 'absolute', left: '0', top: '0', width: w + 'px', height: h + 'px', transform: `translate(${(S - w) / 2 + st.ox}px, ${(S - h) / 2 + st.oy}px)` });
    };
    const close = () => { ov.hidden = true; URL.revokeObjectURL(src); zoom.oninput = null; circle.onpointerdown = circle.onpointermove = circle.onpointerup = circle.onpointercancel = null; cancel.onclick = save.onclick = null; };
    const im = new Image();
    im.onload = () => {
      const S = circle.clientWidth || 280;
      st = { iw: im.naturalWidth, ih: im.naturalHeight, S, coverBase: Math.max(S / im.naturalWidth, S / im.naturalHeight), zoom: 1, ox: 0, oy: 0 };
      img.src = src; img.style.transform = 'none'; zoom.value = '1';
      ov.hidden = false; requestAnimationFrame(layout);
    };
    im.onerror = () => { URL.revokeObjectURL(src); resolve(null); };
    im.src = src;
    zoom.oninput = () => { if (st) { st.zoom = +zoom.value; layout(); } };
    circle.onpointerdown = (e) => { if (!st) return; drag = { x: e.clientX, y: e.clientY, ox: st.ox, oy: st.oy }; circle.setPointerCapture(e.pointerId); };
    circle.onpointermove = (e) => { if (!drag || !st) return; st.ox = drag.ox + (e.clientX - drag.x); st.oy = drag.oy + (e.clientY - drag.y); layout(); };
    circle.onpointerup = circle.onpointercancel = () => { drag = null; };
    cancel.onclick = () => { close(); resolve(null); };
    save.onclick = () => {
      if (!st) { close(); resolve(null); return; }
      const OUT = 480, eff = st.coverBase * st.zoom, S = st.S;
      const left = (S - st.iw * eff) / 2 + st.ox, top = (S - st.ih * eff) / 2 + st.oy;
      const sx = -left / eff, sy = -top / eff, sS = S / eff;
      const c = document.createElement('canvas'); c.width = c.height = OUT;
      const ctx = c.getContext('2d');
      const im2 = new Image();
      im2.onload = () => { ctx.drawImage(im2, sx, sy, sS, sS, 0, 0, OUT, OUT); let url = null; try { url = c.toDataURL('image/jpeg', 0.88); } catch (e) {} close(); resolve(url); };
      im2.onerror = () => { close(); resolve(null); };
      im2.src = src;
    };
  });
}
function exactAgeFromISO(iso) {
  const d = new Date(iso + 'T00:00:00'); if (isNaN(d)) return null;
  const t = new Date(); let a = t.getFullYear() - d.getFullYear();
  const m = t.getMonth() - d.getMonth(); if (m < 0 || (m === 0 && t.getDate() < d.getDate())) a--;
  return a;
}

// Edit name / gender / date of birth in a modal, then save locally + to the account.
function editProfile() {
  const p = loadLocalProfile();
  const GENDERS = ['Man', 'Woman', 'Non-binary', 'Prefer not to say'];
  const maxDob = new Date(Date.now() - 18 * 365.25 * 864e5).toISOString().slice(0, 10);
  const ov = document.createElement('div');
  ov.className = 'overlay edit-ov';
  ov.innerHTML = `
    <div class="overlay-scrim" data-x="1"></div>
    <div class="edit-card">
      <h3>Edit profile</h3>
      <label class="ed-field"><span>First name</span>
        <input id="edName" type="text" maxlength="40" value="${esc(p.firstName || '')}" placeholder="Your name" /></label>
      <label class="ed-field"><span>Gender</span>
        <select id="edGender">${GENDERS.map((g) => `<option value="${g}" ${p.gender === g ? 'selected' : ''}>${g}</option>`).join('')}</select></label>
      <label class="ed-field"><span>Date of birth</span>
        <input id="edDob" type="date" max="${maxDob}" value="${esc(p.dateOfBirth || '')}" /></label>
      <div class="ed-err" id="edErr"></div>
      <div class="edit-actions">
        <button class="btn btn-ghost" id="edCancel">Cancel</button>
        <button class="btn btn-primary" id="edSave">Save</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.querySelector('[data-x]').onclick = close;
  ov.querySelector('#edCancel').onclick = close;
  ov.querySelector('#edSave').onclick = () => {
    const name = ov.querySelector('#edName').value.trim();
    const gender = ov.querySelector('#edGender').value;
    const dob = ov.querySelector('#edDob').value;
    const err = ov.querySelector('#edErr');
    if (!name) { err.textContent = 'Please enter your name.'; return; }
    let age = p.calculatedAge || null;
    if (dob) {
      age = exactAgeFromISO(dob);
      if (age === null) { err.textContent = 'Please enter a valid date.'; return; }
      if (age < 18) { err.textContent = 'You must be 18 or older to use Clubbit.'; return; }
    }
    const next = { ...p, firstName: name, gender, dateOfBirth: dob || p.dateOfBirth || null, calculatedAge: age };
    next.public = { ...(p.public || {}), firstName: name, age };
    saveProfileEverywhere(next);
    // header avatar may switch if gender changed and there's no photo
    if (!next.profilePhoto) {
      const hdr = document.querySelector('.avatar img');
      if (hdr) hdr.src = gender === 'Woman' ? '/clubbit-face-f.png' : gender === 'Man' ? '/clubbit-face-m.png' : gender === 'Non-binary' ? '/clubbit-face-nb.png' : '/clubbit-mascot.png';
    }
    close(); toast('Profile updated ✓'); renderProfile();
  };
}

// ============================================================ THEME + LANGUAGE
const LANGS = [
  ['en', 'English', 'English'], ['es', 'Español', 'Spanish'], ['fr', 'Français', 'French'],
  ['de', 'Deutsch', 'German'], ['pt', 'Português', 'Portuguese'], ['it', 'Italiano', 'Italian'],
  ['nl', 'Nederlands', 'Dutch'], ['ru', 'Русский', 'Russian'], ['uk', 'Українська', 'Ukrainian'],
  ['pl', 'Polski', 'Polish'], ['tr', 'Türkçe', 'Turkish'], ['el', 'Ελληνικά', 'Greek'],
  ['sr', 'Српски', 'Serbian'], ['ro', 'Română', 'Romanian'], ['sv', 'Svenska', 'Swedish'],
  ['no', 'Norsk', 'Norwegian'], ['da', 'Dansk', 'Danish'], ['fi', 'Suomi', 'Finnish'],
  ['cs', 'Čeština', 'Czech'], ['hu', 'Magyar', 'Hungarian'], ['bg', 'Български', 'Bulgarian'],
  ['hr', 'Hrvatski', 'Croatian'], ['ar', 'العربية', 'Arabic'], ['he', 'עברית', 'Hebrew'],
  ['fa', 'فارسی', 'Persian'], ['hi', 'हिन्दी', 'Hindi'], ['id', 'Bahasa Indonesia', 'Indonesian'],
  ['th', 'ไทย', 'Thai'], ['vi', 'Tiếng Việt', 'Vietnamese'], ['zh', '中文', 'Chinese'],
  ['ja', '日本語', 'Japanese'], ['ko', '한국어', 'Korean'],
];
const RTL_LANGS = ['ar', 'he', 'fa', 'ur'];
const I18N = {
  en: { settings: 'Settings', appearance: 'Appearance', light: 'Light', dark: 'Dark', language: 'Language',
    signOut: 'Sign out', deleteAccount: 'Delete account', editProfile: 'Edit profile', changePhoto: 'Change photo',
    contactSupport: 'Contact support', reportIssue: 'Report an issue',
    eventsNearby: 'Events near you', distanceUnit: 'Distance unit',
    removePhoto: 'Remove photo (use default)', profile: 'Profile', reports: 'Reports', photos: 'Photos',
    contributions: 'contributions to the radar', yourPhotos: 'Your photos & videos', noPhotos: "You haven't added any photos yet.",
    yourReports: 'Your reports', noReports: "You haven't reported yet. Report the vibe at a venue to build your overview.",
    toNext: 'to', maxLevel: 'Max level', email: 'Email', gender: 'Gender', dob: 'Date of birth',
    account: 'Account', prefs: 'Preferences' },
  es: { settings: 'Ajustes', appearance: 'Apariencia', light: 'Claro', dark: 'Oscuro', language: 'Idioma',
    signOut: 'Cerrar sesión', deleteAccount: 'Eliminar cuenta', editProfile: 'Editar perfil', changePhoto: 'Cambiar foto',
    removePhoto: 'Quitar foto (usar predeterminada)', profile: 'Perfil', reports: 'Reportes', photos: 'Fotos',
    contributions: 'aportes al radar', yourPhotos: 'Tus fotos y vídeos', noPhotos: 'Aún no has añadido fotos.',
    toNext: 'para', maxLevel: 'Nivel máximo', email: 'Correo', gender: 'Género', dob: 'Fecha de nacimiento',
    account: 'Cuenta', prefs: 'Preferencias' },
  fr: { settings: 'Paramètres', appearance: 'Apparence', light: 'Clair', dark: 'Sombre', language: 'Langue',
    signOut: 'Se déconnecter', deleteAccount: 'Supprimer le compte', editProfile: 'Modifier le profil', changePhoto: 'Changer la photo',
    removePhoto: 'Retirer la photo (par défaut)', profile: 'Profil', reports: 'Rapports', photos: 'Photos',
    contributions: 'contributions au radar', yourPhotos: 'Vos photos et vidéos', noPhotos: "Vous n'avez pas encore ajouté de photos.",
    toNext: 'pour', maxLevel: 'Niveau max', email: 'E-mail', gender: 'Genre', dob: 'Date de naissance',
    account: 'Compte', prefs: 'Préférences' },
  de: { settings: 'Einstellungen', appearance: 'Darstellung', light: 'Hell', dark: 'Dunkel', language: 'Sprache',
    signOut: 'Abmelden', deleteAccount: 'Konto löschen', editProfile: 'Profil bearbeiten', changePhoto: 'Foto ändern',
    removePhoto: 'Foto entfernen (Standard)', profile: 'Profil', reports: 'Meldungen', photos: 'Fotos',
    contributions: 'Beiträge zum Radar', yourPhotos: 'Deine Fotos & Videos', noPhotos: 'Du hast noch keine Fotos hinzugefügt.',
    toNext: 'bis', maxLevel: 'Höchststufe', email: 'E-Mail', gender: 'Geschlecht', dob: 'Geburtsdatum',
    account: 'Konto', prefs: 'Einstellungen' },
  pt: { settings: 'Definições', appearance: 'Aparência', light: 'Claro', dark: 'Escuro', language: 'Idioma',
    signOut: 'Terminar sessão', deleteAccount: 'Eliminar conta', editProfile: 'Editar perfil', changePhoto: 'Alterar foto',
    removePhoto: 'Remover foto (usar padrão)', profile: 'Perfil', reports: 'Relatórios', photos: 'Fotos',
    contributions: 'contribuições para o radar', yourPhotos: 'As tuas fotos e vídeos', noPhotos: 'Ainda não adicionaste fotos.',
    toNext: 'para', maxLevel: 'Nível máximo', email: 'E-mail', gender: 'Género', dob: 'Data de nascimento',
    account: 'Conta', prefs: 'Preferências' },
  it: { settings: 'Impostazioni', appearance: 'Aspetto', light: 'Chiaro', dark: 'Scuro', language: 'Lingua',
    signOut: 'Esci', deleteAccount: 'Elimina account', editProfile: 'Modifica profilo', changePhoto: 'Cambia foto',
    removePhoto: 'Rimuovi foto (predefinita)', profile: 'Profilo', reports: 'Segnalazioni', photos: 'Foto',
    contributions: 'contributi al radar', yourPhotos: 'Le tue foto e video', noPhotos: 'Non hai ancora aggiunto foto.',
    toNext: 'a', maxLevel: 'Livello massimo', email: 'Email', gender: 'Genere', dob: 'Data di nascita',
    account: 'Account', prefs: 'Preferenze' },
};
function currentLang() { try { return localStorage.getItem('clubbit_lang') || 'en'; } catch { return 'en'; } }
function t(key) { const l = currentLang(); return (I18N[l] && I18N[l][key]) || I18N.en[key] || key; }
function applyLang(code) {
  try { localStorage.setItem('clubbit_lang', code); } catch {}
  document.documentElement.lang = code;
  document.documentElement.dir = RTL_LANGS.includes(code) ? 'rtl' : 'ltr';
}
function currentTheme() { try { return localStorage.getItem('clubbit_theme') || 'light'; } catch { return 'light'; } }
// keyless OpenFreeMap basemap style matching the app theme (positron = clean light)
function mapStyleFor(mode) { return 'https://tiles.openfreemap.org/styles/' + (mode === 'dark' ? 'dark' : 'positron'); }
function webglAvailable() {
  try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl'))); } catch (e) { return false; }
}
function applyTheme(mode) {
  try { localStorage.setItem('clubbit_theme', mode); } catch {}
  document.documentElement.setAttribute('data-theme', mode);
  const logo = document.getElementById('brandHome');
  if (logo) logo.src = mode === 'dark' ? '/mascot-dark.png' : '/mascot.png';
  if (typeof map !== 'undefined' && map && map.setTheme) map.setTheme(mode); // switch the basemap too
}

// ---- full-screen profile show/hide ----
function showProfile() {
  closeSheet();
  S.tab = 'profile'; setBn('profile');
  const scr = $('#profileScreen'); if (scr) scr.hidden = false;
  renderProfile();
}
function hideProfile() { const scr = $('#profileScreen'); if (scr) scr.hidden = true; }

// ---- settings + language bottom sheets ----
function openMSheet(sheetId, scrimId) {
  const s = $(sheetId), sc = $(scrimId);
  document.body.classList.add('msheet-open'); // lock the content behind so it can't scroll
  if (sc) sc.hidden = false; if (s) { s.hidden = false; requestAnimationFrame(() => s.classList.add('open')); }
}
function closeMSheet(sheetId, scrimId) {
  const s = $(sheetId), sc = $(scrimId);
  if (s) s.classList.remove('open');
  setTimeout(() => { if (s) s.hidden = true; if (sc) sc.hidden = true; if (!document.querySelector('.msheet.open')) document.body.classList.remove('msheet-open'); }, 320);
}
function openSettings() {
  renderSettings();
  openMSheet('#settingsSheet', '#settingsScrim');
}
function renderSettings() {
  const body = $('#settingsBody'); if (!body) return;
  $('#setTitle').textContent = t('settings');
  const th = currentTheme();
  const lang = LANGS.find((l) => l[0] === currentLang()) || LANGS[0];
  const gear = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  const chev = gear('<path d="M9 18l6-6-6-6"/>');
  body.innerHTML = `
    <div class="setgrp">
      <div class="setrow" style="align-items:flex-start;flex-direction:column;gap:12px">
        <div style="display:flex;align-items:center;gap:13px;width:100%">
          <span class="sr-ic">${gear('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>')}</span>
          <span class="sr-main"><span class="sr-label">${t('appearance')}</span></span>
        </div>
        <div class="segtoggle" style="width:100%">
          <button data-theme-set="light" class="${th === 'light' ? 'on' : ''}">${gear('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>')} ${t('light')}</button>
          <button data-theme-set="dark" class="${th === 'dark' ? 'on' : ''}">${gear('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>')} ${t('dark')}</button>
        </div>
      </div>
      <button class="setrow" id="setLangRow">
        <span class="sr-ic">${gear('<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z"/>')}</span>
        <span class="sr-main"><span class="sr-label">${t('language')}</span></span>
        <span class="sr-val">${esc(lang[1])} ${chev}</span>
      </button>
    </div>
    <div class="setgrp">
      <div class="setrow">
        <span class="sr-ic">${gear('<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/><path d="M12 1v2M12 21v2M1 12h2M21 12h2"/>')}</span>
        <span class="sr-main"><span class="sr-label">${t('eventsNearby')}</span></span>
        <div class="stepper">
          <button class="step-btn" id="evMinus" aria-label="less">−</button>
          <span class="step-val" id="evVal">${esc(evRadiusLabel())}</span>
          <button class="step-btn" id="evPlus" aria-label="more">+</button>
        </div>
      </div>
      <div class="setrow">
        <span class="sr-ic">${gear('<path d="M3 8h18v8H3z"/><path d="M7 8v3M11 8v4M15 8v3M19 8v4"/>')}</span>
        <span class="sr-main"><span class="sr-label">${t('distanceUnit')}</span></span>
        <div class="segtoggle segsm" id="unitToggle">
          <button data-unit="km" class="${currentUnits() === 'km' ? 'on' : ''}">KM</button>
          <button data-unit="mi" class="${currentUnits() === 'mi' ? 'on' : ''}">MI</button>
        </div>
      </div>
    </div>
    <div class="setgrp">
      <button class="setrow" id="setSupport">
        <span class="sr-ic">${gear('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>')}</span>
        <span class="sr-main"><span class="sr-label">${t('contactSupport')}</span></span>
        <span class="sr-val">${chev}</span>
      </button>
      <button class="setrow" id="setReport">
        <span class="sr-ic">${gear('<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/>')}</span>
        <span class="sr-main"><span class="sr-label">${t('reportIssue')}</span></span>
        <span class="sr-val">${chev}</span>
      </button>
    </div>
    <div class="setgrp">
      <button class="setrow" id="setSignOut">
        <span class="sr-ic">${gear('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>')}</span>
        <span class="sr-main"><span class="sr-label">${t('signOut')}</span></span>
      </button>
      <button class="setrow danger" id="setDelete">
        <span class="sr-ic danger">${gear('<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>')}</span>
        <span class="sr-main"><span class="sr-label">${t('deleteAccount')}</span></span>
      </button>
    </div>`;
  body.querySelectorAll('[data-theme-set]').forEach((b) => b.onclick = () => {
    applyTheme(b.dataset.themeSet); renderSettings();
  });
  $('#setLangRow').onclick = openLanguage;
  // events-near-you distance stepper (10km → All)
  const stepEv = (dir) => {
    const steps = evSteps();
    const cur = eventRadiusKm();
    const curStep = cur === 'all' ? 'all' : kmToStep(cur);
    let i = steps.findIndex((s) => String(s) === String(curStep));
    if (i < 0) i = Math.max(0, steps.length - 4);
    i = Math.max(0, Math.min(steps.length - 1, i + dir));
    setEventRadius(stepToKm(steps[i]));
    const ev = $('#evVal'); if (ev) ev.textContent = evRadiusLabel();
    if (S.tab === 'feed' || S.tab === 'near') renderSheet();
  };
  { const m = $('#evMinus'), p = $('#evPlus'); if (m) m.onclick = () => stepEv(-1); if (p) p.onclick = () => stepEv(1); }
  // distance unit KM/MI — re-render everything that shows a distance
  $('#unitToggle') && $('#unitToggle').querySelectorAll('[data-unit]').forEach((b) => b.onclick = () => {
    setUnits(b.dataset.unit);
    // snap the events radius to a round step in the NEW unit so it shows a clean
    // number (e.g. 100 km → 50 mi), not the direct 62 mi conversion
    const km = eventRadiusKm();
    if (km !== 'all') setEventRadius(stepToKm(kmToStep(km)));
    renderSettings();
    if (typeof renderSheet === 'function') renderSheet();
  });
  $('#setSupport').onclick = () => openMail(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Clubbit — Support')}`);
  $('#setReport').onclick = () => {
    const diag = `\n\n———————\n(please keep the details below — they help us debug)\nApp: Clubbit\nPlatform: ${navigator.platform || ''}\n${navigator.userAgent || ''}`;
    openMail(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Clubbit — Issue report')}&body=${encodeURIComponent('What went wrong?\n' + diag)}`);
  };
  $('#setSignOut').onclick = doSignOut;
  $('#setDelete').onclick = doDeleteAccount;
}
// support inbox for the in-app "Contact support" / "Report an issue" links.
// mailto opens the phone's default mail app (Gmail on most Androids) with the
// address + subject prefilled. Change SUPPORT_EMAIL to reroute both links.
const SUPPORT_EMAIL = 'clubbit@clubbit.app';
function openMail(href) {
  try {
    const a = document.createElement('a');
    a.href = href; a.target = '_blank'; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
  } catch (e) { try { window.location.href = href; } catch (_) {} }
}
function openLanguage() {
  const body = $('#langBody'); if (!body) return;
  $('#langTitle').textContent = t('language');
  const cur = currentLang();
  const check = '<span class="li-check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></span>';
  body.innerHTML = LANGS.map((l) => `<button class="lang-item ${l[0] === cur ? 'sel' : ''}" data-lang="${l[0]}">
      <span><span class="li-native">${esc(l[1])}</span><span class="li-en" style="display:block">${esc(l[2])}</span></span>${check}</button>`).join('');
  body.querySelectorAll('[data-lang]').forEach((b) => b.onclick = () => {
    applyLang(b.dataset.lang);
    closeMSheet('#langSheet', '#langScrim');
    renderSettings(); renderProfile();
  });
  openMSheet('#langSheet', '#langScrim');
}
function doSignOut() {
  if (!confirm('Sign out of Clubbit? Your profile is saved to your account — sign back in anytime to restore it.')) return;
  try { ['clubbit_onboarding_complete', 'clubbit_profile', 'clubbit_onboarding', 'clubbit_token'].forEach((k) => localStorage.removeItem(k)); } catch {}
  location.replace('/onboarding.html');
}
async function doDeleteAccount() {
  if (!confirm('Delete your account permanently? This erases your account, saved profile, level and every report and photo you added. This cannot be undone.')) return;
  let token = ''; try { token = localStorage.getItem('clubbit_token') || ''; } catch {}
  const prof = myProfile();
  // send email + name too, so the server wipes the account and all its content even
  // if the token was lost, and scrubs feed lines that named the user
  let res = null; try { res = await API.deleteAccount(token, prof.email || null, prof.firstName || null); } catch (e) {}
  if (!res || res.error) { toast('Could not fully delete your account — check your connection and try again.', 3200); return; }
  try { localStorage.clear(); } catch {}
  location.replace('/onboarding.html');
}

let _meCache = null;
async function renderProfile() {
  const body = $('#profileBody');
  if (!body) return;
  // instant: repaint the last-known profile from cache; only show the skeleton
  // on the very first open when we have nothing cached yet
  if (_meCache) paintProfile(_meCache);
  else body.innerHTML = `
    <div class="phero">
      <div class="phero-ava"><div class="sk" style="width:112px;height:112px;border-radius:50%"></div></div>
      <div class="sk" style="width:130px;height:22px;border-radius:8px;margin-top:14px"></div>
      <div class="sk" style="width:92px;height:13px;border-radius:6px;margin-top:9px"></div>
    </div>
    <div class="pcard-l"><div class="sk" style="width:100%;height:40px;border-radius:8px"></div></div>
    <div class="pstats">
      <div class="pstat2"><div class="sk" style="width:64%;height:44px;border-radius:8px;margin:0 auto"></div></div>
      <div class="pstat2"><div class="sk" style="width:64%;height:44px;border-radius:8px;margin:0 auto"></div></div>
    </div>
    <div class="pdetails">
      <div class="sk" style="height:15px;margin:15px 0;border-radius:6px"></div>
      <div class="sk" style="height:15px;margin:15px 0;border-radius:6px"></div>
      <div class="sk" style="height:15px;margin:15px 0;border-radius:6px"></div>
    </div>`;
  // refresh in the background; repaint if the tab is still open
  let me, ok = false;
  try { me = await API.me(); ok = true; } catch { me = _meCache || { reportsMade: 0, photos: 0, badges: [], media: [], reports: [] }; }
  if (S.tab !== 'profile') return;
  _meCache = me;
  // keep the level counter in step with the server's authoritative total, which
  // ignores reports deleted within 24h — so the level reflects the same rule.
  if (ok && typeof me.reportsMade === 'number') setReportCount(me.reportsMade);
  paintProfile(me);
}
function paintProfile(me) {
  const body = $('#profileBody');
  if (!body) return;
  const reports = me.reportsMade || 0, photos = me.photos || 0;
  const badges = me.badges || [];
  const media = me.media || [];
  const myReports = me.reports || [];
  S.myReports = myReports;
  const p = loadLocalProfile();
  const name = p.firstName || 'You';
  const ava = p.profilePhoto || (p.gender === 'Woman' ? '/clubbit-face-f.png' : p.gender === 'Man' ? '/clubbit-face-m.png' : p.gender === 'Non-binary' ? '/clubbit-face-nb.png' : '/clubbit-mascot.png');
  const subBits = [];
  if (p.calculatedAge) subBits.push(p.calculatedAge);
  if (p.gender) subBits.push(profGender(p.gender));
  const sub = subBits.length ? subBits.join(' · ') : `Local · ${esc((S.data && S.data.city) || 'Greece')}`;
  const rows = [];
  if (p.email) rows.push([t('email'), esc(p.email)]);
  if (p.gender) rows.push([t('gender'), esc(profGender(p.gender))]);
  if (p.dateOfBirth) rows.push([t('dob'), esc(profDob(p.dateOfBirth)) + (p.calculatedAge ? ` · ${p.calculatedAge} yrs` : '')]);
  const lvl = levelFor(reportCount());
  const pct = lvl.next ? Math.round(((lvl.count - lvl.min) / (lvl.next.min - lvl.min)) * 100) : 100;
  const pencil = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
  body.innerHTML = `
    <div class="phero">
      <div class="phero-ava">
        <img src="${esc(ava)}" alt="${esc(name)}" onerror="this.src='/clubbit-mascot.png'" />
        <button class="phero-edit" id="heroEdit" aria-label="${t('changePhoto')}">${pencil}</button>
      </div>
      <div class="phero-name">${esc(name)}</div>
      <div class="phero-sub">${sub}</div>
      <span class="phero-tag">${lvl.emoji} ${esc(lvl.name)}</span>
    </div>
    <div class="pcard-l">
      <div class="pl-top"><span class="pl-name">${lvl.emoji} ${esc(lvl.name)}</span>
        <span class="pl-next">${lvl.next ? `${lvl.next.min - lvl.count} ${t('toNext')} ${esc(lvl.next.name)}` : t('maxLevel')}</span></div>
      <div class="pl-track"><i style="width:${pct}%"></i></div>
    </div>
    <div class="pstats">
      <div class="pstat2"><div class="pv">${reports}</div><div class="pk">${t('reports')}</div></div>
      <div class="pstat2"><div class="pv">${photos}</div><div class="pk">${t('photos')}</div></div>
    </div>
    <div class="pcard-total" style="text-align:center;font-size:12.5px;color:var(--muted);margin-top:10px">${reports + photos} ${t('contributions')}</div>
    ${badges.length ? `<div class="pbadges">${badges.map((b) => `<span class="pbadge">🏅 ${esc(b.label || b)}</span>`).join('')}</div>` : ''}
    ${rows.length ? `<div class="pdetails">${rows.map(([k, v]) => `<div class="pdetail"><span class="pk">${k}</span><span class="pv">${v}</span></div>`).join('')}</div>` : ''}
    <button class="pedit-btn" id="editProfileBtn">${pencil} ${t('editProfile')}</button>
    ${p.profilePhoto ? `<button class="pedit-btn" id="removePicBtn" style="background:none;color:var(--muted);margin-top:8px">${t('removePhoto')}</button>` : ''}
    <div class="psec-h"><h3>${t('yourReports')}</h3><span class="count">${myReports.length}</span></div>
    ${myReports.length ? `<div class="myrep-list">${myReports.map((r) => `
      <div class="myrep">
        ${r.mediaUrl
          ? (r.mediaType === 'video'
            ? `<video class="myrep-media" src="${r.mediaUrl}" muted playsinline loop preload="metadata" onclick="lbShowMine('${r.mediaUrl}','video')"></video>`
            : `<img class="myrep-media" src="${r.mediaUrl}" loading="lazy" alt="" onclick="lbShowMine('${r.mediaUrl}','image')" />`)
          : `<div class="myrep-media noimg">📍</div>`}
        <div class="myrep-txt" onclick="showMyReportDetail('${r.id}')">
          <div class="myrep-venue">${esc(r.venueName)}</div>
          <div class="myrep-meta">${esc(cap(VIBE_WORD[r.vibe] || r.vibe || 'reported'))}${r.entry != null ? ' · ' + (r.entry === 0 ? 'Free' : '€' + r.entry) : ''}${r.music ? ' · ' + esc(r.music) : ''}</div>
          <div class="myrep-time">${ago(r.ageMin)} ago · tap for details</div>
        </div>
        <button class="rep-del" onclick="deleteMyReport('${r.id}')" aria-label="Delete report"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>
      </div>`).join('')}</div>`
      : `<div class="empty">${t('noReports')}</div>`}`;
  // pencil / change photo
  const picInput = $('#profilePicInput');
  const he = $('#heroEdit'); if (he) he.onclick = () => picInput && picInput.click();
  const rpb = $('#removePicBtn');
  if (rpb) rpb.onclick = () => {
    const prof = loadLocalProfile();
    prof.profilePhoto = null;
    if (prof.public) prof.public.profilePhoto = null;
    saveProfileEverywhere(prof);
    const hdr = document.querySelector('.avatar img');
    if (hdr) hdr.src = prof.gender === 'Woman' ? '/clubbit-face-f.png' : prof.gender === 'Man' ? '/clubbit-face-m.png' : prof.gender === 'Non-binary' ? '/clubbit-face-nb.png' : '/clubbit-mascot.png';
    toast('Photo reset to default ✓');
    renderProfile();
  };
  if (picInput) picInput.onchange = async (e) => {
    const f = e.target.files && e.target.files[0]; e.target.value = '';
    if (!f) return;
    if (!f.type.startsWith('image/')) return toast('Please choose an image');
    let dataUrl;
    try { dataUrl = await cropPhoto(f); } catch { return toast('Could not read that image'); }
    if (!dataUrl) return;
    toast('Updating photo…');
    const prof = loadLocalProfile();
    prof.profilePhoto = dataUrl;
    if (prof.public) prof.public.profilePhoto = dataUrl;
    saveProfileEverywhere(prof);
    const hdr = document.querySelector('.avatar img'); if (hdr) hdr.src = dataUrl;
    toast('Profile picture updated ✓');
    renderProfile();
  };
  const epb = $('#editProfileBtn'); if (epb) epb.onclick = () => editProfile();
}
function showMyReportDetail(id) {
  const r = (S.myReports || []).find((x) => x.id === id); if (!r) return;
  const items = [['Venue', esc(r.venueName)], ['Vibe', esc(cap(VIBE_WORD[r.vibe] || r.vibe || '—'))]];
  if (r.queue && QUEUE_LABEL[r.queue]) items.push(['Queue', QUEUE_LABEL[r.queue]]);
  if (r.entry != null) items.push(['Entry', r.entry === 0 ? 'Free' : '€' + r.entry]);
  if (r.mix && MIX_LABEL[r.mix]) items.push(['Crowd', MIX_LABEL[r.mix]]);
  if (r.music) items.push(['Music', esc(r.music)]);
  items.push(['Reported', ago(r.ageMin) + ' ago']);
  const media = r.mediaUrl ? (r.mediaType === 'video'
    ? `<video class="rd-hero" src="${r.mediaUrl}" muted playsinline loop autoplay onclick="lbShowMine('${r.mediaUrl}','video')"></video>`
    : `<img class="rd-hero" src="${r.mediaUrl}" alt="" onclick="lbShowMine('${r.mediaUrl}','image')" />`) : '';
  const el = document.createElement('div');
  el.className = 'rdetail-ov';
  el.innerHTML = `<div class="rdetail-scrim"></div>
    <div class="rdetail-card">
      <div class="rdetail-head"><h3>${esc(r.venueName)}</h3><button class="msheet-x rd-x">✕</button></div>
      ${media}
      <div class="rdetail-rows">${items.map(([k, v]) => `<div class="pdetail"><span class="pk">${k}</span><span class="pv">${v}</span></div>`).join('')}</div>
      ${r.note ? `<div class="rr-note">“${esc(r.note)}”</div>` : ''}
      <button class="pedit-btn rd-del" style="background:color-mix(in oklab,var(--red) 12%,transparent);color:var(--red);margin-top:14px">Delete report</button>
    </div>`;
  document.body.appendChild(el);
  const close = () => el.remove();
  el.querySelector('.rdetail-scrim').onclick = close;
  el.querySelector('.rd-x').onclick = close;
  el.querySelector('.rd-del').onclick = () => { close(); deleteMyReport(r.id); };
}
window.showMyReportDetail = showMyReportDetail;
// scrollable list of every event this week at the open venue (Ticketmaster)
function showVenueEvents() {
  const t = S.cardEvents; if (!t || !t.events || !t.events.length) return;
  const rows = t.events.map((e) => {
    const when = e.isTonight ? 'Tonight' : eventDay(e.date);
    const who = e.artists && e.artists.length ? e.artists.join(', ') : e.name;
    const cover = e.image
      ? `<span class="evr-cover"><img src="${esc(e.image)}" alt="" loading="lazy" onerror="this.parentNode.classList.add('noimg');this.remove()"/></span>`
      : `<span class="evr-cover noimg">🎤</span>`;
    return `<a class="evrow"${e.url ? ` href="${esc(e.url)}" target="_blank" rel="noopener"` : ''}>
      ${cover}
      <span class="evr-txt"><b>${when}${e.time ? ' · ' + esc(e.time) : ''}</b>
        <span class="evr-name">${esc(who)}</span>
        ${e.artists && e.artists.length && e.name !== who ? `<span class="evr-sub">${esc(e.name)}</span>` : ''}</span>
      ${e.url ? '<span class="evr-go">Tickets ›</span>' : ''}</a>`;
  }).join('');
  const el = document.createElement('div');
  el.className = 'rdetail-ov';
  el.innerHTML = `<div class="rdetail-scrim"></div>
    <div class="rdetail-card">
      <div class="rdetail-head"><h3>This week · ${t.events.length} event${t.events.length === 1 ? '' : 's'}</h3><button class="msheet-x ev-x">✕</button></div>
      <div class="evlist">${rows}</div>
    </div>`;
  document.body.appendChild(el);
  const close = () => el.remove();
  el.querySelector('.rdetail-scrim').onclick = close;
  el.querySelector('.ev-x').onclick = close;
}
window.showVenueEvents = showVenueEvents;
// venues near the user that have a real Ticketmaster event, soonest/closest first
function eventsNearYou() {
  const d = S.data; if (!d) return [];
  let vs = d.venues.filter((v) => v.tonight);
  const R = eventRadiusKm(); // user-set radius (km) or 'all'
  if (S.userLoc) {
    vs.forEach((v) => { v._dist = haversineKm(S.userLoc, v.coords); });
    vs.sort((a, b) => a._dist - b._dist);
    if (R !== 'all') vs = vs.filter((v) => v._dist <= R); // strictly within the chosen radius
  } else {
    vs.sort((a, b) => (a.tonight.isTonight === b.tonight.isTonight) ? 0 : (a.tonight.isTonight ? -1 : 1));
  }
  return vs;
}
// a scrollable list of tonight/this-week's events near the user (opens the venue)
function showEventsNearYou() {
  const vs = eventsNearYou(); if (!vs.length) return;
  const rows = vs.map((v) => {
    const ev = v.tonight;
    const when = ev.isTonight ? 'Tonight' : eventDay(ev.date);
    const who = ev.artists && ev.artists.length ? ev.artists.join(', ') : ev.name;
    const cover = ev.image
      ? `<span class="evr-cover"><img src="${esc(ev.image)}" alt="" loading="lazy" onerror="this.parentNode.classList.add('noimg');this.remove()"/></span>`
      : `<span class="evr-cover noimg">🎤</span>`;
    const d = v._dist != null ? ' · ' + distLabel(v._dist) : '';
    return `<div class="evrow" onclick="closeEventsNear();rowClick('${v.id}')">
      ${cover}
      <span class="evr-txt"><b>${when}${ev.time ? ' · ' + esc(ev.time) : ''}${ev.count > 1 ? ' · +' + (ev.count - 1) + ' more' : ''}</b>
        <span class="evr-name">${esc(who)}</span>
        <span class="evr-sub">${esc(v.name)} · ${esc(v.neighborhoodName)}${esc(d)}</span></span>
      <span class="evr-go">View ›</span></div>`;
  }).join('');
  const el = document.createElement('div');
  el.className = 'rdetail-ov'; el.id = 'eventsNearOv';
  el.innerHTML = `<div class="rdetail-scrim"></div>
    <div class="rdetail-card">
      <div class="rdetail-head"><h3>Events ${(S.userLoc && eventRadiusKm() !== 'all') ? 'near you' : 'tonight'} · ${vs.length}</h3><button class="msheet-x ev-x">✕</button></div>
      <div class="evlist">${rows}</div>
    </div>`;
  document.body.appendChild(el);
  const close = () => el.remove();
  el.querySelector('.rdetail-scrim').onclick = close;
  el.querySelector('.ev-x').onclick = close;
}
function closeEventsNear() { const el = document.getElementById('eventsNearOv'); if (el) el.remove(); }
window.showEventsNearYou = showEventsNearYou;
window.closeEventsNear = closeEventsNear;
// tap a stacked map pin → list the venues sharing that spot so you can pick one
function showPinStack(members) {
  if (!members || members.length < 2) return;
  const list = members.slice().sort((a, b) => b.radar.score - a.radar.score);
  const rows = list.map((v) => {
    const band = bandKey(v.radar.score);
    const d = S.userLoc ? ' · ' + distLabel(haversineKm(S.userLoc, v.coords)) : '';
    const ev = v.tonight ? ' · 🎫 event' : '';
    const pic = v.googlePhoto || v.photo;
    const cover = pic
      ? `<span class="evr-cover"><img src="${esc(pic)}" alt="" loading="lazy" onerror="this.parentNode.classList.add('noimg');this.parentNode.style.background='${BAND_COLOR[band].core}';this.parentNode.style.color='#fff';this.replaceWith(document.createTextNode('${v.radar.score}'))"/></span>`
      : `<span class="evr-cover" style="background:${BAND_COLOR[band].core};color:#fff;font-weight:800;font-size:15px">${v.radar.score}</span>`;
    return `<div class="evrow" onclick="closePinStack();rowClick('${v.id}')">
      ${cover}
      <span class="evr-txt"><b>${esc(v.kind)}${esc(ev)}</b><span class="evr-name">${esc(v.name)}</span><span class="evr-sub">${esc(v.neighborhoodName)}${esc(d)}</span></span>
      <span class="evr-go">View ›</span></div>`;
  }).join('');
  const el = document.createElement('div'); el.className = 'rdetail-ov'; el.id = 'pinStackOv';
  el.innerHTML = `<div class="rdetail-scrim"></div>
    <div class="rdetail-card">
      <div class="rdetail-head"><h3>${list.length} venues here</h3><button class="msheet-x ev-x">✕</button></div>
      <div class="evlist">${rows}</div>
    </div>`;
  document.body.appendChild(el);
  const close = () => el.remove();
  el.querySelector('.rdetail-scrim').onclick = close;
  el.querySelector('.ev-x').onclick = close;
}
function closePinStack() { const el = document.getElementById('pinStackOv'); if (el) el.remove(); }
window.showPinStack = showPinStack;
window.closePinStack = closePinStack;

// ---- Clubbit AI chat (bottom-right nav) ----
const MASCOT = '/clubbit-mascot.png';
// The AI chat mascot matches the user's own profile: man→man, woman→woman,
// non-binary (or "prefer not to say")→the non-binary mascot.
function chatMascot() {
  const g = (typeof myProfile === 'function' && (myProfile() || {}).gender) || '';
  if (g === 'Woman') return '/clubbit-mascot-f.png';
  if (g === 'Non-binary' || g === 'Prefer not to say') return '/clubbit-mascot-nb.png';
  return '/clubbit-mascot.png'; // Man / unset
}
// per-gender positioning class so the character renders the same size in every avatar
function chatMascotClass() {
  const g = (typeof myProfile === 'function' && (myProfile() || {}).gender) || '';
  if (g === 'Woman') return 'mav-fem';
  if (g === 'Non-binary' || g === 'Prefer not to say') return 'mav-nb';
  return 'mav-man';
}
// one avatar element (a circular wrapper with the mascot positioned inside)
function chatAvatar(cls, extra) {
  return `<span class="${cls} ${chatMascotClass()}"${extra || ''}><img src="${chatMascot()}" alt="" onerror="this.style.display='none'"/></span>`;
}
function openChat() {
  closeSheet(); hideProfile();
  S.tab = 'chat'; setBn('chat');
  let ov = document.getElementById('chatScreen');
  if (!ov) {
    ov = document.createElement('div'); ov.id = 'chatScreen'; ov.className = 'chatscreen';
    ov.innerHTML = `
      <div class="chat-head">
        <span class="chat-title">${chatAvatar('chat-ai-av')}<span>Clubbit AI<small>Nightlife concierge</small></span></span>
        <button class="chat-close" id="chatClose" aria-label="Close chat"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      </div>
      <div class="chat-body" id="chatBody"></div>
      <form class="chat-inputbar" id="chatForm" autocomplete="off">
        <input id="chatInput" type="text" placeholder="Ask about any venue or where to party…" />
        <button class="chat-send" type="submit" aria-label="Send"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/></svg></button>
      </form>`;
    document.body.appendChild(ov);
    ov.querySelector('#chatClose').onclick = closeChat;
    ov.querySelector('#chatForm').onsubmit = (e) => { e.preventDefault(); const i = document.getElementById('chatInput'); const t = (i.value || '').trim(); if (!t || S._chatPending) return; i.value = ''; sendChat(t); };
  }
  // the header is built once, so refresh its mascot each open to match the current
  // profile (man / woman / non-binary)
  try { const av = ov.querySelector('.chat-ai-av'); if (av) { av.className = 'chat-ai-av ' + chatMascotClass(); const im = av.querySelector('img'); if (im) { im.src = chatMascot(); im.style.display = ''; } } } catch (e) {}
  // stop the panel above the bottom nav so the nav stays visible & tappable (always an exit)
  try { const nav = document.querySelector('.bottomnav'); ov.style.bottom = (nav ? nav.offsetHeight : 64) + 'px'; } catch (e) {}
  ov.hidden = false;
  // commit the closed (translateY 100%) start state with a forced reflow, THEN add
  // .open so the slide-up transition always plays — more reliable than rAF, which a
  // backgrounded tab throttles (and guarantees the panel rests at translateY(0) so
  // closing has a state to animate back down from).
  void ov.offsetHeight;
  ov.classList.add('open');
  if (S.chatMessages && S.chatMessages.length) renderChatMessages(); else renderChatWelcome();
  // refresh location so the starter suggestions match where you are right now —
  // but ONLY if location was already granted; opening chat must never pop the
  // permission prompt (we ask once, on first app open, and never again).
  if (!S.chatMessages || !S.chatMessages.length) {
    checkGeoPermission().then((st) => {
      if (st !== 'granted') return;
      getPosition({ enableHighAccuracy: true, timeout: 6000, maximumAge: 300000 })
        .then((p) => { S.userLoc = { lat: p.coords.latitude, lng: p.coords.longitude }; S._userIsGps = true; if (chatIsOpen() && (!S.chatMessages || !S.chatMessages.length)) renderChatWelcome(); })
        .catch(() => {});
    }).catch(() => {});
  }
  // don't auto-focus the input on open — that pops the keyboard and hides the
  // recommended questions. The keyboard appears only when you tap the text box.
}
function closeChat() {
  const ov = document.getElementById('chatScreen');
  if (ov) {
    ov.classList.add('closing');   // crisp accelerate-out easing for the dismiss
    ov.classList.remove('open');   // slide back down, then hide once it's off-screen
    setTimeout(() => { if (ov && !ov.classList.contains('open')) { ov.hidden = true; ov.classList.remove('closing'); } }, 300);
  }
  setBn('map'); S.tab = 'near';
}
function chatIsOpen() { const c = document.getElementById('chatScreen'); return !!(c && !c.hidden); }
function closeChatAndOpen(id) { closeChat(); if (typeof rowClick === 'function') rowClick(id); }
window.openChat = openChat; window.closeChat = closeChat; window.closeChatAndOpen = closeChatAndOpen;
// nearest city to a coordinate, from the venues we already have loaded — used to
// tailor the AI's starter suggestions to wherever you are when you open it
function nearestCity(loc) {
  if (!loc || !S.data || !S.data.venues) return null;
  let best = null, bestD = Infinity;
  for (const v of S.data.venues) { if (!v.coords) continue; const d = haversineKm(loc, v.coords); if (d < bestD) { bestD = d; best = v.city; } }
  return (best && bestD <= 150) ? best : null; // only if you're plausibly in/near it
}
function renderChatWelcome() {
  const body = document.getElementById('chatBody'); if (!body) return;
  const n = (S.data && S.data.venues) ? S.data.venues.length : 'thousands of';
  const city = nearestCity(S.userLoc);
  const chips = city
    ? [`Best clubs in ${city}?`, `Where should I party tonight in ${city}?`, `Best area for a night out in ${city}`, 'Cheap bars near me']
    : ['Best clubs near me?', 'Where should I party tonight?', 'Best area for a night out near me', 'Cheap bars near me'];
  body.innerHTML = `<div class="chat-welcome">
      ${chatAvatar('chat-welcome-av')}
      <h3>Ask me anything about nightlife</h3>
      <p>Venues, vibes, the best areas to party — I've got live data on ${esc(String(n))} spots worldwide.</p>
      <div class="chat-chips">${chips.map((c) => `<button class="chat-chip" onclick="sendChat(this.textContent)">${esc(c)}</button>`).join('')}</div>
    </div>`;
}
function chatMd(t) {
  let h = esc(t);
  h = h.replace(/(^|\n)\s*[*\-•]\s+/g, '$1• ');            // bullets (*, -, •)
  h = h.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');            // bold
  h = h.replace(/\*(?!\s)([^*\n]+?)\*/g, '<i>$1</i>');     // italic
  return h.replace(/\n/g, '<br>');
}
// markdown for a PARTIALLY-revealed message (typewriter): drop a half-typed
// marker at the end and auto-close an open bold so no stray "**" flashes.
function partialMd(t) {
  let s = String(t).replace(/\*{1,2}$/, '');
  if (((s.match(/\*\*/g) || []).length) % 2) s += '**';
  return chatMd(s);
}
// Reveal the last assistant message character-by-character (snapping to word
// boundaries) so it "types out" instead of popping in whole. Chips appear at the end.
function typeOutLast(done) {
  const idx = (S.chatMessages || []).length - 1;
  const m = S.chatMessages[idx];
  if (!m || m.role !== 'assistant' || !m.content) { renderChatMessages(); done && done(); return; }
  const full = m.content; m._typing = true; m._typed = 0;
  const tick = () => {
    if (!chatIsOpen() || S.chatMessages[idx] !== m) { m._typing = false; return; } // panel closed / superseded
    m._typed = Math.min(full.length, m._typed + 2);
    while (m._typed < full.length && /\S/.test(full[m._typed])) m._typed++; // finish the current word
    renderChatMessages();
    if (m._typed < full.length) setTimeout(tick, 18);
    else { m._typing = false; renderChatMessages(); done && done(); }
  };
  tick();
}
// venues the assistant named → clickable chips. The AI bolds the venues it
// recommends, so match those first (precise); fall back to a strict word scan.
function findMentionedVenues(text) {
  const d = S.data; if (!d || !text) return [];
  const bolds = (text.match(/\*\*([^*]+)\*\*/g) || []).map((s) => s.replace(/\*\*/g, '').trim().toLowerCase());
  const out = [], seen = new Set();
  const add = (v) => { if (!seen.has(v.id)) { seen.add(v.id); out.push({ id: v.id, name: v.name, photo: v.googlePhoto || v.photo || null }); } };
  if (bolds.length) {
    for (const v of d.venues) {
      if (out.length >= 6) break;
      const nm = v.name.toLowerCase();
      if (bolds.some((bd) => bd === nm || (nm.length >= 5 && (bd.includes(nm) || nm.includes(bd))))) add(v);
    }
    if (out.length) return out;
  }
  const low = ' ' + text.toLowerCase() + ' ';
  for (const v of d.venues) {
    if (out.length >= 6) break;
    const nm = v.name.toLowerCase(); if (nm.length < 5) continue;
    const i = low.indexOf(nm); if (i < 0) continue;
    if (/[a-z0-9]/.test(low[i - 1] || '') || /[a-z0-9]/.test(low[i + nm.length] || '')) continue;
    add(v);
  }
  return out;
}
function renderChatMessages() {
  const body = document.getElementById('chatBody'); if (!body) return;
  const rows = (S.chatMessages || []).map((m) => {
    if (m.role !== 'assistant') return `<div class="chat-msg user"><div class="chat-bubble">${esc(m.content)}</div></div>`;
    // while typing out, show the revealed slice (+ a caret) and hold the chips back
    const body = m._typing ? partialMd(m.content.slice(0, m._typed)) + '<span class="chat-caret"></span>' : chatMd(m.content);
    const chips = (!m._typing && m.venues && m.venues.length) ? `<div class="chat-venues">${m.venues.map((v) => `<button class="chat-venue-chip" onclick="closeChatAndOpen('${v.id}')">${v.photo ? `<img src="${esc(v.photo)}" alt="" loading="lazy" onerror="this.remove()"/>` : '<span class="cvc-ic">📍</span>'}<span class="cvc-name">${esc(v.name)}</span><span class="cvc-go">›</span></button>`).join('')}</div>` : '';
    return `<div class="chat-msg assistant">${chatAvatar('chat-av')}<div class="chat-col"><div class="chat-bubble">${body}</div>${chips}</div></div>`;
  }).join('');
  const typing = S._chatPending ? `<div class="chat-msg assistant"><span class="chat-av-load">${chatAvatar('chat-av')}</span><div class="chat-col"><div class="chat-bubble typing"><span></span><span></span><span></span></div></div></div>` : '';
  body.innerHTML = rows + typing;
  body.scrollTop = body.scrollHeight;
}
async function sendChat(text) {
  text = String(text || '').trim(); if (!text || S._chatPending) return;
  if (!S.chatMessages) S.chatMessages = [];
  S.chatMessages.push({ role: 'user', content: text });
  S._chatPending = true; renderChatMessages();
  // "near me" answers need the freshest REAL location — grab a fresh GPS fix
  let loc = S.userLoc || null;
  if (/\bnear me\b|\bnearby\b|\baround me\b|\bmy area\b|\bnear here\b/i.test(text)) {
    try { const p = await getPosition({ enableHighAccuracy: true, timeout: 6000, maximumAge: 300000 }); loc = { lat: p.coords.latitude, lng: p.coords.longitude }; S.userLoc = loc; S._userIsGps = true; } catch (e) {}
  }
  try {
    const hist = S.chatMessages.filter((m) => m.role === 'user' || m.role === 'assistant').map((m) => ({ role: m.role, content: m.content })).slice(-12);
    const r = await API.chat(hist, loc);
    const reply = (r && r.reply) || "Sorry, I couldn't answer that one.";
    S.chatMessages.push({ role: 'assistant', content: reply, venues: findMentionedVenues(reply) });
  } catch (e) {
    S.chatMessages.push({ role: 'assistant', content: "Sorry, I'm having trouble connecting right now — try again in a moment." });
  }
  S._chatPending = false;
  typeOutLast(); // reveal the reply with a typewriter effect (chips appear at the end)
}
window.sendChat = sendChat;
// the "Events near you" call-to-action, shown in the Tonight feed AND the main list
function eventsCtaHtml() {
  const nearEv = eventsNearYou();
  if (!nearEv.length) return '';
  const evLabel = (S.userLoc && eventRadiusKm() !== 'all') ? 'near you' : 'tonight';
  return `<button class="events-cta" onclick="showEventsNearYou()">
      <span class="ec-ic">🎫</span>
      <span class="ec-txt"><b>${nearEv.length} event${nearEv.length === 1 ? '' : 's'} ${evLabel}</b><span>Live lineups · tap to browse</span></span>
      <span class="ec-go">›</span></button>`;
}
async function deleteMyReport(id) {
  if (!confirm('Delete your report? This removes your report and its photo from this venue.')) return;
  try {
    const r = await API.deleteReport(id);
    if (r && r.ok) {
      // don't blindly decrement the level here — the server decides whether the
      // point rolls back (only if the report was younger than 24h); renderProfile
      // re-fetches and syncs the level counter to that authoritative total.
      toast('Report deleted');
      if (S.tab === 'profile') renderProfile();       // refresh the profile overview
      else if (S.activeVenue) openVenue(S.activeVenue); // or reload the venue card
      refreshSoon();
    } else toast('Could not delete' + (r && r.error ? ': ' + r.error : ''));
  } catch { toast('Could not delete'); }
}
window.deleteMyReport = deleteMyReport;
async function deleteMyMedia(id) {
  if (!confirm('Delete this photo? This also removes the report it belongs to.')) return;
  try {
    const r = await API.deleteMedia(id);
    if (r && r.ok) { toast('Photo deleted'); renderProfile(); }
    else toast('Could not delete' + (r && r.error ? ': ' + r.error : ''));
  } catch { toast('Could not delete'); }
}
window.deleteMyMedia = deleteMyMedia;

function openSheet(tab) {
  if (tab === 'profile') { showProfile(); return; }
  if (tab) setTab(tab);
  hideProfile();
  $('#sheet').classList.add('open'); $('#sheetScrim').hidden = false; S.sheetOpen = true;
}
function closeSheet() {
  hideProfile();
  $('#sheet').classList.remove('open'); $('#sheetScrim').hidden = true;
  S.sheetOpen = false; S.reportPick = false;
  $('#sheetSearch').hidden = true; S.query = ''; const si = $('#searchInput'); if (si) si.value = '';
  setBn('map');
}
function rowClick(id) {
  if (S.reportPick) { S.reportPick = false; closeSheet(); startReport(id); }
  else openVenue(id);
}

function syncHeaderOffset() {
  const bar = document.querySelector('.appbar');
  if (bar) document.documentElement.style.setProperty('--appbar-h', Math.round(bar.getBoundingClientRect().height) + 'px');
}
function initUI() {
  map = new RadarMap();
  syncHeaderOffset();
  window.addEventListener('resize', syncHeaderOffset);
  const scene = document.querySelector('.appbar-scene');
  if (scene) { if (scene.complete) syncHeaderOffset(); scene.addEventListener('load', syncHeaderOffset); }

  // location gate
  $('#gateAllow').addEventListener('click', requestLocation);
  $('#gateSkip').addEventListener('click', skipGate);

  // app bar
  $('#brandHome').addEventListener('click', () => { map.fit(); closeVenue(); closeSheet(); });
  $('#profileBtn').addEventListener('click', () => openSheet('profile'));
  $('#feedBtn').addEventListener('click', () => openSheet('feed'));

  // search
  $('#searchBtn').addEventListener('click', () => {
    openSheet('near'); $('#sheetSearch').hidden = false; $('#searchInput').focus();
  });
  $('#searchInput').addEventListener('input', (e) => {
    S.query = e.target.value; renderSheet();
    // move the map to the matches so an area/country search actually shows pins
    clearTimeout(_searchFlyT);
    _searchFlyT = setTimeout(() => {
      const q = (S.query || '').trim();
      if (q.length < 2 || !S.data) return; // don't fly to the whole globe on one letter
      const matches = S.data.venues.filter(venueMatches);
      if (matches.length) map.fitToVenues(matches);
    }, 420);
  });

  // floating buttons
  $('#locateFab').addEventListener('click', recenterToMe);
  $('#addFab').addEventListener('click', () => { S.reportPick = true; openSheet('near'); toast('Tap a place to report the vibe'); });

  // list + bottom nav
  $('#listBtn').addEventListener('click', () => openSheet('near'));
  document.querySelectorAll('.bn').forEach((b) => b.addEventListener('click', () => {
    const nav = b.dataset.nav;
    if (nav === 'chat') { if (chatIsOpen()) closeChat(); else openChat(); return; }
    if (chatIsOpen()) closeChat(); // any other tab exits the AI
    if (nav === 'map') { closeSheet(); }
    else openSheet(nav);
  }));

  // sheet chrome
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => setTab(t.dataset.tab)));
  $('#sheetGrip').addEventListener('click', closeSheet);
  $('#sheetScrim').addEventListener('click', closeSheet);

  // match the header logo to the saved theme on load (dark uses a transparent-bg logo)
  if (currentTheme() === 'dark') { const _logo = $('#brandHome'); if (_logo) _logo.src = '/mascot-dark.png'; }

  // settings + language sheets
  const sb = $('#settingsBtn'); if (sb) sb.addEventListener('click', openSettings);
  const sc = $('#settingsClose'); if (sc) sc.addEventListener('click', () => closeMSheet('#settingsSheet', '#settingsScrim'));
  const ss = $('#settingsScrim'); if (ss) ss.addEventListener('click', () => closeMSheet('#settingsSheet', '#settingsScrim'));
  const lc = $('#langClose'); if (lc) lc.addEventListener('click', () => closeMSheet('#langSheet', '#langScrim'));
  const ls = $('#langScrim'); if (ls) ls.addEventListener('click', () => closeMSheet('#langSheet', '#langScrim'));
  // fullscreen media viewer
  const lbc = $('#lbClose'); if (lbc) lbc.addEventListener('click', closeLightbox);
  const lbx = $('#lightbox'); if (lbx) lbx.addEventListener('click', (e) => { const t = e.target; if (t === lbx || t.id === 'lbTrack' || t.classList.contains('lb-slide')) closeLightbox(); });
  document.querySelectorAll('[data-close]').forEach((s) => s.addEventListener('click', closeVenue));
}

initUI();
// Keyboard-aware overlays: track the soft-keyboard height via the visual viewport
// and expose it as --kb, so a fixed sheet (e.g. the report note step) can lift its
// controls above the keyboard instead of letting them hide behind it.
(function initKeyboardInset() {
  const vv = window.visualViewport;
  if (!vv) return;
  let raf = 0;
  const apply = () => {
    raf = 0;
    const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    // ignore tiny deltas (URL-bar jitter) so we don't fight the layout
    document.documentElement.style.setProperty('--kb', (kb > 80 ? kb : 0) + 'px');
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(apply); };
  vv.addEventListener('resize', schedule);
  vv.addEventListener('scroll', schedule);
  apply();
})();
// Resolve location RIGHT AWAY (from the saved fix) so the user's pin appears
// immediately, instead of waiting for the first /api/state fetch to come back.
if (!S.booted) { S.booted = true; bootLocation(); }
// Paint the last-known venues instantly from cache so the map isn't empty while the
// (possibly cold) backend answers; refresh() then swaps in the live data.
bootFromCache();
refresh();
setInterval(refresh, 20000);
window.rowClick = rowClick;
window.openVenue = openVenue; window.openArea = openArea; window.closeVenue = closeVenue;
window.checkIn = checkIn; window.sendPulse = sendPulse;
window.startReport = startReport; window.closeReport = closeReport;
window.pickReport = pickReport; window.nextReport = nextReport; window.prevReport = prevReport;
window.afterReport = afterReport;
window.takeMeThere = takeMeThere;
window.openInsta = openInsta;
