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
  me: () => fetch('/api/me').then(r => r.json()),
  deleteMedia: (id) => post('/api/media/delete', { id }),
  deleteReport: (id) => post('/api/report/delete', { id }),
  deleteAccount: (token) => post('/api/auth/delete', { token }),
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
function distLabel(km) { return km < 1 ? Math.round(km * 1000) + ' m' : km < 10 ? km.toFixed(1) + ' km' : Math.round(km) + ' km'; }
function cityOf(v) { const a = (S.data.areas || []).find((x) => x.id === v.neighborhood); return (a && a.city) || v.neighborhoodName; }

// ---------- band / label helpers ----------
function bandKey(score) {
  if (score >= 84) return 'red'; if (score >= 70) return 'pop'; if (score >= 56) return 'busy';
  if (score >= 42) return 'heat'; if (score >= 26) return 'chill'; return 'quiet';
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
  }
  _initMap() {
    // slick DARK vector basemap, keyless (OpenFreeMap "Dark"): same streets/labels,
    // dark theme — MapLibre GL renders it.
    this.map = new maplibregl.Map({
      container: 'map',
      style: 'https://tiles.openfreemap.org/styles/dark',
      center: [23.727, 37.978], zoom: 13, minZoom: 1, maxZoom: 18,
      attributionControl: false, dragRotate: false, pitchWithRotate: false,
      renderWorldCopies: true,
    });
    this.map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
    if (this.map.touchZoomRotate) this.map.touchZoomRotate.disableRotation();
    // render as a 3D globe when zoomed out (MapLibre v5+); falls back silently
    const enableGlobe = () => { try { if (this.map && this.map.setProjection) this.map.setProjection({ type: 'globe' }); } catch (e) {} };
    this.map.on('style.load', enableGlobe);
    const ready = () => { if (this._ready) return; this._ready = true; enableGlobe(); this._buildMarkers(); this._initialCamera(); };
    this.map.on('load', ready);
    this.map.on('idle', ready); // fires after first real render (self-heals a 0-size start)
    this.map.on('error', (e) => console.warn('map error', e && e.error && e.error.message));
    this.map.on('click', (e) => this._tap(e.point.x, e.point.y));
    this.map.on('zoom', () => this._syncSoon());
    this.map.on('moveend', () => { this._syncSoon(); if (typeof renderFilters === 'function') renderFilters(); });
    // safety net: if the GL map never renders (WebGL/style trouble), drop to the simple map
    setTimeout(() => {
      if (this._ready) return;
      console.warn('map not ready in time — using fallback');
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
    if (m) m.style.background = '#14151c';
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
    if (!this.map || this._ready) this._buildMarkers();
    if (first) this._initialCamera();
  }
  // Create the DOM marker for one venue (structure only; live state via _applyPinState)
  _markerFor(v) {
    const col = BAND_COLOR[bandKey(v.radar.score)].core;
    const el = document.createElement('div');
    if (v.photo && !v.lgbtq) {
      el.className = 'pin photo';
      el.innerHTML = `<div class="pin-body" style="--pc:${col}"><img class="pin-photo" src="${v.photo}" alt="" loading="lazy" /></div>`;
    } else {
      el.className = 'pin' + (v.lgbtq ? ' lgbtq' : '');
      el.innerHTML = `<div class="pin-body" style="--pc:${col}"><span class="pin-ic">${venueIcon(v)}</span></div>`;
    }
    el.addEventListener('click', (ev) => { ev.stopPropagation(); openVenue(v.id); });
    const wrap = document.createElement('div'); wrap.className = 'pin-wrap'; wrap.appendChild(el);
    wrap.style.zIndex = '4'; // venue pins sit ABOVE neighbourhood labels
    const marker = new maplibregl.Marker({ element: wrap, anchor: 'bottom', opacityWhenCovered: '0' }).setLngLat([v.coords.lng, v.coords.lat]);
    marker._lng = v.coords.lng; marker._lat = v.coords.lat; marker._el = el; marker._vid = v.id;
    return marker;
  }
  // Update a venue pin's live state (colour / open / selected) in place — no DOM churn
  _applyPinState(el, v) {
    const band = bandKey(v.radar.score);
    el.classList.toggle('closed', v.open === false);
    if (!(v.photo && !v.lgbtq)) el.classList.toggle('amber', band === 'busy');
    el.classList.toggle('sel', this.selected === v.id);
    const body = el.querySelector('.pin-body'); if (body) body.style.setProperty('--pc', BAND_COLOR[band].core);
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
    const vis = matching.filter((v) => inView(v.coords));
    return vis.length ? vis : matching; // fallback if getBounds glitches
  }
  // A count "cluster" bubble marker for a city — shows how many venues are there.
  _clusterFor(w) {
    const el = document.createElement('div');
    el.className = 'cluster';
    el.innerHTML = `<span class="cl-count">${w.n}</span>`;
    el.title = `${w.name} · ${w.n} venue${w.n === 1 ? '' : 's'}`;
    el.addEventListener('click', (ev) => { ev.stopPropagation(); if (this.map) this.map.flyTo({ center: [w.center.lng, w.center.lat], zoom: 11.8, duration: 900 }); });
    const m = new maplibregl.Marker({ element: el, anchor: 'center', opacityWhenCovered: '0' }).setLngLat([w.center.lng, w.center.lat]);
    m._el = el; return m;
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
      // near the boundary doesn't flicker bubbles and pins in and out.
      if (this._clusterMode === undefined) this._clusterMode = z < 6;
      if (this._clusterMode && z > 6.3) this._clusterMode = false;
      else if (!this._clusterMode && z < 5.7) this._clusterMode = true;
      const clusterMode = this._clusterMode;

      // ---- count bubbles (clusters) per city ----
      const wantC = {};
      if (clusterMode) {
        const g = {};
        for (const v of this.venues) {
          if (!venueMatches(v)) continue;
          const c = v.city || '?';
          (g[c] || (g[c] = { lat: 0, lng: 0, n: 0, name: c }));
          g[c].lat += v.coords.lat; g[c].lng += v.coords.lng; g[c].n++;
        }
        for (const c in g) wantC[c] = { name: c, n: g[c].n, center: { lat: g[c].lat / g[c].n, lng: g[c].lng / g[c].n } };
      }
      for (const id of Object.keys(this._clusterById)) {
        if (!wantC[id]) { this._clusterById[id].remove(); delete this._clusterById[id]; }
      }
      for (const id in wantC) {
        const w = wantC[id]; let m = this._clusterById[id];
        if (!m) { m = this._clusterFor(w); m.addTo(this.map); this._clusterById[id] = m; }
        else { const b = m._el.querySelector('.cl-count'); if (b) b.textContent = w.n; m.setLngLat([w.center.lng, w.center.lat]); }
      }

      // ---- individual venue pins (only when zoomed in) ----
      const wanted = {};
      if (!clusterMode) for (const v of this._wantedVenues()) wanted[v.id] = v;
      for (const id of Object.keys(this._markerById)) {
        if (!wanted[id]) { this._markerById[id].remove(); delete this._markerById[id]; }
      }
      for (const id in wanted) {
        let m = this._markerById[id];
        if (!m) { m = this._markerFor(wanted[id]); m.addTo(this.map); this._markerById[id] = m; }
        this._applyPinState(m._el, wanted[id]);
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
    } catch (e) { console.warn('marker sync failed', e); }
  }
  _buildMarkers() { this._syncMarkers(); }             // alias (filter/first build re-eval all)
  // Throttle (not debounce): update markers WHILE zooming/panning so pins appear as
  // you move, instead of only ~120ms after you stop.
  _syncSoon() {
    const t = Date.now();
    if (this._lastSync && t - this._lastSync < 90) {
      clearTimeout(this._syncT);
      this._syncT = setTimeout(() => { this._lastSync = Date.now(); this._syncMarkers(); }, 90);
      return;
    }
    this._lastSync = t;
    this._syncMarkers();
  }
  _updateLabelVis() { this._syncSoon(); }
  // When zoomed out, venue pins pile on top of each other. Fan any overlapping
  // cluster into a lollipop bouquet: every stem stays pinned to the SAME point
  // and the heads spread out in an arc (like pins in a cushion).
  _spreadOverlaps() {
    if (!this.map || !this._ready || !this._markers || !this._markers.length) return;
    const reset = (m) => { m.setLngLat([m._lng, m._lat]); m._el.style.transform = ''; m._el.style.transformOrigin = ''; m.getElement().style.zIndex = ''; m.getElement().style.display = ''; };
    // only fan out when zoomed OUT — at city zoom keep normal pins in place
    if (this.map.getZoom() >= 12) { this._markers.forEach(reset); return; }
    const pts = this._markers.map((m) => { const p = this.map.project([m._lng, m._lat]); return { m, x: p.x, y: p.y }; });
    const used = new Array(pts.length).fill(false);
    const R = 26; // px: pins closer than this are treated as overlapping
    for (let i = 0; i < pts.length; i++) {
      if (used[i]) continue;
      const group = [i]; used[i] = true;
      for (let j = i + 1; j < pts.length; j++) {
        if (used[j]) continue;
        const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y;
        if (dx * dx + dy * dy < R * R) { group.push(j); used[j] = true; }
      }
      if (group.length === 1) { reset(pts[i].m); continue; }
      // pin all tips to the shared city point, then fan the bodies out at the top
      // by rotating each pin around its tip (bottom) — connected at the base.
      // Cap the fan at 3 pins so the row stays small; hide the rest until zoom-in.
      let clat = 0, clng = 0;
      group.forEach((gi) => { clat += pts[gi].m._lat; clng += pts[gi].m._lng; });
      clat /= group.length; clng /= group.length;
      const shown = group.slice(0, 3);
      group.slice(3).forEach((gi) => { const m = pts[gi].m; reset(m); m.getElement().style.display = 'none'; });
      const k = shown.length;
      const total = k === 3 ? 52 : 30; // total fan angle in degrees
      shown.forEach((gi, idx) => {
        const m = pts[gi].m;
        const ang = k === 1 ? 0 : (idx / (k - 1) - 0.5) * total;
        m.setLngLat([clng, clat]);
        m._el.style.transformOrigin = 'bottom center';
        m._el.style.transform = `rotate(${ang.toFixed(1)}deg)`;
        m.getElement().style.zIndex = '4';
      });
    }
  }
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
    if (!this.bounds && this.map) return;
    this._camDone = true;
    if (S.userLoc && S._rememberFly) {
      S._rememberFly = false;
      if (S._userIsGps) this.setUserLocation(S.userLoc);
      const t = S._flyTarget || S.userLoc;
      this.flyToLatLng(t.lat, t.lng, 12.5);
    } else this.fit(true);
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
  focusArea(area) {
    if (this.map && this._ready) this.map.flyTo({ center: [area.center.lng, area.center.lat], zoom: 15.5, duration: 800 });
    this.zoomed = true; const zr = document.getElementById('zoomReset'); if (zr) zr.hidden = false;
  }
  _tap(px, py) {
    let best = null, bestD = 30;
    for (const v of this.venues) {
      const s = this.proj(v.coords);
      const d = Math.hypot(s.x - px, s.y - py);
      if (d < bestD) { bestD = d; best = v; }
    }
    if (best) { openVenue(best.id); return; }
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
function venueRow(v) {
  const closed = v.open === false;
  const band = closed ? 'quiet' : bandKey(v.radar.score);
  const mc = momClass(v.momentum.state);
  const sub = [v.neighborhoodName, v.category];
  sub.push(closed && v.hours ? 'Opens ' + v.hours.opensLabel : `${v.recentSignals} signals`);
  if (v.google && v.google.rating) sub.push('★ ' + v.google.rating);
  if (v._dist != null) sub.unshift('📍 ' + distLabel(v._dist));
  const tile = (closed && v.googlePhoto)
    ? `<div class="vthumb"><img src="${esc(v.googlePhoto)}" alt="" loading="lazy" onerror="this.parentNode.classList.add('noimg')" /><span class="vthumb-badge">CLOSED</span></div>`
    : `<div class="vscore${band === 'busy' ? ' amber' : ''}" style="background:${BAND_COLOR[band].core}">${closed ? '—' : v.radar.score}<small>${closed ? 'CLOSED' : 'SCORE'}</small></div>`;
  return `<div class="vrow${closed ? ' closed' : ''}" onclick="rowClick('${v.id}')">
    ${tile}
    <div class="vmeta">
      <div class="vname">${esc(v.name)} ${v.verified ? '<span class="verified">✔</span>' : ''}</div>
      <div class="vsub">${sub.map((x, i) => (i ? '<i class="dot"></i>' : '') + `<span>${esc(x)}</span>`).join('')}</div>
    </div>
    <div class="vright">
      <div class="vlabel c-${band}">${closed ? 'CLOSED' : esc(v.radar.label)}</div>
      <div class="vmom ${closed ? 'c-steady' : mc}">${closed ? (v.hours ? 'opens ' + v.hours.opensLabel : 'closed') : v.momentum.arrow + ' ' + (v.momentum.state === 'steady' ? 'STEADY' : (v.pct != null && v.pct > 0 ? '+' + v.pct + '%' : v.momentum.label))}</div>
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
      vs.sort((a, b) => b.radar.score - a.radar.score);
      title = `Results for “${S.query.trim()}”`;
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
    body.innerHTML = banner + head + (vs.length ? vs.map(venueRow).join('') : '<div class="empty">No places match that filter.</div>');
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
      <span class="count">${esc(S.locLabel || d.city || '')}</span></div>` + feedRows();
  }
}

// A "near you tonight" feed: nearby venues turned into actionable picks
// (go now, opening soon, peaking), each with an Instagram link for tonight's
// lineup/events. Built from the venues already loaded, ranked by proximity.
function feedRows() {
  const d = S.data; if (!d) return '';
  let vs = [...d.venues];
  if (S.userLoc) {
    vs.forEach((v) => { v._dist = haversineKm(S.userLoc, v.coords); });
    const near = vs.filter((v) => v._dist <= 40);
    vs = near.length ? near : vs.sort((a, b) => a._dist - b._dist).slice(0, 20);
  }
  const seen = new Set();
  const rows = [];
  const add = (v, emoji, text, sub) => {
    if (seen.has(v.id) || rows.length >= 14) return; seen.add(v.id);
    // show the club's photo when we have one; fall back to the coloured emoji tile
    const ic = v.googlePhoto
      ? `<div class="feed-ic photo"><img src="${esc(v.googlePhoto)}" alt="" loading="lazy" onerror="this.parentNode.classList.remove('photo');this.parentNode.style.background='${BAND_COLOR[bandKey(v.radar.score)].core}';this.replaceWith(document.createTextNode('${emoji}'))" /><span class="feed-ic-tag">${emoji}</span></div>`
      : `<div class="feed-ic" style="background:${BAND_COLOR[bandKey(v.radar.score)].core}">${emoji}</div>`;
    rows.push(`<div class="feed-item" onclick="rowClick('${v.id}')">
      ${ic}
      <div class="feed-txt"><b>${esc(text)}</b>
        <div class="fsub">${esc(sub)}</div>
        ${v.instagram ? `<button class="feed-ig" onclick="event.stopPropagation();openInsta('${v.id}')">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.1" fill="currentColor" stroke="none"/></svg>
          What's on tonight</button>` : ''}</div>
    </div>`);
  };
  const openV = vs.filter((v) => v.open).sort((a, b) => b.radar.score - a.radar.score);
  const dist = (v) => v._dist != null ? ' · ' + distLabel(v._dist) : '';
  // 1) tonight's top pick
  if (openV[0]) add(openV[0], '⭐', `Tonight: head to ${openV[0].name}`, `${openV[0].radar.label} now · ${openV[0].neighborhoodName}${openV[0].hours ? ' · till ' + openV[0].hours.closesLabel : ''}`);
  // 2) popping / heating up right now
  vs.filter((v) => v.open && ['surging', 'exploding', 'heating'].includes(v.momentum.state))
    .sort((a, b) => b.momentum.M - a.momentum.M).slice(0, 4)
    .forEach((v) => add(v, '🔥', `${v.name} is ${v.momentum.state === 'heating' ? 'heating up' : 'popping off'}`, `${v.neighborhoodName}${v.pct > 0 ? ' · +' + v.pct + '%' : ''}${dist(v)}`));
  // 3) peaks later tonight
  openV.filter((v) => v.expectedPeak).slice(0, 3)
    .forEach((v) => add(v, '⏰', `${v.name} peaks around ${v.expectedPeak}`, `${v.neighborhoodName}${dist(v)}`));
  // 4) opening later tonight (closed clubs nearby)
  vs.filter((v) => !v.open && v.hours && v.hours.opensLabel)
    .sort((a, b) => b.radar.score - a.radar.score).slice(0, 5)
    .forEach((v) => add(v, '🌙', `${v.name} opens ${v.hours.opensLabel}`, `${v.neighborhoodName}${v.dress ? ' · ' + v.dress.code : ''}${dist(v)}`));
  return rows.length ? rows.join('') : '<div class="empty">No venues near you right now — try zooming the map or picking a city.</div>';
}

/* ============================================================
   VENUE DETAIL
   ============================================================ */
async function openVenue(id) {
  S.activeVenue = id; map.selected = id; map.refreshSelection && map.refreshSelection();
  closeSheet();
  const ov = $('#venueOverlay'); ov.hidden = false;
  $('#venueCard').innerHTML = '<div class="vc-hero skel" style="height:220px"></div>';
  const v = await API.venue(id);
  if (S.activeVenue !== id) return;
  S.activeVenueData = v; // full detail incl. Google place id + reviews
  renderVenue(v);
}
function closeVenue() { $('#venueOverlay').hidden = true; S.activeVenue = null; S.activeVenueData = null; map.selected = null; map.refreshSelection && map.refreshSelection(); }

// tap any community photo/video to view it full screen, with the poster's avatar
function openLightbox(url, type, by) {
  const lb = $('#lightbox'), stage = $('#lbStage'); if (!lb || !stage) return;
  stage.innerHTML = (type === 'video')
    ? `<video src="${url}" controls autoplay playsinline loop></video>`
    : `<img src="${url}" alt="" />`;
  const badge = $('#lbBy');
  if (badge) {
    if (by && by.photo) { badge.innerHTML = `<img src="${by.photo}" alt="" onerror="this.remove()" />${by.name ? `<span>${esc(by.name)}</span>` : ''}`; badge.hidden = false; }
    else badge.hidden = true;
  }
  lb.hidden = false;
}
function closeLightbox() { const lb = $('#lightbox'); if (!lb) return; lb.hidden = true; $('#lbStage').innerHTML = ''; }
window.openLightbox = openLightbox;
// venue media: resolve the poster's avatar from the loaded venue data (avoids
// putting a big data-URL in an onclick attribute)
window.lbShow = function (id) {
  const list = (S.activeVenueData && S.activeVenueData.media) || [];
  const m = list.find((x) => x.id === id); if (!m) return;
  openLightbox(m.url, m.type, m.by || null);
};
// profile media: it's the current user's own upload → show their avatar
window.lbShowMine = function (url, type) {
  const p = myProfile();
  openLightbox(url, type, { photo: myFace(p), name: p.firstName || 'You' });
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
function reportRundown(v, r, i) {
  const rows = [['Vibe', cap(VIBE_WORD[r.vibe] || r.vibe)]];
  if (r.queue && QUEUE_LABEL[r.queue]) rows.push(['Queue', QUEUE_LABEL[r.queue]]);
  if (r.entry != null) rows.push(['Entry', r.entry === 0 ? 'Free' : fmtCur(r.entry, v.currency)]);
  if (r.mix && MIX_LABEL[r.mix]) rows.push(['Crowd', MIX_LABEL[r.mix]]);
  if (r.music) rows.push(['Music', r.music]);
  const photo = r.mediaUrl ? (r.mediaType === 'video'
    ? `<video class="rr-media" src="${r.mediaUrl}" muted playsinline loop autoplay preload="metadata" onclick="event.stopPropagation();lbShow('${r.mediaId || ''}')"></video>`
    : `<img class="rr-media" src="${r.mediaUrl}" alt="" loading="lazy" onclick="event.stopPropagation();lbShow('${r.mediaId || ''}')" />`) : '';
  return `<div class="rep-rundown" id="rr_${v.id}_${i}" hidden>
    ${photo}
    ${rows.map(([k, val]) => `<div class="rr-row"><span class="rr-k">${esc(k)}</span><span class="rr-v">${esc(val)}</span></div>`).join('')}
    ${r.note ? `<div class="rr-note">“${esc(r.note)}”</div>` : ''}
  </div>`;
}
function toggleRundown(id) {
  const el = document.getElementById(id); if (!el) return;
  el.hidden = !el.hidden;
  const item = el.previousElementSibling; if (item) item.classList.toggle('open', !el.hidden);
}
window.toggleRundown = toggleRundown;
function recentReportsBlock(v) {
  const rs = (v.recentReports || []).filter((r) => r && r.name);
  if (!rs.length) return '';
  const chev = '<svg class="rep-chev" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>';
  return `<div class="reports-block">
    <div class="section-h"><h3>What people are saying</h3><span class="count">${rs.length}</span></div>
    ${rs.map((r, i) => `<div class="rep-item" onclick="toggleRundown('rr_${v.id}_${i}')">
      <img class="rep-face" src="${esc(r.photo || '/clubbit-mascot.png')}" alt="" onerror="this.src='/clubbit-mascot.png'" />
      <div class="rep-txt">
        <div class="rep-who"><b>${esc(r.name)}${r.age ? ', ' + r.age : ''}</b>${r.tag ? ` <span class="rep-tag">${esc(r.tag)}</span>` : ''} reported${r.mine ? ' <span class="rep-you">You</span>' : ''}</div>
        <div class="rep-sub">${esc(cap(VIBE_WORD[r.vibe] || r.vibe))} · ${ago(r.ageMin)} ago</div>
      </div>
      ${r.mine && r.id ? `<button class="rep-del" onclick="event.stopPropagation();deleteMyReport('${r.id}')" aria-label="Delete your report"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>` : chev}
    </div>${reportRundown(v, r, i)}`).join('')}
  </div>`;
}
function cap(s) { return String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1); }
// "What people are saying" + the community photos, grouped into one block that
// sits at the bottom of the venue card (below the buttons).
function communityBlock(v) {
  const reports = recentReportsBlock(v); // '' when there are none
  const media = v.media || [];
  const strip = media.length ? `<div class="vc-media"${reports ? ' style="margin-top:14px"' : ''}>
      ${reports ? '<div class="cb-sub">Photos &amp; videos</div>' : '<div class="section-h"><h3>What people are saying</h3><span class="count">' + media.length + '</span></div>'}
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

function venueBlurb(v) {
  const kindWord = { Club: 'nightclub', Bar: 'bar', Rooftop: 'rooftop bar', 'Wine Bar': 'wine bar', Venue: 'live-music venue' }[v.kind] || 'nightlife spot';
  const music = (v.music && typeof v.music === 'string') ? v.music : null;
  const g = v.lgbtq ? 'LGBTQ+ ' : '';
  let s = `A ${g}${kindWord} in ${v.neighborhoodName}, ${v.city}`;
  s += music ? ` — expect ${music}.` : (v.category === 'Dancing' ? ' for late-night dancing.' : '.');
  return s;
}
// Description ("what it is") + "what people say" pros/cons distilled from Google reviews.
function reviewsBlock(v) {
  const g = v.google, r = g && g.review;
  const desc = (r && r.summary) ? r.summary : venueBlurb(v);
  const meta = g && g.rating ? `★ ${g.rating}${g.ratings ? ` (${g.ratings})` : ''}` : '';
  const pros = (r && r.pros) || [], cons = (r && r.cons) || [];
  const hasReviews = pros.length || cons.length;
  return `<div class="reviews">
    <div class="section-h"><h3>About</h3>${meta ? `<span class="count">${esc(meta)}</span>` : ''}</div>
    <div class="rev-sum">${esc(desc)}</div>
    ${hasReviews ? `<div class="rev-people">What people say</div>` : ''}
    ${pros.length ? `<ul class="rev-list rev-pros">${pros.map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
    ${cons.length ? `<ul class="rev-list rev-cons">${cons.map(c => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
    ${hasReviews ? `<div class="rev-src">Summarised from Google reviews</div>` : ''}
  </div>`;
}

function renderVenue(v) {
  const band = bandKey(v.radar.score);
  const bc = BAND_COLOR[band];
  const mc = momClass(v.momentum.state);
  const dec = v.decision;
  const decClass = dec.verdict === 'GO NOW' ? 'go' : dec.verdict === 'WAIT' ? 'wait' : 'your';
  const momPct = Math.min(50, Math.abs(v.momentum.M) * 1.6);
  const momDir = v.momentum.M >= 0;
  const fc = v.forecast.points;
  const maxPct = Math.max(...fc.map(p => p.pct), 60);
  const srcLabel = { community: 'COMMUNITY', venue: 'VENUE UPDATE', estimate: 'ESTIMATE', live: 'LIVE', besttime: 'FOOT TRAFFIC', closed: 'CLOSED' }[v.source] || 'ESTIMATE';
  const closed = v.open === false;
  const gRating = v.google && v.google.rating
    ? `<span class="g-rating">★ ${v.google.rating}${v.google.ratings ? ` (${v.google.ratings})` : ''} Google</span>` : '';
  const openChip = v.hours
    ? `<span class="open-chip ${closed ? 'shut' : 'now'}">${closed
        ? (v.season && v.season.closed ? 'Closed for the season · reopens ' + (v.season.reopen || v.hours.opensLabel) : 'Closed · opens ' + v.hours.opensLabel)
        : 'Open now · till ' + v.hours.closesLabel}</span>` : '';
  const seasonTag = v.season ? `<span class="season-tag">☀️ ${esc(v.season.label)}</span>` : '';

  $('#venueCard').innerHTML = `
  <div class="vc-grip"><span></span></div>
  <button class="vc-close" onclick="closeVenue()">✕</button>
  <div class="vc-hero">
    <div class="vc-eyebrow">
      <span class="src-tag src-${v.source}">${srcLabel}</span>
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

    <div class="pr-block">
      <div class="pr-num" style="color:${bc.core}">${v.radar.score}</div>
      <div class="pr-right">
        <div class="pr-label c-${band}">${esc(v.radar.label)}</div>
        <div class="pr-track"><i style="width:${v.radar.score}%;background:${bc.core}"></i></div>
        <div class="pr-sub"><span class="lab">Party Radar score</span>
          <span class="${mc}" style="font-weight:500">${v.momentum.arrow} ${momLabel(v.momentum)}${v.pct != null && v.pct > 0 ? ' +' + v.pct + '%' : ''}</span></div>
      </div>
    </div>
  </div>

  <div class="vc-body">
    ${v.liveBusyness != null ? `<div class="live-busy"><span class="lb-dot"></span><b>${v.liveBusyness}%</b> ${v.liveSource === 'live' ? 'busy right now' : "typical for now"} · <span class="lb-src">BestTime</span></div>` : ''}
    <div class="stat-grid">
      <div class="stat"><div class="k">How full</div><div class="v">${v.fullness.est}%</div>
        <div class="vs">Est. ${v.fullness.low}–${v.fullness.high}% capacity</div></div>
      <div class="stat"><div class="k">Momentum</div><div class="v ${mc}">${momDir ? '+' : ''}${v.momentum.M}</div>
        <div class="mom-meter"><div class="mom-fill" style="${momDir ? 'left:50%' : 'right:50%;left:auto'};width:${momPct}%;background:${momDir ? 'var(--green)' : 'var(--red)'}"></div></div></div>
      <div class="stat"><div class="k">Queue</div><div class="v">${queueText(v.queue || 'none')}</div>
        <div class="vs">${v.open === false ? 'closed now' : (v.queueEstimated ? 'estimated · varies by night' : 'reported')}</div></div>
      <div class="stat"><div class="k">Entry</div><div class="v">${entryText(v)}</div>
        ${v.special ? `<div class="vs c-busy">${esc(v.special)}</div>` : `<div class="vs">${v.entryEstimated ? 'typical · varies by night' : 'reported'}</div>`}</div>
      <div class="stat"><div class="k">Music</div><div class="v" style="font-size:15px">${esc(v.music || v.musicHint || 'Mixed')}</div>
        <div class="vs">${v.music ? (v.musicHint && v.musicHint !== v.music ? 'reported · usually ' + esc(v.musicHint) : 'reported') : 'typical'}</div></div>
      <div class="stat"><div class="k">Activity</div><div class="v">${v.recentSignals}</div>
        <div class="vs">recent signals${v.lastReportAgeMin != null ? ` · report ${ago(v.lastReportAgeMin)} ago` : ''}</div></div>
    </div>

    ${v.owner ? `<div class="owner-note"><b>Venue update</b> · ${ago(v.owner.ageMin)} ago: status ${esc(v.owner.status)}${v.owner.lastEntry ? ' · last entry ' + esc(v.owner.lastEntry) : ''}</div>` : ''}

    ${reviewsBlock(v)}

    ${v.dress ? `<div class="dress"><span class="dress-ic">👔</span><div class="dress-txt"><b>Dress code · ${esc(v.dress.code)}</b><div class="dress-tip">${esc(v.dress.tip)}</div></div></div>` : ''}

    <div class="forecast">
      <div class="section-h"><h3>Forecast</h3><span class="count">next 8 hours</span></div>
      <div class="fc-bars">
        ${fc.map(p => `<div class="fc-col">
          <div class="fc-pct">${p.open === false ? '·' : p.pct + '%'}</div>
          <div class="fc-bar ${p.mins === 0 ? 'now' : ''}${p.open === false ? ' closed' : ''}" style="height:${p.open === false ? 6 : Math.max(8, p.pct / maxPct * 100)}%"></div>
          <div class="fc-lab">${esc(p.label)}</div></div>`).join('')}
      </div>
      ${v.expectedPeak ? `<div class="peak-flag">★ Expected peak <b style="margin-left:4px">${esc(v.expectedPeak)}</b></div>` : ''}
    </div>

    <div class="decision ${decClass}">
      <div class="dec-verdict">${(dec.verdict === 'GO NOW' ? '✓ ' : dec.verdict === 'WAIT' ? '◷ ' : dec.verdict === 'CLOSED' ? '🌙 ' : '') + titleCase(dec.verdict)}</div>
      <div class="dec-head">${esc(dec.headline)}</div>
      <ul class="dec-reasons">${dec.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
    </div>

    ${v._checkedIn ? `<div class="pulse-row"><span class="pq">Still popping?</span>
      <button class="pulse-btn" onclick="sendPulse('${v.id}','busier')">Busier</button>
      <button class="pulse-btn" onclick="sendPulse('${v.id}','yes')">Yes</button>
      <button class="pulse-btn" onclick="sendPulse('${v.id}','slowing')">Slowing</button></div>` : ''}

    <div class="vc-actions">
      <button class="btn btn-primary full" onclick="takeMeThere('${v.id}')">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg>
        Take me there</button>
      ${v.instagram ? `<button class="btn btn-ig full" onclick="openInsta('${v.id}')">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" stroke="none"/></svg>
        Instagram</button>` : ''}
      <button class="btn btn-save full${isSaved(v.id) ? ' on' : ''}" onclick="toggleSave('${v.id}')">${isSaved(v.id) ? '★ Saved' : '☆ Save for later'}</button>
      <button class="btn btn-ghost full" onclick="startReport('${v.id}')">Report the vibe</button>
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
    { v: 'dead', e: '😴', l: 'Dead' }, { v: 'chill', e: '🙂', l: 'Chill' },
    { v: 'popping', e: '🔥', l: 'Popping' }, { v: 'packed', e: '🤯', l: 'Packed' }] },
  { key: 'media', q: 'Add a photo or video', type: 'media', required: true },
  { key: 'queue', q: 'Queue?', grid: true, opts: [
    { v: 'none', l: 'None' }, { v: '<10', l: 'Under 10 min' }, { v: '10-20', l: '10–20 min' },
    { v: '20-30', l: '20–30 min' }, { v: '30+', l: '30+ min', wide: true }] },
  { key: 'entry', q: 'Entry?', grid: true, opts: [
    { v: 0, l: 'Free' }, { v: 5, l: '€5' }, { v: 10, l: '€10' }, { v: 15, l: '€15' },
    { v: 20, l: '€20+' }, { v: 'guestlist', l: 'Guest list' }, { v: 'other', l: 'Other' }] },
  { key: 'mix', q: 'Crowd mix?', grid: true, optional: true, opts: [
    { v: 'more_women', l: 'More women' }, { v: 'even', l: 'Even mix' }, { v: 'more_men', l: 'More men' }] },
  { key: 'music', q: 'Music right now?', grid: true, optional: true, opts: [
    { v: 'House', l: 'House' }, { v: 'Techno', l: 'Techno' }, { v: 'Hip-Hop', l: 'Hip-hop' },
    { v: 'R&B', l: 'R&B' }, { v: 'Afrobeats', l: 'Afrobeats' }, { v: 'Commercial', l: 'Commercial' },
    { v: 'Latin', l: 'Latin' }, { v: 'Other', l: 'Other' }] },
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
function renderReport() {
  $('#reportOverlay').classList.remove('vibe');
  const venue = S.data.venues.find(v => v.id === R.venueId);
  const step = REPORT_STEPS[R.step];
  const sel = R.answers[step.key];
  const inner = $('#reportInner');
  const hint = step.type === 'media' ? "A photo or video is required. It's added to the venue's page"
    : step.type === 'note' ? 'Optional. A few words about the venue or the night (max 500)'
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
        <div class="rep-notecount"><span id="noteCount">${noteVal.length}</span>/500</div>
      </div>`
    : `<div class="${step.grid ? 'rep-grid' : 'rep-opts'}">
      ${opts.map(o => `<button class="rep-opt ${step.grid ? 'sm' : ''}${(o.v === 'other' || o.wide) ? ' wide' : ''} ${sel === o.v ? 'sel' : ''}" onclick="pickReport('${step.key}', ${typeof o.v === 'number' ? o.v : `'${o.v}'`})">
        ${o.e ? `<span class="emoji">${o.e}</span>` : ''}<span>${o.l}</span></button>`).join('')}
    </div>${otherInput}`;
  inner.innerHTML = `
    <div class="rep-head">
      <div class="rep-venue">Reporting · <b>${esc(venue.name)}</b></div>
      <button class="rep-x" onclick="closeReport()">✕</button>
    </div>
    <div class="rep-progress">${REPORT_STEPS.map((_, i) => `<i class="${i <= R.step ? 'on' : ''}"></i>`).join('')}</div>
    ${step.type !== 'media' ? `<div class="rep-mascots" aria-hidden="true">
      <img src="/clubbit-mascot.png" alt="" onerror="this.style.display='none'" />
      <img class="f" src="/clubbit-mascot-f.png" alt="" onerror="this.style.display='none'" />
    </div>` : ''}
    <div class="rep-q">${step.q}</div>
    <div class="rep-hint">${hint}</div>
    ${mid}
    <div class="rep-nav">
      ${step.optional || R.step > 0 ? `<button class="rep-skip" onclick="${step.optional ? 'nextReport(true)' : 'prevReport()'}">${step.optional ? 'Skip' : 'Back'}</button>` : ''}
      <button class="rep-next" ${(!step.optional && sel == null) ? 'disabled' : ''} onclick="nextReport()">
        ${R.step === REPORT_STEPS.length - 1 ? 'Submit' : 'Next'}</button>
    </div>`;
  if (step.type === 'media') wireMediaStep();
  if (step.type === 'note') {
    const ta = $('#repNote');
    if (ta) { ta.oninput = () => { R.answers.note = ta.value; const c = $('#noteCount'); if (c) c.textContent = ta.value.length; }; }
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
  const preview = !m ? '' : (m.type === 'video'
    ? `<video class="media-preview" src="${m.dataUrl}" muted playsinline autoplay loop></video>`
    : `<img class="media-preview" src="${m.dataUrl}" alt="preview" />`);
  return `<div class="rep-media">
    <input type="file" id="mediaInput" accept="image/*,video/*" style="display:none" />
    <button class="media-drop ${m ? 'has' : ''}" id="mediaDrop">
      ${preview || `<span class="md-ic">📷</span><span class="md-t">Add a photo or video</span><span class="md-s">Take one now or pick from your gallery</span>`}
    </button>
    ${m ? `<button class="media-retake" id="mediaRetake">Choose a different one</button>` : ''}
  </div>`;
}
function wireMediaStep() {
  const inp = $('#mediaInput'); if (!inp) return;
  inp.onchange = onMediaPick;
  const drop = $('#mediaDrop'); if (drop) drop.onclick = () => inp.click();
  const rt = $('#mediaRetake'); if (rt) rt.onclick = () => inp.click();
}
async function onMediaPick(e) {
  const f = e.target.files && e.target.files[0]; if (!f) return;
  if (f.type.startsWith('image/')) {
    const dataUrl = await compressImage(f);
    if (!dataUrl) return toast('Could not read that image');
    toast('Checking photo…', 1200);
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
  const step = REPORT_STEPS[R.step];
  renderReport();
  // auto-advance on the primary required single-choice question for speed
  if (key === 'vibe') setTimeout(() => nextReport(), 180);
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
    <div class="rd-duo">
      <img class="rd-mascot" src="/clubbit-mascot.png" alt="" onerror="this.style.display='none'" />
      <img class="rd-mascot rd-mascot-f" src="/clubbit-mascot-f.png" alt="" onerror="this.style.display='none'" />
    </div>
    <h2>All good to go 🎉</h2>
    <p>Thanks, you're on the radar. Now go enjoy the club!<br>Confidence: <b style="color:var(--blue)">${titleCase(res.confidenceTier || 'medium')}</b></p>
    ${leveledUp
      ? `<div class="rep-badge">${newLevel.emoji} Level up! You're now a <b>${esc(newLevel.name)}</b></div>`
      : `<div class="rep-levelnote">${newLevel.emoji} ${esc(newLevel.name)} · ${newLevel.next ? `${newLevel.next.min - newLevel.count} more to ${esc(newLevel.next.name)}` : 'max level'}</div>`}
    ${badge ? `<div class="rep-badge">🏅 ${esc(badge)} unlocked</div>` : ''}
    <div style="margin-top:26px"><button class="rep-next" style="max-width:220px;margin:0 auto" onclick="afterReport('${R.venueId}')">Done</button></div>
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
  Montreal:'Canada', Toronto:'Canada', Vancouver:'Canada',
  'Mexico City':'Mexico', 'Cancún':'Mexico', Tulum:'Mexico', 'Panama City':'Panama', 'San José':'Costa Rica', 'Guatemala City':'Guatemala', 'San Salvador':'El Salvador', Havana:'Cuba', 'San Juan':'Puerto Rico',
  'Bogotá':'Colombia', 'Medellín':'Colombia', Cartagena:'Colombia', Lima:'Peru', Santiago:'Chile', 'Buenos Aires':'Argentina', Montevideo:'Uruguay', 'São Paulo':'Brazil', 'Rio de Janeiro':'Brazil', 'Camboriú':'Brazil',
  Bangkok:'Thailand', 'Ho Chi Minh City':'Vietnam', Hanoi:'Vietnam', Tokyo:'Japan', Osaka:'Japan', Seoul:'South Korea', Singapore:'Singapore', 'Kuala Lumpur':'Malaysia', Bali:'Indonesia', Jakarta:'Indonesia', Manila:'Philippines',
  Shanghai:'China', Beijing:'China', Chengdu:'China', Shenzhen:'China', 'Hong Kong':'Hong Kong', Taipei:'Taiwan',
  Mumbai:'India', Delhi:'India', Bangalore:'India', Goa:'India', Tashkent:'Uzbekistan', Almaty:'Kazakhstan',
  'Cape Town':'South Africa', Johannesburg:'South Africa', Durban:'South Africa', Lagos:'Nigeria', Nairobi:'Kenya', Marrakech:'Morocco', Casablanca:'Morocco', Cairo:'Egypt', Dakar:'Senegal', Accra:'Ghana', 'Addis Ababa':'Ethiopia',
  Sydney:'Australia', Melbourne:'Australia', Brisbane:'Australia', Perth:'Australia', Auckland:'New Zealand',
};
// a venue is "in view" if it's within the current map bounds — used so the
// filter counts reflect what's near you, growing only as you zoom out
function inScope(v) {
  if (!v || !v.coords) return true;
  if (!map || !map.map || !map._ready) return true;
  try { return map.map.getBounds().contains([v.coords.lng, v.coords.lat]); } catch (e) { return true; }
}
function venueMatches(v) {
  if (!matchFilter(v)) return false;
  const q = (S.query || '').trim().toLowerCase();
  if (!q) return true;
  const hay = `${v.name} ${v.neighborhoodName} ${v.city} ${v.category} ${CITY_COUNTRY[v.city] || ''}`.toLowerCase();
  return hay.includes(q);
}

async function refresh() {
  try {
    const d = await API.state();
    S.data = d;
    if (!S.booted) { S.booted = true; bootLocation(); }
    map.setData(d);
    renderFilters();
    // only re-render the sheet when it's showing a live list — never clobber
    // the Profile view (its own tab) with the auto-refresh.
    if (S.tab === 'near' || S.tab === 'areas' || S.tab === 'feed') renderSheet();
    updateChrome();
  } catch (e) { console.error(e); }
}
let _rt;
function refreshSoon() { clearTimeout(_rt); _rt = setTimeout(refresh, 900); }

// Count the "notifications worth showing" — currently-OPEN nearby picks only.
// Nothing is shown while nearby clubs are closed; once they open, the badge
// reflects tonight's open picks (top pick + popping + peaking).
function feedOpenCount() {
  const d = S.data; if (!d) return 0;
  let vs = [...d.venues];
  if (S.userLoc) {
    vs.forEach((v) => { v._dist = haversineKm(S.userLoc, v.coords); });
    const near = vs.filter((v) => v._dist <= 40);
    vs = near.length ? near : vs.sort((a, b) => a._dist - b._dist).slice(0, 20);
  }
  const openV = vs.filter((v) => v.open);
  if (!openV.length) return 0;
  const ids = new Set();
  const top = openV.slice().sort((a, b) => b.radar.score - a.radar.score)[0];
  if (top) ids.add(top.id);
  openV.forEach((v) => { if (v.momentum && ['surging', 'exploding', 'heating'].includes(v.momentum.state)) ids.add(v.id); });
  openV.forEach((v) => { if (v.expectedPeak) ids.add(v.id); });
  return ids.size;
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
function toggleSave(id) {
  let a = loadSaved();
  const now = !a.includes(id);
  a = now ? [id, ...a.filter((x) => x !== id)] : a.filter((x) => x !== id);
  try { localStorage.setItem('pr_saved', JSON.stringify(a)); } catch (e) {}
  toast(now ? '★ Saved for later' : 'Removed from saved');
  const b = document.querySelector('#venueCard .btn-save');
  if (b) { b.classList.toggle('on', now); b.innerHTML = now ? '★ Saved' : '☆ Save for later'; }
  if (S.tab === 'saved') renderSheet();
}
window.toggleSave = toggleSave;

// reapply a remembered choice on load (no gate); or show the gate on first visit
function bootLocation() {
  const saved = loadLoc();
  if (!saved) { showGate(); return; }
  if (saved.skip) return; // remembered "browse the map"
  if (saved.mode === 'gps') { S.userLoc = { lat: saved.userLat, lng: saved.userLng }; S._userIsGps = true; S._flyTarget = { lat: saved.lat, lng: saved.lng }; }
  else { S.userLoc = { lat: saved.lat, lng: saved.lng }; }
  S.locLabel = saved.label; S._rememberFly = true;
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
// crosshair button: recenter to the user's location (no popup if we already have it)
function recenterToMe() {
  if (S.userLoc) {
    // fly to the known spot IMMEDIATELY (no waiting on GPS)…
    map.flyToLatLng(S.userLoc.lat, S.userLoc.lng, 14);
    // …then quietly refresh the fix in the background and nudge if it moved
    if (S._userIsGps && navigator.geolocation && window.isSecureContext) {
      navigator.geolocation.getCurrentPosition((p) => {
        const loc = { lat: p.coords.latitude, lng: p.coords.longitude };
        S.userLoc = loc; map.setUserLocation(loc); map.flyToLatLng(loc.lat, loc.lng, 14);
      }, () => {}, { enableHighAccuracy: true, timeout: 8000, maximumAge: 120000 });
    }
  } else {
    showGate(); // no location yet — let them set it
  }
}
function requestLocation() {
  // GPS only works on a secure origin (https) or localhost — not over a plain LAN IP
  if (!window.isSecureContext) {
    setGateStatus('Live location needs a secure (https) connection on this device. Pick your city below instead.', true);
    return;
  }
  if (!navigator.geolocation) { setGateStatus("This browser can't share location — pick a city below.", true); return; }
  const allow = $('#gateAllow');
  allow.disabled = true; setGateStatus('Locating…');
  navigator.geolocation.getCurrentPosition((p) => {
    allow.disabled = false; setGateStatus('');
    const loc = { lat: p.coords.latitude, lng: p.coords.longitude };
    S.userLoc = loc; S._userIsGps = true;
    hideGate();
    map.setUserLocation(loc);
    const nearest = S.data.venues.map((v) => ({ v, dkm: haversineKm(loc, v.coords) })).sort((a, b) => a.dkm - b.dkm)[0];
    let t = loc, label = 'Best near you', z = 12.5;
    if (nearest && nearest.dkm > 60) { t = { lat: nearest.v.coords.lat, lng: nearest.v.coords.lng }; label = 'Nearest scene · ' + cityOf(nearest.v); z = 12; }
    S.locLabel = label;
    saveLoc({ lat: t.lat, lng: t.lng, label, mode: 'gps', userLat: loc.lat, userLng: loc.lng });
    map.flyToLatLng(t.lat, t.lng, z);
    openSheet('near');
    toast('Showing the best spots near you');
  }, (err) => {
    allow.disabled = false;
    setGateStatus(err && err.code === 1 ? 'Location permission was blocked — pick a city below.' : "Couldn't get your location — pick a city below.", true);
  }, { enableHighAccuracy: true, timeout: 9000, maximumAge: 60000 });
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
function applyTheme(mode) {
  try { localStorage.setItem('clubbit_theme', mode); } catch {}
  document.documentElement.setAttribute('data-theme', mode);
  const logo = document.getElementById('brandHome');
  if (logo) logo.src = mode === 'dark' ? '/mascot-dark.png' : '/mascot.png';
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
  if (sc) sc.hidden = false; if (s) { s.hidden = false; requestAnimationFrame(() => s.classList.add('open')); }
}
function closeMSheet(sheetId, scrimId) {
  const s = $(sheetId), sc = $(scrimId);
  if (s) s.classList.remove('open');
  setTimeout(() => { if (s) s.hidden = true; if (sc) sc.hidden = true; }, 320);
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
  $('#setSignOut').onclick = doSignOut;
  $('#setDelete').onclick = doDeleteAccount;
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
  if (!confirm('Delete your account permanently? This erases your account, saved profile and level. This cannot be undone.')) return;
  let token = ''; try { token = localStorage.getItem('clubbit_token') || ''; } catch {}
  try { await API.deleteAccount(token); } catch (e) {}
  try { ['clubbit_onboarding_complete', 'clubbit_profile', 'clubbit_onboarding', 'clubbit_token', 'clubbit_reports_count', 'pr_saved', 'pr_loc'].forEach((k) => localStorage.removeItem(k)); } catch {}
  location.replace('/onboarding.html');
}

async function renderProfile() {
  const body = $('#profileBody');
  if (!body) return;
  body.innerHTML = '<div class="empty">Loading your profile…</div>';
  let me = {};
  try { me = await API.me(); } catch { me = {}; }
  if (S.tab !== 'profile') return;
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
async function deleteMyReport(id) {
  if (!confirm('Delete your report? This removes your report and its photo from this venue.')) return;
  try {
    const r = await API.deleteReport(id);
    if (r && r.ok) {
      try { setReportCount(Math.max(0, reportCount() - 1)); } catch (e) {}
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
  $('#searchInput').addEventListener('input', (e) => { S.query = e.target.value; renderSheet(); });

  // floating buttons
  $('#locateFab').addEventListener('click', recenterToMe);
  $('#addFab').addEventListener('click', () => { S.reportPick = true; openSheet('near'); toast('Tap a place to report the vibe'); });

  // list + bottom nav
  $('#listBtn').addEventListener('click', () => openSheet('feed'));
  document.querySelectorAll('.bn').forEach((b) => b.addEventListener('click', () => {
    const nav = b.dataset.nav;
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
  const lbx = $('#lightbox'); if (lbx) lbx.addEventListener('click', (e) => { if (e.target === lbx) closeLightbox(); });
  document.querySelectorAll('[data-close]').forEach((s) => s.addEventListener('click', closeVenue));
}

initUI();
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
