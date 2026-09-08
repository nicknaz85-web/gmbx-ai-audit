/* ============================================================
   CLUBBIT onboarding — persistent, resumable, validated flow.
   ============================================================ */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const screenEl = (name) => $(`.screen[data-screen="${name}"]`);

  // flow order; steps 3–7 carry the "1/5…5/5" progress
  const ORDER = ['welcome', 'signin', 'name', 'gender', 'dob', 'frequency', 'photo', 'intro'];
  const PROGRESS = { name: 1, gender: 2, dob: 3, frequency: 4, photo: 5 };
  const SAVE_KEY = 'clubbit_onboarding';
  const PROFILE_KEY = 'clubbit_profile';
  const DONE_KEY = 'clubbit_onboarding_complete';
  const TOKEN_KEY = 'clubbit_token';
  // Paste your Google OAuth Web Client ID here to enable real Google sign-in.
  // The page's origin must be added to the client's "Authorized JavaScript origins".
  const GOOGLE_CLIENT_ID = '';

  // ---- persistent draft ----
  const draft = load() || { data: {}, screen: 'welcome' };
  function load() { try { return JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { return null; } }
  function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(draft)); } catch {} }

  const D = draft.data; // collected profile fields
  let current = 'welcome';
  let history = [];

  // ---- haptics ----
  function haptic(ms = 12) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch {} }

  // ---- toast ----
  let toastT;
  function toast(msg, ms = 2000) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms);
  }

  // ---- navigation with transitions ----
  function go(name, { push = true } = {}) {
    if (name === current) return;
    const from = screenEl(current), to = screenEl(name);
    if (push && current) history.push(current);
    if (from) {
      from.classList.add('leaving'); from.classList.remove('active');
      setTimeout(() => from.classList.remove('leaving'), 320);
    }
    current = name;
    to.classList.add('active');
    // back button visibility (welcome + done have none)
    const back = $('.back', to);
    if (back) back.hidden = (name === 'welcome');
    setProgress(name);
    onEnter(name);
    draft.screen = name; persist();
    // keep the browser back button in sync (prevent accidental leave)
    try { history_pushState(name); } catch {}
  }
  function back() {
    if (!history.length) return;
    const prev = history.pop();
    go(prev, { push: false });
  }

  // browser back → step back instead of leaving the app
  function history_pushState(name) { window.history.pushState({ cb: name }, ''); }
  window.addEventListener('popstate', () => {
    // signin sub-steps can go back even with no screen history to pop
    const inAuthSub = (current === 'signin' && AUTH_BACK[currentAuthStep()]);
    if (inAuthSub || (current !== 'welcome' && history.length)) { handleBack(); window.history.pushState({}, ''); }
    else window.history.pushState({}, '');
  });

  function setProgress(name) {
    const p = PROGRESS[name];
    const scr = screenEl(name);
    const fill = scr && $('.progress-fill', scr);
    if (fill && p) fill.style.width = (p / 5 * 100) + '%';
  }

  // ---- reusable mascot control ----
  const MSTATES = ['m-idle', 'm-dance', 'm-bounce', 'm-celebrate', 'm-wave', 'm-react'];
  function setMascot(el, state) {
    if (!el) return;
    MSTATES.forEach((c) => el.classList.remove(c));
    el.classList.add('m-' + state);
  }
  // pick the mascot image that matches the chosen gender
  function mascotSrc() { return (D.gender === 'Woman') ? '/clubbit-mascot-f.png' : '/clubbit-mascot.png'; }
  // gendered close-up portrait for avatar slots (Man/Woman only; others fall back
  // to the full-body mascot)
  function faceSrc() {
    if (D.gender === 'Woman') return '/clubbit-face-f.png';
    if (D.gender === 'Man') return '/clubbit-face-m.png';
    if (D.gender === 'Non-binary') return '/clubbit-face-nb.png';
    return mascotSrc();
  }
  // Corner mascots now alternate man/woman per step (set in the HTML), so we no
  // longer override them by gender. The gendered image still drives the avatar
  // (done screen / photo / profile) via faceSrc().
  function applyMascotGender() { /* intentionally no-op — see note above */ }
  // play a one-shot reaction then return to a base state
  function reactMascot(el, base = 'idle') {
    if (!el) return;
    setMascot(el, 'react');
    el.addEventListener('animationend', function done() {
      el.removeEventListener('animationend', done); setMascot(el, base);
    }, { once: true });
  }

  // ============================================================
  //  per-screen entry hooks
  // ============================================================
  function onEnter(name) {
    if (name === 'dob') buildWheelsOnce();
    if (name === 'photo') fillPhotoPreview();
    if (name === 'intro') { ocIndex = 0; if (typeof ocRender === 'function') ocRender(); }
  }
  // show the gender-matched mascot as the default profile-picture preview
  // (until the user picks a real photo)
  function fillPhotoPreview() {
    if (D.profilePhoto) { preview.innerHTML = `<img src="${D.profilePhoto}" alt="Your photo" />`; updatePhotoCta(); return; }
    // gendered faces are close-up portraits → let them fill the ring (cover);
    // the fallback standing mascot keeps its shrunk-and-contained look
    const gendered = (D.gender === 'Woman' || D.gender === 'Man' || D.gender === 'Non-binary');
    preview.innerHTML = gendered
      ? `<img src="${faceSrc()}" alt="Default avatar" />`
      : `<img class="ph-mascot" src="${faceSrc()}" alt="Default avatar" />`;
    updatePhotoCta();
  }

  // ---- WELCOME ----
  $$('[data-act="start"], [data-act="start2"]').forEach((b) => b.addEventListener('click', () => { haptic(); go('signin'); }));

  // ---- BACK buttons ----
  // On the sign-in screen the sub-steps (choose → email → code/password) are
  // toggled in place, so a plain back() would jump all the way out to welcome.
  // Step back through those sub-steps first, then fall through to real nav.
  const AUTH_BACK = { authEmail: 'authChoose', authCode: 'authEmail', authNew: 'authCode', authSignin: 'authEmail' };
  const AUTH_FOCUS = { authEmail: '#emailInput', authCode: '#codeInput', authSignin: '#siPass' };
  function currentAuthStep() { return AUTH_STEPS.find((s) => { const el = $('#' + s); return el && !el.hidden; }); }
  function handleBack() {
    if (current === 'signin') {
      const prev = AUTH_BACK[currentAuthStep()];
      if (prev) { showAuthStep(prev, AUTH_FOCUS[prev] || null); return; }
    }
    back();
  }
  $$('[data-act="back"]').forEach((b) => b.addEventListener('click', () => { haptic(8); handleBack(); }));

  // ---- SIGN IN (email + password with email verification) ----
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const AUTH_STEPS = ['authChoose', 'authEmail', 'authCode', 'authNew', 'authSignin'];
  let authEmail = '';   // the email being verified / signed in
  let authCode = '';    // the verified 6-digit code (needed to set the password)

  function showAuthStep(step, focusSel) {
    AUTH_STEPS.forEach((s) => { const el = $('#' + s); if (el) el.hidden = (s !== step); });
    if (focusSel) { const f = $(focusSel); if (f) setTimeout(() => f.focus(), 60); }
  }
  // small JSON POST helper; resolves { ok, status, data }
  async function post(path, payload) {
    try {
      const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await r.json().catch(() => ({}));
      return { ok: r.ok, status: r.status, data };
    } catch (e) { return { ok: false, status: 0, data: { error: 'Network error — check your connection.' } }; }
  }
  function busy(btn, on, label) {
    if (!btn) return;
    if (on) { btn._label = btn.textContent; btn.disabled = true; btn.textContent = label || 'Please wait…'; }
    else { btn.disabled = false; if (btn._label) btn.textContent = btn._label; }
  }

  // provider buttons: Google, or start the email flow
  $$('#authChoose .sbtn').forEach((b) => b.addEventListener('click', () => {
    haptic();
    if (b.dataset.auth === 'google') { googleSignIn(); return; }
    showAuthStep('authEmail', '#emailInput');
  }));

  // ---- real Google sign-in (Google Identity Services token flow) ----
  let _gClient = null;
  function googleSignIn() {
    if (!GOOGLE_CLIENT_ID) { toast('Google sign-in isn\'t set up yet — use email'); showAuthStep('authEmail', '#emailInput'); return; }
    if (!(window.google && google.accounts && google.accounts.oauth2)) { toast('Google didn\'t load — check your connection'); return; }
    if (!_gClient) {
      _gClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: 'openid email profile',
        callback: async (resp) => {
          if (!resp || resp.error || !resp.access_token) { toast('Google sign-in cancelled'); return; }
          try {
            const info = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer ' + resp.access_token } }).then((r) => r.json());
            D.authProvider = 'google';
            D.email = info.email || '';
            D.id = info.sub || D.id || ('clubbit_' + Date.now().toString(36));
            if (info.given_name) D.firstName = info.given_name;
            if (info.picture) { D.googlePhoto = info.picture; if (!D.profilePhoto) D.profilePhoto = info.picture; }
            persist();
            if (D.firstName) { nameInput.value = D.firstName; $('#nameGo').disabled = false; }
            if (D.profilePhoto) preview.innerHTML = `<img src="${D.profilePhoto}" alt="Your photo" />`;
            toast('Signed in with Google ✓');
            go('name');
          } catch (e) { toast('Could not read your Google profile'); }
        },
      });
    }
    _gClient.requestAccessToken();
  }

  // step 1 → send a verification code (or route returning users to sign in)
  const emailGo = $('#emailGo');
  emailGo.addEventListener('click', async () => {
    const v = ($('#emailInput').value || '').trim();
    if (!EMAIL_RE.test(v)) { $('#emailErr').textContent = 'Enter a valid email address.'; return; }
    $('#emailErr').textContent = ''; haptic(); busy(emailGo, true, 'Sending…');
    const { ok, data } = await post('/api/auth/request-code', { email: v });
    busy(emailGo, false);
    if (!ok) { $('#emailErr').textContent = data.error || 'Something went wrong. Try again.'; return; }
    authEmail = v;
    if (data.exists) { // returning user → ask for password
      $('#siEmail').textContent = v; showAuthStep('authSignin', '#siPass');
    } else { // new user → verify a code first
      $('#codeEmail').textContent = v; $('#codeInput').value = ''; $('#codeGo').disabled = true; $('#codeErr').textContent = '';
      showAuthStep('authCode', '#codeInput');
      if (data.devCode) toast('Demo mode: your code is ' + data.devCode, 6000);
      else toast('We sent a 6-digit code to ' + v, 3500);
    }
  });
  $('#emailInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') emailGo.click(); });

  // step 2 → verify the code
  const codeInput = $('#codeInput'), codeGo = $('#codeGo');
  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 6);
    codeGo.disabled = codeInput.value.length !== 6;
    $('#codeErr').textContent = '';
  });
  codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !codeGo.disabled) codeGo.click(); });
  codeGo.addEventListener('click', async () => {
    const code = codeInput.value.trim();
    haptic(); busy(codeGo, true, 'Verifying…');
    const { ok, data } = await post('/api/auth/verify-code', { email: authEmail, code });
    busy(codeGo, false);
    if (!ok) { $('#codeErr').textContent = data.error || 'Incorrect code.'; return; }
    authCode = code;
    $('#newEmail').textContent = authEmail; $('#newPass').value = ''; $('#newPass2').value = '';
    $('#newErr').textContent = ''; $('#newGo').disabled = true;
    showAuthStep('authNew', '#newPass');
  });
  $('#codeResend').addEventListener('click', async () => {
    haptic();
    const { ok, data } = await post('/api/auth/request-code', { email: authEmail });
    if (!ok) { $('#codeErr').textContent = data.error || 'Could not resend.'; return; }
    if (data.devCode) toast('Demo mode: your code is ' + data.devCode, 6000);
    else toast('New code sent ✓', 2500);
  });

  // step 3 → create a password (new account)
  const newPass = $('#newPass'), newPass2 = $('#newPass2'), newGo = $('#newGo');
  // password strength: 1 weak / 2 fair / 3 strong. We require fair+ (>=2) so
  // no weak passwords get through.
  function scorePassword(pw) {
    if (!pw) return { score: 0, label: '' };
    if (pw.length < 8) return { score: 1, label: 'Weak' };
    let variety = 0;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) variety++;
    if (/\d/.test(pw)) variety++;
    if (/[^a-zA-Z0-9]/.test(pw)) variety++;
    const strong = (pw.length >= 12 && variety >= 2) || variety >= 3;
    const score = strong ? 3 : (variety >= 1 ? 2 : 1);
    return { score, label: score === 3 ? 'Strong' : score === 2 ? 'Fair' : 'Weak' };
  }
  function checkNew() {
    const a = newPass.value, b = newPass2.value;
    const st = scorePassword(a);
    const box = $('#pwStrength');
    if (box) { box.hidden = !a; box.setAttribute('data-score', st.score); const l = box.querySelector('.pw-label'); if (l) l.textContent = st.label; }
    const ok = a.length >= 8 && st.score >= 2;
    newGo.disabled = !(ok && a === b);
    $('#newErr').textContent = (b && a !== b) ? "Passwords don't match."
      : (a && !ok) ? 'Use 8+ characters with a mix of letters, numbers or symbols.' : '';
  }
  newPass.addEventListener('input', checkNew);
  newPass2.addEventListener('input', checkNew);
  newPass2.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !newGo.disabled) newGo.click(); });
  newGo.addEventListener('click', async () => {
    const pw = newPass.value;
    if (pw.length < 8) { $('#newErr').textContent = 'Password must be at least 8 characters.'; return; }
    if (scorePassword(pw).score < 2) { $('#newErr').textContent = 'Password is too weak — add letters, numbers or symbols.'; return; }
    if (pw !== newPass2.value) { $('#newErr').textContent = 'Passwords don\'t match.'; return; }
    haptic(); busy(newGo, true, 'Creating…');
    const { ok, data } = await post('/api/auth/set-password', { email: authEmail, code: authCode, password: pw });
    busy(newGo, false);
    if (!ok) { $('#newErr').textContent = data.error || 'Could not create your account.'; return; }
    saveToken(data.token);
    authComplete('email', authEmail, data.user && data.user.id);
  });

  // step 3b → sign in (returning account)
  const siPass = $('#siPass'), siGo = $('#siGo');
  siPass.addEventListener('input', () => { siGo.disabled = siPass.value.length < 1; $('#siErr').textContent = ''; });
  siPass.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !siGo.disabled) siGo.click(); });
  siGo.addEventListener('click', async () => {
    haptic(); busy(siGo, true, 'Signing in…');
    const { ok, data } = await post('/api/auth/signin', { email: authEmail, password: siPass.value });
    busy(siGo, false);
    if (!ok) { $('#siErr').textContent = data.error || 'Could not sign in.'; return; }
    D.authProvider = 'email'; D.email = authEmail; D.id = (data.user && data.user.id) || D.id;
    saveToken(data.token); persist();
    // account already has a finished profile → restore everything and skip onboarding.
    // Treat it as finished if the flag is set OR the core fields exist (robust to
    // older saves that predate the flag).
    const p = data.profile;
    if (p && (p.onboardingComplete || (p.firstName && p.dateOfBirth))) {
      restoreServerProfile(p);
      toast('Welcome back ✓'); setTimeout(() => location.replace('/'), 300); return;
    }
    // partial profile on the account → prefill and let them finish
    if (data.profile) mergeServerProfile(data.profile);
    // finished on this device but not yet on the account → go to the app
    try { if (localStorage.getItem(DONE_KEY)) { toast('Welcome back ✓'); location.replace('/'); return; } } catch {}
    toast('Signed in ✓'); prefill(); go('name');
  });

  function saveToken(t) { if (!t) return; D.token = t; try { localStorage.setItem(TOKEN_KEY, t); } catch {} }
  function getToken() { try { return localStorage.getItem(TOKEN_KEY) || D.token || ''; } catch { return D.token || ''; } }

  // Build a full local profile from a server profile and mark onboarding done.
  function restoreServerProfile(p) {
    const nowIso = new Date().toISOString();
    const profile = {
      id: p.id || D.id, authProvider: 'email', email: p.email || authEmail,
      firstName: p.firstName || null, gender: p.gender || null,
      dateOfBirth: p.dateOfBirth || null, calculatedAge: p.calculatedAge || null,
      clubbingFrequency: p.clubbingFrequency || null, profilePhoto: p.profilePhoto || null,
      onboardingComplete: true, createdAt: p.createdAt || nowIso, updatedAt: nowIso,
      public: { firstName: p.firstName || null, profilePhoto: p.profilePhoto || null, age: p.calculatedAge || null },
    };
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
      localStorage.setItem(DONE_KEY, '1');
      localStorage.removeItem(SAVE_KEY);
    } catch {}
  }
  // Copy a partial server profile into the working draft (for resuming onboarding).
  function mergeServerProfile(p) {
    if (p.firstName) D.firstName = p.firstName;
    if (p.gender) D.gender = p.gender;
    if (p.dateOfBirth) D.dateOfBirth = p.dateOfBirth;
    if (p.calculatedAge) D.calculatedAge = p.calculatedAge;
    if (p.clubbingFrequency) D.frequency = p.clubbingFrequency;
    if (p.profilePhoto) D.profilePhoto = p.profilePhoto;
    persist();
  }

  function authComplete(provider, email, id) {
    D.authProvider = provider;
    D.email = email || D.email || '';
    D.id = id || D.id || ('clubbit_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36));
    persist();
    go('name');
  }

  // ---- NAME ----
  const nameInput = $('#nameInput');
  nameInput.addEventListener('input', () => {
    const v = nameInput.value.trim();
    $('#nameGo').disabled = v.length < 1;
    D.firstName = v; persist();
  });
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !$('#nameGo').disabled) $('#nameGo').click(); });

  // ---- GENDER + FREQUENCY (card groups) ----
  $$('.cards[data-group]').forEach((group) => {
    const key = group.dataset.group;
    group.addEventListener('click', (e) => {
      const opt = e.target.closest('.opt'); if (!opt) return;
      $$('.opt', group).forEach((o) => o.classList.remove('sel'));
      opt.classList.add('sel');
      D[key] = opt.dataset.val; persist();
      haptic(14);
      // as soon as gender is picked, show the matching mascot everywhere
      if (key === 'gender') applyMascotGender();
      const scr = group.closest('.screen');
      const cta = $('.cta[data-act="next"]', scr); if (cta) cta.disabled = false;
      // mascot reacts
      const m = $('.mascot-corner', scr);
      if (key === 'frequency') {
        const big = /More than 10|6–10/.test(opt.dataset.val);
        if (big) { setMascot(m, 'bounce'); setTimeout(() => setMascot(m, 'idle'), 1400); }
        else reactMascot(m, 'idle');
      } else reactMascot(m, 'idle');
    });
  });

  // ---- NEXT buttons (advance in ORDER) ----
  $$('[data-act="next"]').forEach((b) => b.addEventListener('click', () => {
    if (b.disabled) return;
    haptic();
    const idx = ORDER.indexOf(current);
    go(ORDER[idx + 1]);
  }));

  // ============================================================
  //  DOB WHEELS
  // ============================================================
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  let wheelsBuilt = false;
  const wsel = { d: 15, m: 5, y: (new Date().getFullYear() - 22) }; // defaults
  function daysIn(m, y) { return [31, (leap(y) ? 29 : 28), 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m]; }
  function leap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }

  function buildWheelsOnce() {
    if (wheelsBuilt) return; wheelsBuilt = true;
    const now = new Date();
    const maxYear = now.getFullYear() - 16; // let under-18 be selectable so the block message can show
    const minYear = now.getFullYear() - 100;
    // restore saved dob if any
    if (D.dateOfBirth) { const dd = new Date(D.dateOfBirth); wsel.d = dd.getDate(); wsel.m = dd.getMonth(); wsel.y = dd.getFullYear(); }
    fillWheel($('#wYear'), range(maxYear, minYear).map(String), String(wsel.y));
    fillWheel($('#wMonth'), MONTHS, MONTHS[wsel.m]);
    fillDayWheel();
    // wire scroll snapping
    wireWheel($('#wDay'), (i, items) => { wsel.d = +items[i]; onDobChange(); });
    wireWheel($('#wMonth'), (i) => { wsel.m = i; fillDayWheel(); onDobChange(); });
    wireWheel($('#wYear'), (i, items) => { wsel.y = +items[i]; fillDayWheel(); onDobChange(); });
    setTimeout(onDobChange, 60);
  }
  function range(a, b) { const r = []; if (a >= b) for (let i = a; i >= b; i--) r.push(i); else for (let i = a; i <= b; i++) r.push(i); return r; }
  function fillDayWheel() {
    const n = daysIn(wsel.m, wsel.y); if (wsel.d > n) wsel.d = n;
    const wheel = $('#wDay');
    // only rebuild when the number of days changed (e.g. → Feb / 30-day month);
    // otherwise leave the day column untouched so it doesn't flash on month/year scroll
    if (wheel._items && wheel._items.length === n) return;
    fillWheel(wheel, range(1, n).map(String), String(wsel.d));
  }
  function fillWheel(wheel, items, selectedVal) {
    wheel.innerHTML = '<div class="pad"></div>' + items.map((v) => `<div class="w-item" data-v="${v}">${v}</div>`).join('') + '<div class="pad"></div>';
    wheel._items = items;
    const idx = Math.max(0, items.indexOf(selectedVal));
    requestAnimationFrame(() => { wheel.scrollTop = idx * 40; markWheel(wheel); });
  }
  function markWheel(wheel) {
    const idx = Math.round(wheel.scrollTop / 40);
    $$('.w-item', wheel).forEach((it, i) => it.classList.toggle('on', i === idx));
    return idx;
  }
  function wireWheel(wheel, onPick) {
    let t;
    wheel.addEventListener('scroll', () => {
      markWheel(wheel);
      clearTimeout(t);
      t = setTimeout(() => {
        const idx = Math.round(wheel.scrollTop / 40);
        wheel.scrollTo({ top: idx * 40, behavior: 'smooth' });
        markWheel(wheel);
        haptic(6);
        onPick(idx, wheel._items);
      }, 90);
    }, { passive: true });
  }
  function exactAge(y, m, d) {
    const t = new Date(); let age = t.getFullYear() - y;
    const mm = t.getMonth() - m; if (mm < 0 || (mm === 0 && t.getDate() < d)) age--;
    return age;
  }
  function onDobChange() {
    const age = exactAge(wsel.y, wsel.m, wsel.d);
    const err = $('#dobErr'), go = $('#dobGo');
    if (age >= 18) {
      err.textContent = '';
      D.dateOfBirth = new Date(Date.UTC(wsel.y, wsel.m, wsel.d)).toISOString().slice(0, 10);
      D.calculatedAge = age; persist();
      go.disabled = false;
    } else {
      err.textContent = 'Clubbit is currently only available to users aged 18 and over.';
      go.disabled = true;
      delete D.dateOfBirth; delete D.calculatedAge; persist();
    }
  }

  // ============================================================
  //  PROFILE PHOTO + CROP
  // ============================================================
  const preview = $('#photoPreview');
  $('[data-act="choosePhoto"]').addEventListener('click', () => { haptic(); $('#fileChoose').click(); });
  // single button: "Skip for now" until a photo is chosen, then "Continue"
  $('[data-act="photoNext"]').addEventListener('click', () => {
    haptic();
    if (!D.profilePhoto) { D.profilePhoto = null; persist(); }
    go('intro');
  });
  function updatePhotoCta() {
    const b = $('#photoCta'); if (b) b.textContent = D.profilePhoto ? 'Continue' : 'Skip for now';
  }
  $('#fileChoose').addEventListener('change', onFile);
  function onFile(e) {
    const f = e.target.files && e.target.files[0]; e.target.value = '';
    if (!f) return;
    if (!f.type.startsWith('image/')) { toast('Please choose an image'); return; }
    const r = new FileReader();
    r.onload = () => openCrop(r.result);
    r.readAsDataURL(f);
  }

  // crop implementation (pan + zoom over a circular viewport)
  const crop = $('#crop'), cropImg = $('#cropImg'), cropCircle = $('#cropCircle'), cropZoom = $('#cropZoom');
  let cst = null;
  function openCrop(src) {
    const img = new Image();
    img.onload = () => {
      // show the modal FIRST so the circle has real dimensions, then measure —
      // measuring while display:none gives clientWidth 0 and the image renders black
      crop.classList.add('open');
      requestAnimationFrame(() => {
        const S = cropCircle.clientWidth || Math.min(window.innerWidth * 0.74, 300);
        const coverBase = Math.max(S / img.naturalWidth, S / img.naturalHeight);
        cst = { src, iw: img.naturalWidth, ih: img.naturalHeight, S, coverBase, zoom: 1, ox: 0, oy: 0 };
        cropImg.src = src; cropImg.style.transform = 'none';
        cropZoom.value = '1';
        layoutCrop();
      });
    };
    img.src = src;
  }
  function layoutCrop() {
    if (!cst) return;
    const eff = cst.coverBase * cst.zoom;
    const w = cst.iw * eff, h = cst.ih * eff, S = cst.S;
    // clamp offsets so the image always covers the circle
    cst.ox = Math.min(0, Math.max(S - w, cst.ox));
    cst.oy = Math.min(0, Math.max(S - h, cst.oy));
    Object.assign(cropImg.style, {
      position: 'absolute', left: '0', top: '0', width: w + 'px', height: h + 'px',
      transform: `translate(${(S - w) / 2 + cst.ox}px, ${(S - h) / 2 + cst.oy}px)`,
    });
  }
  cropZoom.addEventListener('input', () => { if (!cst) return; cst.zoom = +cropZoom.value; layoutCrop(); });
  // drag to pan
  let drag = null;
  cropCircle.addEventListener('pointerdown', (e) => { if (!cst) return; drag = { x: e.clientX, y: e.clientY, ox: cst.ox, oy: cst.oy }; cropCircle.setPointerCapture(e.pointerId); });
  cropCircle.addEventListener('pointermove', (e) => { if (!drag || !cst) return; cst.ox = drag.ox + (e.clientX - drag.x); cst.oy = drag.oy + (e.clientY - drag.y); layoutCrop(); });
  cropCircle.addEventListener('pointerup', () => { drag = null; });
  cropCircle.addEventListener('pointercancel', () => { drag = null; });
  $('[data-act="cropCancel"]').addEventListener('click', () => { crop.classList.remove('open'); cst = null; });
  $('[data-act="cropSave"]').addEventListener('click', () => {
    if (!cst) return;
    const OUT = 480, eff = cst.coverBase * cst.zoom, S = cst.S;
    const left = (S - cst.iw * eff) / 2 + cst.ox, top = (S - cst.ih * eff) / 2 + cst.oy;
    const sx = -left / eff, sy = -top / eff, sS = S / eff;
    const c = document.createElement('canvas'); c.width = c.height = OUT;
    const ctx = c.getContext('2d');
    const im = new Image();
    im.onload = () => {
      ctx.drawImage(im, sx, sy, sS, sS, 0, 0, OUT, OUT);
      const url = c.toDataURL('image/jpeg', 0.88);
      D.profilePhoto = url; persist();
      preview.innerHTML = `<img src="${url}" alt="Your photo" />`;
      updatePhotoCta();
      crop.classList.remove('open'); cst = null; haptic(); toast('Looking good ✨');
    };
    im.src = cst.src;
  });

  // ============================================================
  //  WELCOME CAROUSEL (3 steps) — ends onboarding
  // ============================================================
  var ocIndex = 0;
  const OC_COUNT = 3;
  const ocTrack = $('#ocTrack'), ocCta = $('#ocCta'), ocDotsBox = $('#ocDots');
  function ocRender() {
    if (ocTrack) ocTrack.style.transform = `translateX(${ocIndex * -100}%)`;
    $$('#ocDots i').forEach((d, i) => d.classList.toggle('on', i === ocIndex));
    if (ocCta) ocCta.textContent = (ocIndex === OC_COUNT - 1) ? "Find what's popping" : 'Next';
  }
  function ocGo(i) {
    i = Math.max(0, Math.min(OC_COUNT - 1, i));
    if (i === ocIndex) return;
    const toLast = (i === OC_COUNT - 1);
    ocIndex = i; haptic(8); ocRender();
    if (toLast) burstConfetti();
  }
  if (ocCta) ocCta.addEventListener('click', () => {
    haptic();
    if (ocIndex < OC_COUNT - 1) ocGo(ocIndex + 1);
    else finishOnboarding();
  });
  if (ocDotsBox) ocDotsBox.addEventListener('click', (e) => {
    const i = $$('#ocDots i').indexOf(e.target); if (i >= 0) ocGo(i);
  });
  // swipe left/right between steps
  (() => {
    const c = $('#ocCarousel'); if (!c) return;
    let x0 = null;
    c.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
    c.addEventListener('touchend', (e) => {
      if (x0 == null) return;
      const dx = e.changedTouches[0].clientX - x0; x0 = null;
      if (Math.abs(dx) > 45) ocGo(ocIndex + (dx < 0 ? 1 : -1));
    }, { passive: true });
  })();

  function burstConfetti() {
    const box = $('#confetti'); if (!box) return; box.innerHTML = '';
    const cols = ['#8b5cf6', '#f6c944', '#ffffff', '#c4b5fd', '#7c3aed'];
    for (let i = 0; i < 46; i++) {
      const p = document.createElement('i');
      p.style.left = Math.random() * 100 + '%';
      p.style.background = cols[i % cols.length];
      p.style.animationDuration = (2.2 + Math.random() * 1.8) + 's';
      p.style.animationDelay = (Math.random() * .5) + 's';
      p.style.width = p.style.height = (5 + Math.random() * 6) + 'px';
      box.appendChild(p);
    }
    setTimeout(() => { box.innerHTML = ''; }, 4200);
  }

  async function finishOnboarding() {
    haptic(24);
    const nowIso = new Date().toISOString();
    const existing = (() => { try { return JSON.parse(localStorage.getItem(PROFILE_KEY)) || {}; } catch { return {}; } })();
    const profile = {
      id: D.id, authProvider: D.authProvider || null, email: D.email || null,
      firstName: D.firstName || null, gender: D.gender || null,
      dateOfBirth: D.dateOfBirth || null, calculatedAge: D.calculatedAge || null,
      clubbingFrequency: D.frequency || null, profilePhoto: D.profilePhoto || null,
      onboardingComplete: true, createdAt: existing.createdAt || nowIso, updatedAt: nowIso,
      // privacy: only these are public by default
      public: { firstName: D.firstName || null, profilePhoto: D.profilePhoto || null, age: D.calculatedAge || null },
    };
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
      localStorage.setItem(DONE_KEY, '1');
      localStorage.removeItem(SAVE_KEY);
    } catch {}
    if (ocCta) { ocCta.textContent = 'Finding your night…'; ocCta.disabled = true; }
    // save the profile to the account so it's there on any future sign-in
    const token = getToken();
    if (token) {
      try { await Promise.race([saveProfileToServer(token, profile), new Promise((r) => setTimeout(r, 1500))]); } catch {}
    }
    location.replace('/');
  }
  async function saveProfileToServer(token, profile) {
    await fetch('/api/auth/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, profile }) });
  }

  // ============================================================
  //  BOOT — restore state, prefill, show correct screen
  // ============================================================
  function prefill() {
    if (D.firstName) { nameInput.value = D.firstName; $('#nameGo').disabled = false; }
    if (D.email) { $('#emailInput').value = D.email; }
    ['gender', 'frequency'].forEach((k) => {
      if (!D[k]) return;
      const group = $(`.cards[data-group="${k}"]`); if (!group) return;
      const opt = $$('.opt', group).find((o) => o.dataset.val === D[k]);
      if (opt) { opt.classList.add('sel'); const cta = $('.cta[data-act="next"]', group.closest('.screen')); if (cta) cta.disabled = false; }
    });
    if (D.profilePhoto) preview.innerHTML = `<img src="${D.profilePhoto}" alt="Your photo" />`;
    applyMascotGender();
  }
  function stars() {
    const box = $('#stars'); if (!box) return;
    for (let i = 0; i < 26; i++) { const s = document.createElement('i'); s.style.left = Math.random() * 100 + '%'; s.style.top = Math.random() * 100 + '%'; s.style.animationDelay = (Math.random() * 4) + 's'; box.appendChild(s); }
  }

  function boot() {
    // ?reset (or ?restart) wipes onboarding + profile and starts fresh — handy
    // for re-viewing the flow after completing it
    if (/[?&](reset|restart)\b/.test(location.search)) {
      try { [DONE_KEY, PROFILE_KEY, SAVE_KEY].forEach((k) => localStorage.removeItem(k)); } catch {}
      location.replace('/onboarding.html');
      return;
    }
    // already onboarded? go straight to the app
    try { if (localStorage.getItem(DONE_KEY)) { location.replace('/'); return; } } catch {}
    stars(); prefill();
    // resume at the saved (furthest reached) step — but never at 'done' unless allowed
    let start = draft.screen && ORDER.includes(draft.screen) ? draft.screen : 'welcome';
    if (start === 'done') start = 'photo'; // don't resume straight onto the finish screen
    // rebuild a sane back-history up to the resume point
    history = ORDER.slice(0, Math.max(0, ORDER.indexOf(start)));
    // show it
    screenEl(start).classList.add('active');
    const back = $('.back', screenEl(start)); if (back) back.hidden = (start === 'welcome');
    setProgress(start);
    current = start; onEnter(start);
    window.history.pushState({ cb: start }, '');
  }
  boot();
})();
