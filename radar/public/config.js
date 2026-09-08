/* ============================================================
   Clubbit runtime config + native (Capacitor) API bridge.

   • WEB app (served by the Node backend): leave CLUBBIT_API = '' —
     all /api and /media calls stay same-origin, nothing changes.
   • PACKAGED mobile app (Capacitor): set CLUBBIT_API to your HOSTED
     backend URL so the app talks to your server over the internet,
     e.g.  window.CLUBBIT_API = 'https://api.clubbit.app';
   Set it once here before running `npx cap sync`.
   ============================================================ */
window.CLUBBIT_API = window.CLUBBIT_API || 'https://clubbit.onrender.com';

(function () {
  var base = (window.CLUBBIT_API || '').replace(/\/+$/, '');
  if (!base) return; // web / same-origin — no rewriting needed

  var needsBase = function (u) {
    return typeof u === 'string' && u.charAt(0) === '/' &&
      (u.indexOf('/api') === 0 || u.indexOf('/media') === 0);
  };

  // Stable per-device id — cross-origin cookies aren't reliably sent from the
  // packaged app, so we identify the user with this header instead. This keeps
  // reports / photos / contributions attributed to the same account.
  var uid = function () {
    try {
      var k = 'clubbit_uid', v = localStorage.getItem(k);
      if (!v) { v = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12); localStorage.setItem(k, v); }
      return v;
    } catch (e) { return ''; }
  };

  // 1) fetch() → hosted backend (+ stable identity header on /api)
  var _fetch = window.fetch ? window.fetch.bind(window) : null;
  if (_fetch) window.fetch = function (input, init) {
    var isApi = false;
    try {
      if (needsBase(input)) { input = base + input; isApi = true; }
      else if (input && typeof input === 'object' && needsBase(input.url)) { input = new Request(base + input.url, input); isApi = true; }
      if (isApi) {
        init = init || {};
        var h = new Headers((init && init.headers) || (input && input.headers) || {});
        h.set('X-Clubbit-Uid', uid());
        init.headers = h;
      }
    } catch (e) {}
    return _fetch(input, init);
  };

  // 2) window.open() → hosted backend (Instagram redirect, etc.)
  var _open = window.open ? window.open.bind(window) : null;
  if (_open) window.open = function (u) {
    var a = [].slice.call(arguments);
    if (needsBase(u)) a[0] = base + u;
    return _open.apply(window, a);
  };

  // 3) community media <img>/<video> (inserted via innerHTML) → hosted backend
  var fixEl = function (el) {
    if (!el || el.nodeType !== 1) return;
    if (el.tagName === 'IMG' || el.tagName === 'VIDEO') {
      var s = el.getAttribute && el.getAttribute('src');
      if (s && s.indexOf('/media') === 0) el.src = base + s;
    }
    if (el.querySelectorAll) el.querySelectorAll('img[src^="/media"],video[src^="/media"]').forEach(function (n) { n.src = base + n.getAttribute('src'); });
  };
  try {
    new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var an = muts[i].addedNodes;
        for (var j = 0; j < an.length; j++) fixEl(an[j]);
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}
  document.addEventListener('DOMContentLoaded', function () { fixEl(document.body); });
})();
