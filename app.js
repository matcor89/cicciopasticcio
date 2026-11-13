/* Cicciopasticcio — interfaccia */
(function () {
  const API = (window.CICCIO_API || '').replace(/\/$/, '');
  const $ = (id) => document.getElementById(id);
  const V = window.CiccioVoice;
  const LS = {
    get: (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* ignore */ } },
    del: (k) => { try { localStorage.removeItem(k); } catch (_) { /* ignore */ } },
  };

  let token = LS.get('ciccio_token', null);
  let chatHist = [];
  try { chatHist = JSON.parse(sessionStorage.getItem('ciccio_hist') || '[]'); } catch (_) { chatHist = []; }
  let pendingList = [];
  let attachUrl = null;
  let busy = false;
  let lastStatus = {};

  // ---------- API ----------
  async function req(path, opts = {}) {
    const r = await fetch(`${API}${path}`, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', 'x-ciccio-token': token || '' },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (r.status === 401 && path !== '/login') { showLogin(); throw new Error('Sessione scaduta'); }
    if (opts.raw) return r;
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Errore ${r.status}`);
    return j;
  }
  const api = {
    login: (pin) => req('/login', { method: 'POST', body: { pin } }),
    dashboard: () => req('/dashboard'),
    chat: (text, image_url) => req('/chat', { method: 'POST', body: { text, history: chatHist, image_url } }),
    confirm: (id, cancel) => req('/confirm', { method: 'POST', body: { id, cancel: !!cancel } }),
    upload: (data_url) => req('/upload', { method: 'POST', body: { data_url } }),
    subscribe: () => req('/meta/subscribe', { method: 'POST' }),
    logout: () => req('/logout', { method: 'POST' }),
    tts: async (text) => {
      try {
        const r = await req('/tts', { method: 'POST', body: { text }, raw: true });
        if (!r.ok) return null;
        return await r.blob();
      } catch (_) { return null; }
    },
  };
  V.api = api;

  // ---------- helpers ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function toast(msg, ms = 3500) {
    const t = $('toast');
    t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), ms);
  }
  const STATES = {
    idle: ['PRONTO', 1], wake: ['IN ASCOLTO DI «HEY CICCIOPASTICCIO»', 1], listening: ['TI ASCOLTO…', 1],
    thinking: ['STO PENSANDO…', 0.25], speaking: ['RISPONDE', 0.6],
  };
  function setState(s) {
    const key = s === 'idle' && V.wakeEnabled ? 'wake' : s;
    document.body.className = `st-${s}`;
    $('state-label').textContent = STATES[key][0];
    window.CiccioSphere.speed(STATES[key][1]);
  }
  function pushHist(role, content) {
    chatHist.push({ role, content });
    chatHist = chatHist.slice(-12);
    try { sessionStorage.setItem('ciccio_hist', JSON.stringify(chatHist)); } catch (_) { /* ignore */ }
  }

  // ---------- login ----------
  function showLogin() {
    token = null; LS.del('ciccio_token');
    $('login').classList.remove('hidden');
    setTimeout(() => $('pin').focus(), 50);
  }
  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('pin-err').textContent = '';
    try {
      const j = await api.login($('pin').value.trim());
      token = j.token; LS.set('ciccio_token', token);
      $('pin').value = '';
      $('login').classList.add('hidden');
      startApp();
    } catch (err) {
      $('pin-err').textContent = err.message;
    }
  });

  // ---------- dashboard ----------
  const off = (d, what) => `<div class="off">${esc(d && d.error ? (d.error === 'non collegato' ? `${what} non ancora collegato` : d.error) : 'Nessun dato')}</div>`;
  const has = (d) => d && !d.error;

  function renderChips(st) {
    const items = [
      ['Shopify', st.shopify], ['Meta Ads', st.meta_ads], ['Instagram', st.instagram],
      ['Gmail', st.google], ['Calendario', st.google], ['Promemoria', st.google],
      ['Note', true],
    ];
    $('chips').innerHTML = items.map(([n, on]) => `<span class="chip ${on ? 'on' : ''}"><span class="dot"></span>${n}</span>`).join('');
    const names = {
      claude: 'Claude (cervello)', pin: 'PIN', voice_azure: 'Voce Azure', google: 'Google', shopify: 'Shopify',
      meta_ads: 'Meta Ads', instagram: 'Instagram', webhook_ready: 'Messaggi Instagram (webhook)',
    };
    $('status-list').innerHTML = Object.entries(names)
      .map(([k, n]) => `<div class="row"><span>${n}</span><b style="color:${st[k] ? 'var(--ok)' : 'var(--muted)'}">${st[k] ? 'collegato' : 'da fare'}</b></div>`).join('');
  }

  function render(d) {
    lastStatus = d.status || {};
    renderChips(lastStatus);

    const s = d.shopify;
    $('p-shopify').querySelector('.body').outerHTML = has(s)
      ? `<div class="body"><div class="stats">
          <div class="stat"><b>${esc(s.sales_today)}</b><span>vendite (${s.orders_today} ord.)</span></div>
          <div class="stat"><b>${s.to_ship ?? '–'}</b><span>da spedire</span></div>
          <div class="stat"><b>${s.returns_open ?? '–'}</b><span>resi aperti</span></div></div>
          ${s.low_stock && s.low_stock.length ? `<div class="foot">Scorte basse: ${s.low_stock.map(esc).join(' · ')}</div>` : ''}</div>`
      : `<div class="body">${off(s, 'Shopify')}</div>`;

    const a = d.ads;
    $('p-ads').querySelector('.body').outerHTML = has(a)
      ? `<div class="body"><div class="stats">
          <div class="stat"><b>${esc(a.spend)}</b><span>spesa</span></div>
          <div class="stat"><b>${a.roas != null ? String(a.roas).replace('.', ',') + '×' : '–'}</b><span>ROAS</span></div>
          <div class="stat"><b>${esc(a.cost_per_purchase || '–')}</b><span>per acquisto</span></div></div></div>`
      : `<div class="body">${off(a, 'Meta Ads')}</div>`;

    const ig = d.instagram;
    $('ig-user').textContent = has(ig) && ig.username ? `@${ig.username}` : '';
    $('p-ig').querySelector('.body').outerHTML = has(ig)
      ? `<div class="body list">
          <div class="row"><span>Messaggi da leggere</span><b>${ig.unread_dm ?? '–'}</b></div>
          <div class="row"><span>Commenti nuovi (24 h)</span><b>${ig.new_comments ?? '–'}</b></div>
          <div class="row"><span>Ultimo post · visualizzazioni</span><b>${ig.last_post_views != null ? Number(ig.last_post_views).toLocaleString('it-IT') : '–'}</b></div>
          <div class="row"><span>Follower</span><b>${ig.followers != null ? Number(ig.followers).toLocaleString('it-IT') : '–'}</b></div></div>`
      : `<div class="body">${off(ig, 'Instagram')}</div>`;

    const ag = d.agenda;
    $('p-agenda').querySelector('.body').outerHTML = Array.isArray(ag)
      ? `<div class="body list">${ag.length ? ag.slice(0, 5).map((e) => `<div><span class="time">${esc(e.time)}</span><span class="item-title">${esc(e.title)}</span></div>`).join('') : '<div class="off">Niente in agenda oggi</div>'}</div>`
      : `<div class="body">${off(ag, 'Google')}</div>`;

    const tasks = d.tasks, notes = d.notes;
    let tHtml = '';
    if (Array.isArray(tasks)) tHtml += tasks.length ? tasks.map((t) => `<div class="row" style="justify-content:flex-start"><span aria-hidden="true" style="width:14px;height:14px;border-radius:4px;border:1.5px solid #5A86D6;flex-shrink:0;margin-top:2px"></span><span class="item-title">${esc(t.title)}${t.due ? ` <span class="muted">· ${esc(t.due.slice(8, 10) + '/' + t.due.slice(5, 7))}</span>` : ''}</span></div>`).join('') : '<div class="off">Nessun promemoria aperto</div>';
    else tHtml += off(tasks, 'Google');
    if (Array.isArray(notes) && notes.length) tHtml += notes.map((n) => `<div class="row muted" style="justify-content:flex-start">✎ ${esc(n.text.length > 70 ? n.text.slice(0, 70) + '…' : n.text)}</div>`).join('');
    $('p-tasks').querySelector('.body').outerHTML = `<div class="body list">${tHtml}</div>`;

    const gm = d.gmail;
    $('gm-count').textContent = has(gm) ? `${gm.unread} non lette` : '';
    $('p-gmail').querySelector('.body').outerHTML = has(gm)
      ? `<div class="body list">${gm.items.length ? gm.items.map((m) => `<div><div class="item-title">${esc(m.from)}</div><div class="muted">${esc(m.subject)}</div></div>`).join('') : '<div class="off">Nessuna email nuova</div>'}</div>`
      : `<div class="body">${off(gm, 'Google')}</div>`;

    pendingList = Array.isArray(d.pending) ? d.pending : pendingList;
    renderPending();

    renderSpend(d.spend);
    $('updated').textContent = `Aggiornato alle ${new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`;
  }

  const euro = (n) => Number(n || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
  function renderSpend(s) {
    const box = $('p-spend').querySelector('.body');
    $('spend-month').textContent = new Date().toLocaleDateString('it-IT', { month: 'long' });
    if (!has(s)) { box.outerHTML = `<div class="body">${off(s, 'Contatore')}</div>`; $('spend-detail').textContent = ''; return; }
    const pct = Math.min(100, s.budget_eur ? (s.month_eur / s.budget_eur) * 100 : 0);
    const cls = pct >= 100 ? 'full' : pct >= 80 ? 'warn' : '';
    const now = new Date();
    const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const forecast = now.getDate() > 2 ? (s.month_eur / now.getDate()) * days : null;
    box.outerHTML = `<div class="body">
      <div class="spend-top"><b>${euro(s.month_eur)}</b><span>su ${euro(s.budget_eur)}</span></div>
      <div class="bar ${cls}" role="progressbar" aria-label="Spesa del mese" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"><span style="width:${pct.toFixed(1)}%"></span></div>
      <div class="list" style="margin-top:10px">
        <div class="row"><span>Restano</span><b>${euro(Math.max(0, s.budget_eur - s.month_eur))}</b></div>
        <div class="row"><span>Oggi</span><b>${euro(s.today_eur)}</b></div>
        <div class="row"><span>Richieste nel mese</span><b>${s.requests}</b></div>
        ${forecast != null ? `<div class="row"><span>Previsione a fine mese</span><b>${euro(forecast)}</b></div>` : ''}
      </div>
      ${pct >= 100 ? '<div class="foot">Tetto raggiunto: Cicciopasticcio riparte il primo del mese.</div>' : pct >= 80 ? '<div class="foot">Sei oltre l\'80% del tetto mensile.</div>' : ''}
    </div>`;
    $('spend-detail').textContent = `${euro(s.month_eur)} spesi su ${euro(s.budget_eur)} questo mese (${s.requests} richieste).`;
  }

  async function refresh() {
    try { render(await api.dashboard()); } catch (e) { if (token) $('updated').textContent = `Non riesco ad aggiornare: ${e.message}`; }
  }

  // ---------- conferme ----------
  function renderPending() {
    $('pending').innerHTML = pendingList.map((p) => `<div class="box"><span>${esc(p.summary)}</span><span class="btns">
      <button class="mini-btn primary" data-confirm="${esc(p.id)}">Conferma</button>
      <button class="mini-btn" data-cancel="${esc(p.id)}">Annulla</button></span></div>`).join('');
  }
  async function doConfirm(id, cancel) {
    try {
      const r = await api.confirm(id, cancel);
      pendingList = pendingList.filter((p) => p.id !== id);
      renderPending();
      const msg = cancel ? 'Annullato.' : (r.ok ? `Fatto: ${r.message}.` : `Non ci sono riuscito: ${r.message}`);
      $('reply').textContent = msg;
      pushHist('assistant', msg);
      if (!cancel) V.speak(r.ok ? 'Fatto.' : msg);
      setTimeout(refresh, 1500);
    } catch (e) { toast(e.message); }
  }
  document.addEventListener('click', (e) => {
    const c = e.target.closest('[data-confirm]'); if (c) return doConfirm(c.dataset.confirm, false);
    const x = e.target.closest('[data-cancel]'); if (x) return doConfirm(x.dataset.cancel, true);
    const q = e.target.closest('[data-q]'); if (q) return ask(q.dataset.q);
  });

  // ---------- conversazione ----------
  const CONFIRM_RE = /^(s[iì],?\s*)?(conferm[ao]|confermo|procedi|vai pure|vai|ok procedi|invia(lo)?|pubblica(lo)?)\.?$/i;
  const CANCEL_RE = /^(no,?\s*)?(annulla|lascia stare|non (farlo|inviare))\.?$/i;
  const STOP_RE = /^(stop|basta|zitto|silenzio|fermati)\.?$/i;

  async function ask(text) {
    text = (text || '').trim();
    if (!text || busy) return;
    if (STOP_RE.test(text)) { V.stopSpeaking(); setState('idle'); return; }
    if (pendingList.length && CONFIRM_RE.test(text)) { $('said').textContent = `«${text}»`; return doConfirm(pendingList[0].id, false); }
    if (pendingList.length && CANCEL_RE.test(text)) { $('said').textContent = `«${text}»`; return doConfirm(pendingList[0].id, true); }

    busy = true;
    $('said').textContent = `«${text}»`;
    $('reply').textContent = '';
    setState('thinking');
    const img = attachUrl;
    clearAttach();
    try {
      const r = await api.chat(text, img);
      pushHist('user', img ? `${text} [con foto allegata]` : text);
      pushHist('assistant', r.reply);
      $('reply').textContent = r.reply;
      if (r.pending && r.pending.length) {
        const ids = new Set(pendingList.map((p) => p.id));
        pendingList = [...r.pending.filter((p) => !ids.has(p.id)), ...pendingList];
        renderPending();
      }
      busy = false;
      if (V.voiceEnabled) {
        await V.speak(r.reply, () => setState('speaking'));
      }
      setState('idle');
      setTimeout(refresh, 800);
    } catch (e) {
      busy = false;
      $('reply').textContent = `C'è stato un problema: ${e.message}`;
      setState('idle');
    }
  }

  $('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const t = $('text').value; $('text').value = '';
    ask(t);
  });

  function listen() {
    if (busy) return;
    V.stopSpeaking();
    V.pushToTalk();
  }
  $('btn-mic').addEventListener('click', listen);
  $('orb').addEventListener('click', listen);
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'm' || e.key === 'M')) { e.preventDefault(); listen(); }
    if (e.key === 'Escape') { V.stopSpeaking(); V.cancel(); setState('idle'); }
  });

  V.onState = (s) => { if (!busy && !V.speaking) setState(s === 'listening' ? 'listening' : 'idle'); };
  V.onWake = () => { $('said').textContent = 'Dimmi…'; };
  V.onInterim = (t) => { $('said').textContent = `«${t}»`; };
  V.onCommand = (t) => ask(t);
  V.onError = (m) => toast(m, 6000);

  // ---------- foto ----------
  function clearAttach() { attachUrl = null; $('attach-chip').classList.add('hidden'); }
  $('attach-x').addEventListener('click', clearAttach);
  $('btn-attach').addEventListener('click', () => $('file').click());
  $('file').addEventListener('change', async () => {
    const f = $('file').files[0]; $('file').value = '';
    if (!f) return;
    try {
      toast('Carico la foto…');
      const dataUrl = await resize(f, 1600);
      const r = await api.upload(dataUrl);
      attachUrl = r.url;
      $('attach-img').src = dataUrl;
      $('attach-chip').classList.remove('hidden');
      toast('Foto pronta: dimmi cosa farne (es. «pubblicala su Instagram con una didascalia»)', 5000);
    } catch (e) { toast(`Caricamento non riuscito: ${e.message}`); }
  });
  function resize(file, max) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.86));
      };
      img.onerror = () => reject(new Error('immagine non leggibile'));
      img.src = URL.createObjectURL(file);
    });
  }

  // ---------- impostazioni ----------
  $('btn-settings').addEventListener('click', () => $('drawer').classList.remove('hidden'));
  $('drawer-x').addEventListener('click', () => $('drawer').classList.add('hidden'));
  $('opt-wake').addEventListener('change', (e) => { LS.set('ciccio_wake', e.target.checked); V.setWake(e.target.checked); setState('idle'); });
  $('opt-voice').addEventListener('change', (e) => { LS.set('ciccio_voice', e.target.checked); V.voiceEnabled = e.target.checked; if (!e.target.checked) V.stopSpeaking(); });
  $('btn-google').addEventListener('click', () => { window.location.href = `${API}/google/start?t=${encodeURIComponent(token)}`; });
  $('btn-meta').addEventListener('click', async () => {
    try { const r = await api.subscribe(); toast(`Fatto: ${r.message}`); } catch (e) { toast(e.message, 6000); }
  });
  $('btn-logout').addEventListener('click', async () => {
    try { await api.logout(); } catch (_) { /* ignore */ }
    V.setWake(false);
    $('drawer').classList.add('hidden');
    showLogin();
  });

  // ---------- avvio ----------
  function startApp() {
    const wake = LS.get('ciccio_wake', true);
    const voice = LS.get('ciccio_voice', true);
    $('opt-wake').checked = wake && V.supported;
    $('opt-wake').disabled = !V.supported;
    $('opt-voice').checked = voice;
    V.voiceEnabled = voice;
    if (wake && V.supported) V.setWake(true);
    if (!V.supported) $('hint').textContent = 'Per la voce apri Cicciopasticcio con Google Chrome';
    else $('hint').textContent = 'Di\' «Hey Cicciopasticcio», tocca la sfera o premi Ctrl + M';
    setState('idle');
    refresh();
    clearInterval(startApp._t);
    startApp._t = setInterval(() => { if (!document.hidden) refresh(); }, 120000);
  }

  document.addEventListener('visibilitychange', () => { if (!document.hidden && token) refresh(); });

  $('today').textContent = 'assistente del negozio · ' + new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
  window.CiccioSphere.init($('scene'));

  const params = new URLSearchParams(location.search);
  if (params.get('google') === 'ok') {
    toast(`Google collegato${params.get('email') ? ` (${params.get('email')})` : ''}`, 5000);
    window.history.replaceState(null, '', location.pathname);
  }

  if (!API) { $('reply').textContent = 'Manca l\'indirizzo del server in config.js'; }
  else if (!token) showLogin();
  else startApp();

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
