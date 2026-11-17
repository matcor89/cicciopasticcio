/* Cicciopasticcio — montaggio video sul dispositivo (gratis: niente server, niente intelligenza artificiale a pagamento)
   Le clip e le foto vengono disegnate in sequenza su una tela, con scritte, logo e musica, e registrate in un file video. */
(function () {
  let deps = null;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const num = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
  const sec = (n) => `${(Math.round(n * 10) / 10).toLocaleString('it-IT')} s`;

  const DEF = { titolo: '', sottotitolo: '', sito: 'dandy-abbigliamento.com', durata_sec: 20, formato: 'reel', logo: true, chiusura: true, audio_originale: true, transizioni: true, hq: false,
    scritta_durata: 'inizio', scritta_posizione: 'basso', scritta_colore: '#F2F6FF', scritta_grandezza: 'media', sottotitolo_grandezza: 'media' };
  // colori detti a voce → codice colore
  const COLORI = { bianco: '#FFFFFF', nero: '#111111', oro: '#D4AF37', dorato: '#D4AF37', giallo: '#FFD23F', rosso: '#E53935', blu: '#2F6FED', azzurro: '#7FC4FF',
    verde: '#3CB371', rosa: '#F48FB1', arancione: '#FF8C2B', viola: '#9C6ADE', grigio: '#B8BEC9', beige: '#E8D9BF', crema: '#F5EBDD', marrone: '#8B5A2B' };
  const colore = (c) => { const t = String(c || '').trim().toLowerCase(); if (COLORI[t]) return COLORI[t]; return /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(t) ? t : DEF.scritta_colore; };
  const GRANDEZZA = { piccola: 0.72, media: 1, grande: 1.3 };
  // sottotitolo: quota della larghezza del video (prima era sempre 0.042, ora «piccola»)
  const SOTTO = { piccola: 0.042, media: 0.055, grande: 0.07, 'molto grande': 0.088 };
  const FORMATS = { reel: ['Reel 9:16', 9, 16], post: ['Post 4:5', 4, 5], quadrato: ['Quadrato 1:1', 1, 1] };
  const FADE = 0.3, CLOSING = 2.5, TITLE_T = 3.4, IMG_DUR = 3;
  const MAX_UPLOAD = 48 * 1024 * 1024;

  let opts = { ...DEF };
  let items = [];        // { id, file, kind, url, len, thumb, img, start, dur }
  let music = null;      // { file, url, name }
  let musicVol = 0.8;
  let result = null;     // { blob, url, mime, ext, publicUrl }
  let rendering = false;
  let abortFlag = false;
  let logoImg = null;
  let seq = 0;

  // ---------- interfaccia ----------
  function build() {
    if (document.getElementById('vd')) return;
    const o = document.createElement('div');
    o.id = 'vd';
    o.className = 'overlay hidden';
    o.innerHTML = `<div class="sheet wide" role="dialog" aria-modal="true" aria-labelledby="vd-h">
      <div class="sheet-head"><div><h1 id="vd-h">MONTAGGIO VIDEO</h1><div class="muted">Si monta qui sul dispositivo: è gratis e non consuma la spesa del mese.</div></div>
        <button class="icon-btn" id="vd-x" aria-label="Chiudi">✕</button></div>
      <div class="vd-grid">
        <div class="vd-col">
          <h3>CLIP E FOTO <small class="muted" id="vd-count"></small></h3>
          <div class="vd-items" id="vd-items"></div>
          <input type="file" id="vd-file" accept="video/*,image/*" multiple class="hidden">
          <button class="mini-btn primary" id="vd-add">+ Aggiungi clip o foto</button>
          <div class="muted vd-note">L'ordine è quello della lista. «Da» e «durata» in secondi: lasciali vuoti e li sceglie lui.</div>
          <h3>MUSICA</h3>
          <div id="vd-music"></div>
          <input type="file" id="vd-mfile" accept="audio/*" class="hidden">
        </div>
        <div class="vd-col">
          <h3>IMPOSTAZIONI</h3>
          <label class="vd-f">Scritta iniziale<input type="text" id="vd-titolo" maxlength="60" placeholder="es. Nuovi arrivi"></label>
          <div class="vd-row2">
            <label class="vd-f">Sottotitolo<input type="text" id="vd-sotto" maxlength="80" placeholder="es. Autunno-inverno 2026"></label>
            <label class="vd-f">Grandezza sottotitolo<select id="vd-ssgr"><option value="piccola">Piccola</option><option value="media">Media</option><option value="grande">Grande</option><option value="molto grande">Molto grande</option></select></label>
          </div>
          <div class="vd-row2">
            <label class="vd-f">La scritta resta<select id="vd-sdur"><option value="inizio">Solo all'inizio</option><option value="tutto">Per tutto il video</option></select></label>
            <label class="vd-f">Posizione<select id="vd-spos"><option value="alto">In alto</option><option value="centro">Al centro</option><option value="basso">In basso</option></select></label>
          </div>
          <div class="vd-row2">
            <label class="vd-f">Grandezza<select id="vd-sgr"><option value="piccola">Piccola</option><option value="media">Media</option><option value="grande">Grande</option></select></label>
            <label class="vd-f">Colore<input type="color" id="vd-scol" class="vd-color"></label>
          </div>
          <div class="vd-row2">
            <label class="vd-f">Formato<select id="vd-formato">${Object.entries(FORMATS).map(([k, v]) => `<option value="${k}">${v[0]}</option>`).join('')}</select></label>
            <label class="vd-f">Durata (s)<input type="number" id="vd-durata" min="5" max="90" step="1"></label>
          </div>
          <label class="toggle">Logo Dandy nell'angolo <input type="checkbox" id="vd-logo"></label>
          <label class="toggle">Chiusura con logo e sito <input type="checkbox" id="vd-chiusura"></label>
          <label class="vd-f">Scritta della chiusura<input type="text" id="vd-sito" maxlength="40"></label>
          <label class="toggle">Audio originale delle clip <input type="checkbox" id="vd-audio"></label>
          <label class="toggle">Dissolvenze tra le clip <input type="checkbox" id="vd-trans"></label>
          <label class="toggle">Alta qualità (1080p, più pesante) <input type="checkbox" id="vd-hq"></label>
        </div>
      </div>
      <div class="vd-out">
        <div class="vd-stage"><canvas id="vd-canvas" aria-label="Anteprima del montaggio"></canvas><video id="vd-video" controls playsinline class="hidden"></video></div>
        <div class="vd-side">
          <div class="bar"><span id="vd-prog" style="width:0%"></span></div>
          <div id="vd-status" class="vd-status" aria-live="polite">Aggiungi almeno una clip o una foto.</div>
          <button class="big-btn" id="vd-go">Monta il video</button>
          <button class="mini-btn hidden" id="vd-stop">Interrompi</button>
          <a class="mini-btn hidden" id="vd-dl" download>Scarica il video</a>
          <button class="mini-btn primary hidden" id="vd-ig">Pubblica su Instagram</button>
        </div>
      </div>
    </div>`;
    document.body.appendChild(o);
    const $ = (id) => document.getElementById(id);
    $('vd-x').addEventListener('click', close);
    o.addEventListener('click', (e) => { if (e.target === o && !rendering) close(); });
    $('vd-add').addEventListener('click', () => $('vd-file').click());
    $('vd-file').addEventListener('change', async () => { const fs = [...$('vd-file').files]; $('vd-file').value = ''; for (const f of fs) await addFile(f); });
    $('vd-mfile').addEventListener('change', () => {
      const f = $('vd-mfile').files[0]; $('vd-mfile').value = '';
      if (!f) return;
      if (music) URL.revokeObjectURL(music.url);
      music = { file: f, url: URL.createObjectURL(f), name: f.name };
      renderMusic(); invalidate();
    });
    $('vd-items').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const i = items.findIndex((x) => x.id === Number(b.dataset.id)); if (i < 0) return;
      if (b.dataset.act === 'up' && i > 0) [items[i - 1], items[i]] = [items[i], items[i - 1]];
      if (b.dataset.act === 'down' && i < items.length - 1) [items[i + 1], items[i]] = [items[i], items[i + 1]];
      if (b.dataset.act === 'del') { URL.revokeObjectURL(items[i].url); items.splice(i, 1); }
      renderItems(); invalidate();
    });
    $('vd-items').addEventListener('change', (e) => {
      const inp = e.target.closest('[data-f]'); if (!inp) return;
      const it = items.find((x) => x.id === Number(inp.dataset.id)); if (!it) return;
      it[inp.dataset.f] = num(inp.value);
      renderPlan(); invalidate();
    });
    $('vd-music').addEventListener('click', (e) => {
      if (e.target.closest('#vd-mpick')) $('vd-mfile').click();
      if (e.target.closest('#vd-mdel')) { URL.revokeObjectURL(music.url); music = null; renderMusic(); invalidate(); }
    });
    $('vd-music').addEventListener('input', (e) => { if (e.target.id === 'vd-mvol') musicVol = Number(e.target.value) / 100; });
    const bind = (id, key, kind) => $(id).addEventListener(kind === 'check' ? 'change' : 'input', (e) => {
      opts[key] = kind === 'check' ? e.target.checked : kind === 'num' ? clamp(num(e.target.value) || DEF.durata_sec, 5, 90) : e.target.value;
      renderPlan(); invalidate();
    });
    bind('vd-titolo', 'titolo'); bind('vd-sotto', 'sottotitolo'); bind('vd-sito', 'sito'); bind('vd-durata', 'durata_sec', 'num');
    $('vd-formato').addEventListener('change', (e) => { opts.formato = e.target.value; invalidate(); preview(); });
    bind('vd-logo', 'logo', 'check'); bind('vd-chiusura', 'chiusura', 'check'); bind('vd-audio', 'audio_originale', 'check');
    bind('vd-trans', 'transizioni', 'check'); bind('vd-hq', 'hq', 'check');
    for (const [id, key] of [['vd-sdur', 'scritta_durata'], ['vd-spos', 'scritta_posizione'], ['vd-sgr', 'scritta_grandezza'], ['vd-ssgr', 'sottotitolo_grandezza'], ['vd-scol', 'scritta_colore']]) {
      $(id).addEventListener(id === 'vd-scol' ? 'input' : 'change', (e) => { opts[key] = e.target.value; invalidate(); preview(); });
    }
    $('vd-go').addEventListener('click', () => { if (!rendering) render(); });
    $('vd-stop').addEventListener('click', () => { abortFlag = true; });
    $('vd-ig').addEventListener('click', () => {
      if (!result || !result.publicUrl) return;
      close();
      deps.ask('Pubblica su Instagram come Reel il video che ho appena montato, con una didascalia adatta al negozio');
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !o.classList.contains('hidden') && !rendering) close(); });
    logoImg = new Image(); logoImg.src = 'logo-white.png';
  }

  function fillForm() {
    const $ = (id) => document.getElementById(id);
    $('vd-titolo').value = opts.titolo; $('vd-sotto').value = opts.sottotitolo; $('vd-sito').value = opts.sito;
    $('vd-formato').value = opts.formato; $('vd-durata').value = opts.durata_sec;
    $('vd-logo').checked = opts.logo; $('vd-chiusura').checked = opts.chiusura; $('vd-audio').checked = opts.audio_originale;
    $('vd-trans').checked = opts.transizioni; $('vd-hq').checked = opts.hq;
    $('vd-sdur').value = opts.scritta_durata; $('vd-spos').value = opts.scritta_posizione;
    $('vd-sgr').value = opts.scritta_grandezza; $('vd-ssgr').value = SOTTO[opts.sottotitolo_grandezza] ? opts.sottotitolo_grandezza : 'media'; $('vd-scol').value = toHex6(opts.scritta_colore);
  }

  function renderItems() {
    const box = document.getElementById('vd-items');
    document.getElementById('vd-count').textContent = items.length ? `· ${items.length}` : '';
    box.innerHTML = items.length ? items.map((it, i) => `<div class="vd-item">
        <img src="${esc(it.thumb || '')}" alt="">
        <div class="vd-imeta"><div class="item-title">${i + 1}. ${esc(it.file.name.length > 28 ? it.file.name.slice(0, 27) + '…' : it.file.name)}</div>
          <div class="muted">${it.kind === 'video' ? `video · ${sec(it.len)}` : 'foto'} · <span data-plan="${it.id}"></span></div>
          <div class="vd-inputs">
            ${it.kind === 'video' ? `<label>da <input type="number" min="0" step="0.5" data-id="${it.id}" data-f="start" value="${it.start ?? ''}" placeholder="auto"></label>` : ''}
            <label>durata <input type="number" min="0.5" step="0.5" data-id="${it.id}" data-f="dur" value="${it.dur ?? ''}" placeholder="auto"></label>
          </div></div>
        <div class="vd-ibtns">
          <button class="mini-btn" data-act="up" data-id="${it.id}" aria-label="Sposta su" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="mini-btn" data-act="down" data-id="${it.id}" aria-label="Sposta giù" ${i === items.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="mini-btn" data-act="del" data-id="${it.id}" aria-label="Togli">✕</button>
        </div></div>`).join('') : '<div class="off">Nessuna clip ancora.</div>';
    renderPlan();
  }

  function renderPlan() {
    const segs = plan();
    for (const s of segs) {
      const span = document.querySelector(`[data-plan="${s.it.id}"]`);
      if (span) span.textContent = s.it.kind === 'video' ? `usa ${sec(s.dur)} da ${sec(s.start)}` : `${sec(s.dur)}`;
    }
    if (!rendering && !result) {
      const tot = segs.reduce((a, s) => a + s.dur, 0) + (opts.chiusura && segs.length ? CLOSING : 0);
      setStatus(segs.length ? `Video di circa ${sec(tot)}. Tocca «Monta il video».` : 'Aggiungi almeno una clip o una foto.');
    }
  }

  function renderMusic() {
    document.getElementById('vd-music').innerHTML = music
      ? `<div class="vd-mrow"><span class="item-title">♪ ${esc(music.name.length > 34 ? music.name.slice(0, 33) + '…' : music.name)}</span>
          <button class="mini-btn" id="vd-mdel">Togli</button></div>
         <label class="vd-f">Volume musica<input type="range" id="vd-mvol" min="0" max="100" value="${Math.round(musicVol * 100)}"></label>
         <div class="muted vd-note">Usa solo musica che hai il diritto di usare: Instagram può togliere l'audio ai Reel con brani protetti.</div>`
      : '<button class="mini-btn" id="vd-mpick">Scegli un file musicale</button>';
  }

  function setStatus(t) { document.getElementById('vd-status').textContent = t; }
  function setProg(p) { document.getElementById('vd-prog').style.width = `${clamp(p * 100, 0, 100).toFixed(1)}%`; }

  function invalidate() {
    if (rendering || !result) return;
    result = null;
    const $ = (id) => document.getElementById(id);
    $('vd-video').classList.add('hidden'); $('vd-canvas').classList.remove('hidden');
    $('vd-dl').classList.add('hidden'); $('vd-ig').classList.add('hidden');
    $('vd-go').textContent = 'Monta il video'; setProg(0);
    if (deps.onVideo) deps.onVideo(null);
    renderPlan(); preview();
  }

  // ---------- file ----------
  async function addFile(f) {
    const kind = f.type.startsWith('video/') ? 'video' : f.type.startsWith('image/') ? 'image' : null;
    if (!kind) { deps.toast(`«${f.name}» non è un video o una foto`); return; }
    const url = URL.createObjectURL(f);
    const it = { id: ++seq, file: f, kind, url, len: 0, thumb: '', img: null, start: null, dur: null };
    try {
      if (kind === 'image') {
        it.img = await loadImg(url);
        it.thumb = url;
      } else {
        const v = document.createElement('video');
        v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
        await once(v, 'loadedmetadata', 15000);
        it.len = Number.isFinite(v.duration) ? v.duration : 0;
        if (!it.len || !v.videoWidth) throw new Error('video non leggibile');
        v.currentTime = Math.min(1, it.len / 3);
        await once(v, 'seeked', 8000).catch(() => {});
        const c = document.createElement('canvas'); c.width = 96; c.height = 96;
        cover(c.getContext('2d'), v, v.videoWidth, v.videoHeight, 96, 96, 1);
        it.thumb = c.toDataURL('image/jpeg', 0.7);
        v.removeAttribute('src'); v.load();
      }
      items.push(it);
      renderItems(); invalidate(); preview();
    } catch (e) {
      URL.revokeObjectURL(url);
      deps.toast(`Non riesco a leggere «${f.name}»: ${kind === 'video' ? 'formato video non supportato da questo browser' : 'formato foto non supportato'}`, 6000);
    }
  }
  function loadImg(url) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('foto')); i.src = url; }); }
  function once(elm, ev, ms) {
    return new Promise((res, rej) => {
      const t = setTimeout(() => { cleanup(); rej(new Error('tempo scaduto')); }, ms);
      const ok = () => { cleanup(); res(); };
      const ko = () => { cleanup(); rej(new Error('errore')); };
      const cleanup = () => { clearTimeout(t); elm.removeEventListener(ev, ok); elm.removeEventListener('error', ko); };
      elm.addEventListener(ev, ok); elm.addEventListener('error', ko);
    });
  }

  // ---------- piano: quanto dura ogni pezzo ----------
  function plan() {
    const closing = opts.chiusura ? CLOSING : 0;
    const target = Math.max(3, opts.durata_sec - closing);
    const segs = items.map((it) => {
      if (it.kind === 'image') return { it, start: 0, dur: clamp(it.dur || IMG_DUR, 0.5, 30), fixed: true };
      const start = clamp(it.start != null ? it.start : (it.len > 4 ? 0.5 : 0), 0, Math.max(0, it.len - 0.5));
      const avail = Math.max(0.5, it.len - start);
      if (it.dur) return { it, start, dur: Math.min(it.dur, avail), fixed: true };
      return { it, start, dur: 0, avail, fixed: false };
    });
    let rest = target - segs.filter((s) => s.fixed).reduce((a, s) => a + s.dur, 0);
    let open = segs.filter((s) => !s.fixed);
    if (rest <= open.length * 0.8) { for (const s of open) s.dur = Math.min(s.avail, 2); return segs; }
    // si divide il tempo che resta: le clip corte prendono tutto quello che hanno, le altre si spartiscono il resto
    while (open.length) {
      const share = rest / open.length;
      const short = open.filter((s) => s.avail <= share);
      if (!short.length) { for (const s of open) s.dur = share; break; }
      for (const s of short) { s.dur = s.avail; rest -= s.avail; }
      open = open.filter((s) => !short.includes(s));
    }
    return segs;
  }

  function dims() {
    const [, a, b] = FORMATS[opts.formato] || FORMATS.reel;
    const w = opts.hq ? 1080 : 720;
    return { W: w, H: Math.round((w * b) / a / 2) * 2 };
  }

  // ---------- disegno ----------
  function cover(ctx, src, sw, sh, W, H, scale) {
    const k = Math.max(W / sw, H / sh) * (scale || 1);
    const dw = sw * k, dh = sh * k;
    ctx.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
  }

  function fitFont(ctx, text, family, weight, maxSize, maxW) {
    let size = maxSize;
    for (; size > 18; size -= 2) {
      ctx.font = `${weight} ${size}px ${family}`;
      if (ctx.measureText(text).width <= maxW) break;
    }
    return size;
  }

  function wrap(ctx, text, maxW) {
    const words = text.split(/\s+/); const lines = []; let line = '';
    for (const w of words) {
      const t = line ? `${line} ${w}` : w;
      if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
    }
    if (line) lines.push(line);
    return lines.slice(0, 3);
  }

  const toHex6 = (c) => { const h = colore(c); return h.length === 4 ? `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}` : h; };
  // la scritta chiara ha l'ombra scura dietro, quella scura un alone chiaro: si legge su qualsiasi immagine
  function isDark(hex) {
    const h = toHex6(hex).slice(1);
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    return 0.299 * r + 0.587 * g + 0.114 * b < 110;
  }

  function drawTitle(ctx, W, H, alpha) {
    if (!opts.titolo && !opts.sottotitolo) return;
    const pos = ['alto', 'centro', 'basso'].includes(opts.scritta_posizione) ? opts.scritta_posizione : 'basso';
    const k = GRANDEZZA[opts.scritta_grandezza] || 1;
    const col = colore(opts.scritta_colore), dark = isDark(col);
    ctx.save();
    ctx.globalAlpha = alpha;
    // velo dietro la scritta, dalla parte dove sta
    const tint = dark ? '245,240,232' : '7,18,43';
    if (pos === 'basso') {
      const g = ctx.createLinearGradient(0, H * 0.55, 0, H);
      g.addColorStop(0, `rgba(${tint},0)`); g.addColorStop(0.45, `rgba(${tint},.55)`); g.addColorStop(1, `rgba(${tint},.75)`);
      ctx.fillStyle = g; ctx.fillRect(0, H * 0.55, W, H * 0.45);
    } else if (pos === 'alto') {
      const g = ctx.createLinearGradient(0, 0, 0, H * 0.42);
      g.addColorStop(0, `rgba(${tint},.7)`); g.addColorStop(0.6, `rgba(${tint},.4)`); g.addColorStop(1, `rgba(${tint},0)`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H * 0.42);
    } else {
      const g = ctx.createLinearGradient(0, H * 0.32, 0, H * 0.68);
      g.addColorStop(0, `rgba(${tint},0)`); g.addColorStop(0.5, `rgba(${tint},.45)`); g.addColorStop(1, `rgba(${tint},0)`);
      ctx.fillStyle = g; ctx.fillRect(0, H * 0.32, W, H * 0.36);
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = dark ? 'rgba(255,255,255,.55)' : 'rgba(0,0,0,.45)'; ctx.shadowBlur = W * 0.02;
    const maxW = W * 0.86;
    // prima misuro il blocco (titolo + sottotitolo), poi lo metto in alto, al centro o in basso
    let tSize = 0, tLines = [], sSize = 0;
    if (opts.titolo) {
      tSize = fitFont(ctx, opts.titolo, '"Bodoni Moda", Didot, Georgia, serif', 500, Math.round(W * 0.1 * k), maxW);
      tLines = [opts.titolo];
      if (tSize < W * 0.07 * k) { tSize = Math.round(W * 0.075 * k); ctx.font = `500 ${tSize}px "Bodoni Moda", Didot, Georgia, serif`; tLines = wrap(ctx, opts.titolo, maxW); }
    }
    let sLines = [];
    if (opts.sottotitolo) {
      // il sottotitolo ha la sua grandezza; se è lungo va su due righe invece di rimpicciolirsi
      sSize = Math.round(W * (SOTTO[opts.sottotitolo_grandezza] || SOTTO.media));
      ctx.font = `500 ${sSize}px Inter, system-ui, sans-serif`;
      sLines = wrap(ctx, opts.sottotitolo, maxW).slice(0, 2);
      if (sLines.join(' ').length < opts.sottotitolo.length || sLines.some((l) => ctx.measureText(l).width > maxW)) {
        sSize = fitFont(ctx, opts.sottotitolo, 'Inter, system-ui, sans-serif', 500, sSize, maxW * 2);
        ctx.font = `500 ${sSize}px Inter, system-ui, sans-serif`;
        sLines = wrap(ctx, opts.sottotitolo, maxW).slice(0, 2);
      }
    }
    const lh = tSize * 1.12, slh = sSize * 1.25;
    const blockH = (tLines.length ? tLines.length * lh : 0) + (sLines.length ? sLines.length * slh + sSize * 0.35 : 0);
    const top = pos === 'alto' ? H * 0.1 + (opts.logo ? W * 0.12 : 0)
      : pos === 'centro' ? (H - blockH) / 2
      : H * (opts.formato === 'reel' ? 0.79 : 0.83) - blockH;
    let y = top;
    if (tLines.length) {
      ctx.font = `500 ${tSize}px "Bodoni Moda", Didot, Georgia, serif`;
      ctx.fillStyle = col;
      for (const l of tLines) { y += lh; ctx.fillText(l, W / 2, y - lh * 0.18); }
    }
    if (sLines.length) {
      ctx.font = `500 ${sSize}px Inter, system-ui, sans-serif`;
      ctx.fillStyle = col; ctx.globalAlpha = alpha * 0.9;
      y += sSize * 0.35;
      for (const l of sLines) { y += slh; ctx.fillText(l, W / 2, y - slh * 0.2); }
    }
    ctx.restore();
  }

  function drawLogo(ctx, W) {
    if (!opts.logo || !logoImg || !logoImg.complete || !logoImg.naturalWidth) return;
    const w = W * 0.2, h = (w * logoImg.naturalHeight) / logoImg.naturalWidth, m = W * 0.05;
    ctx.save(); ctx.globalAlpha = 0.9; ctx.shadowColor = 'rgba(0,0,0,.4)'; ctx.shadowBlur = W * 0.015;
    ctx.drawImage(logoImg, W - w - m, m, w, h); ctx.restore();
  }

  function drawClosing(ctx, W, H, local) {
    const g = ctx.createRadialGradient(W / 2, H * 0.42, 0, W / 2, H * 0.42, Math.max(W, H) * 0.75);
    g.addColorStop(0, '#10295E'); g.addColorStop(0.5, '#0A1A3F'); g.addColorStop(1, '#07122B');
    ctx.save();
    ctx.globalAlpha = clamp(local / 0.45, 0, 1);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    if (logoImg && logoImg.naturalWidth) {
      const w = W * 0.5, h = (w * logoImg.naturalHeight) / logoImg.naturalWidth;
      ctx.drawImage(logoImg, (W - w) / 2, H * 0.44 - h / 2, w, h);
      ctx.font = `500 ${Math.round(W * 0.04)}px Inter, system-ui, sans-serif`;
      ctx.fillStyle = '#C9D8F5'; ctx.textAlign = 'center';
      if (opts.sito) ctx.fillText(opts.sito, W / 2, H * 0.44 + h / 2 + W * 0.09);
    }
    ctx.restore();
  }

  // Disegna un fotogramma: pezzo corrente, dissolvenze, scritte e logo
  function drawFrame(ctx, W, H, cur, tl, total) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    if (!cur) return;
    if (cur.closing) { drawClosing(ctx, W, H, (performance.now() - cur.t0) / 1000); return; }
    const s = cur.seg;
    const local = s.it.kind === 'video' ? Math.max(0, cur.v.currentTime - s.start) : (performance.now() - cur.t0) / 1000;
    let a = 1;
    if (opts.transizioni) {
      if (cur.i > 0) a = Math.min(a, clamp(local / FADE, 0, 1));
      if (!cur.last || opts.chiusura) a = Math.min(a, clamp((s.dur - local) / FADE, 0, 1));
    }
    ctx.save(); ctx.globalAlpha = a;
    if (s.it.kind === 'video') cover(ctx, cur.v, cur.v.videoWidth, cur.v.videoHeight, W, H, 1);
    else cover(ctx, s.it.img, s.it.img.naturalWidth, s.it.img.naturalHeight, W, H, 1 + 0.08 * clamp(local / s.dur, 0, 1));
    ctx.restore();
    if (opts.scritta_durata === 'tutto') drawTitle(ctx, W, H, clamp(tl / 0.4, 0, 1));
    else if (tl < TITLE_T) drawTitle(ctx, W, H, Math.min(clamp(tl / 0.4, 0, 1), clamp((TITLE_T - tl) / 0.4, 0, 1)));
    drawLogo(ctx, W);
  }

  // Anteprima ferma: primo fotogramma con scritte e logo
  function preview() {
    const c = document.getElementById('vd-canvas'); if (!c) return;
    const { W, H } = dims(); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const first = items[0];
    ctx.fillStyle = '#0A1A3F'; ctx.fillRect(0, 0, W, H);
    if (first && first.kind === 'image') cover(ctx, first.img, first.img.naturalWidth, first.img.naturalHeight, W, H, 1);
    else if (first && first.thumb) { const i = new Image(); i.onload = () => { if (items[0] === first && !rendering) { cover(ctx, i, i.width, i.height, W, H, 1); drawTitle(ctx, W, H, 1); drawLogo(ctx, W); } }; i.src = first.thumb; }
    else { ctx.fillStyle = '#9FB6E0'; ctx.font = `500 ${Math.round(W * 0.04)}px Inter, sans-serif`; ctx.textAlign = 'center'; ctx.fillText('Anteprima', W / 2, H / 2); }
    drawTitle(ctx, W, H, 1); drawLogo(ctx, W);
  }

  // ---------- registrazione ----------
  // Instagram vuole MP4 con video H.264: con Chrome aggiornato (anche sul Chromebook) e con l'iPhone esce così
  function pickMime() {
    if (!window.MediaRecorder) return null;
    const ok = (m) => { try { return MediaRecorder.isTypeSupported(m); } catch (_) { return false; } };
    // serve anche l'audio AAC (mp4a): H.264 con audio Opus Instagram non lo accetta
    const h264 = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.4D401F,mp4a.40.2', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2'].find(ok);
    if (h264) return { mime: h264, ig: true };
    const safari = /Safari\//.test(navigator.userAgent) && !/Chrome|Chromium|CriOS|Android/.test(navigator.userAgent);
    if (ok('video/mp4')) return { mime: 'video/mp4', ig: safari };
    const webm = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(ok);
    return webm ? { mime: webm, ig: false } : null;
  }

  async function render() {
    const segs = plan();
    if (!segs.length) { deps.toast('Aggiungi almeno una clip o una foto'); return; }
    const picked = pickMime();
    const mime = picked && picked.mime;
    const c = document.getElementById('vd-canvas');
    if (!mime || !c.captureStream) { setStatus('Questo browser non sa registrare video: apri Cicciopasticcio con Google Chrome aggiornato.'); return; }
    const $ = (id) => document.getElementById(id);
    rendering = true; abortFlag = false; result = null;
    if (deps.onVideo) deps.onVideo(null);
    $('vd-go').disabled = true; $('vd-stop').classList.remove('hidden');
    $('vd-dl').classList.add('hidden'); $('vd-ig').classList.add('hidden');
    $('vd-video').classList.add('hidden'); c.classList.remove('hidden');
    setProg(0); setStatus('Preparo le clip…');

    const { W, H } = dims(); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;overflow:hidden';
    document.body.appendChild(holder);
    let ac = null, rec = null, musicEl = null, running = false;
    const videos = [];
    try {
      try { await Promise.all([document.fonts.load('500 40px "Bodoni Moda"'), document.fonts.load('500 20px Inter')]); } catch (_) { /* ignore */ }
      ac = new (window.AudioContext || window.webkitAudioContext)();
      await ac.resume().catch(() => {});
      const dest = ac.createMediaStreamDestination();
      const origVol = music ? 0.5 : 1;
      for (const s of segs) {
        if (s.it.kind !== 'video') continue;
        const v = document.createElement('video');
        v.playsInline = true; v.preload = 'auto'; v.src = s.it.url;
        v.muted = !opts.audio_originale;
        holder.appendChild(v); videos.push(v);
        await once(v, 'loadedmetadata', 15000);
        if (opts.audio_originale) {
          const g = ac.createGain(); g.gain.value = 0;
          ac.createMediaElementSource(v).connect(g).connect(dest);
          s.gain = g;
        }
        v.currentTime = s.start;
        await once(v, 'seeked', 10000).catch(() => {});
        s.v = v;
      }
      let musicGain = null;
      if (music) {
        musicEl = new Audio(music.url); musicEl.loop = true;
        holder.appendChild(musicEl);
        musicGain = ac.createGain(); musicGain.gain.value = musicVol;
        ac.createMediaElementSource(musicEl).connect(musicGain).connect(dest);
      }

      const stream = c.captureStream(30);
      const at = dest.stream.getAudioTracks()[0];
      if (at) stream.addTrack(at);
      const chunks = [];
      rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: opts.hq ? 8000000 : 4500000, audioBitsPerSecond: 128000 });
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      const stopped = new Promise((r) => { rec.onstop = r; });

      const closing = opts.chiusura ? CLOSING : 0;
      const total = segs.reduce((a, s) => a + s.dur, 0) + closing;
      let cur = null; let musicFaded = false;
      const tl0 = performance.now();
      running = true;
      const loop = () => {
        if (!running) return;
        const tl = (performance.now() - tl0) / 1000;
        drawFrame(ctx, W, H, cur, tl, total);
        setProg(tl / total);
        if (musicGain && !musicFaded && tl > total - 1.6) { musicFaded = true; musicGain.gain.setTargetAtTime(0, ac.currentTime, 0.45); }
        requestAnimationFrame(loop);
      };
      cur = segs[0].v ? { seg: segs[0], i: 0, v: segs[0].v, t0: performance.now(), last: segs.length === 1 } : { seg: segs[0], i: 0, t0: performance.now(), last: segs.length === 1 };
      drawFrame(ctx, W, H, cur, 0, total);
      rec.start(1000);
      requestAnimationFrame(loop);
      if (musicEl) musicEl.play().catch(() => {});
      setStatus('Sto montando… tieni Cicciopasticcio aperto su questa schermata fino alla fine.');

      for (let i = 0; i < segs.length && !abortFlag; i++) {
        const s = segs[i];
        cur = { seg: s, i, v: s.v, t0: performance.now(), last: i === segs.length - 1 };
        if (s.v) {
          if (s.gain) s.gain.gain.setTargetAtTime(origVol, ac.currentTime, 0.04);
          try { await s.v.play(); } catch (_) { s.v.muted = true; await s.v.play().catch(() => {}); }
          const t0 = performance.now();
          let ducked = false;
          while (!abortFlag) {
            const local = s.v.currentTime - s.start;
            if (s.gain && !ducked && local > s.dur - 0.15) { ducked = true; s.gain.gain.setTargetAtTime(0, ac.currentTime, 0.04); }
            if (local >= s.dur || s.v.ended || (performance.now() - t0) / 1000 > s.dur + 2.5) break;
            await sleep(15);
          }
          s.v.pause();
          if (s.gain) s.gain.gain.setValueAtTime(0, ac.currentTime);
        } else {
          await sleep(s.dur * 1000);
        }
      }
      if (closing && !abortFlag) { cur = { closing: true, t0: performance.now() }; await sleep(closing * 1000); }
      await sleep(120);
      running = false;
      rec.stop();
      await stopped;
      if (abortFlag) { setStatus('Montaggio interrotto.'); setProg(0); return; }

      const type = mime.split(';')[0];
      const blob = new Blob(chunks, { type });
      const ext = type === 'video/mp4' ? 'mp4' : 'webm';
      const url = URL.createObjectURL(blob);
      result = { blob, url, mime: type, ext, publicUrl: null };
      const v = $('vd-video'); v.src = url; v.classList.remove('hidden'); c.classList.add('hidden');
      const d = new Date();
      const name = `dandy-video-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}.${ext}`;
      const dl = $('vd-dl'); dl.href = url; dl.download = name; dl.classList.remove('hidden');
      setProg(1);
      const mb = (blob.size / 1048576).toLocaleString('it-IT', { maximumFractionDigits: 1 });
      if (deps.ricorda) deps.ricorda(`FATTO: montato un video di ${sec(total)} (${FORMATS[opts.formato][0]}, ${segs.length} pezzi${opts.titolo ? `, scritta «${opts.titolo}»` : ''})`);
      if (!picked.ig) {
        setStatus(`Video pronto (${mb} MB): puoi scaricarlo. Questo browser però non lo salva nel formato che vuole Instagram (MP4 H.264): per pubblicarlo da qui usa Chrome aggiornato o l'iPhone.`);
        return;
      }
      if (blob.size > MAX_UPLOAD) {
        setStatus(`Video pronto (${mb} MB): puoi scaricarlo, ma è troppo pesante da caricare per Instagram (massimo 48 MB). Accorcialo o togli «Alta qualità».`);
        return;
      }
      setStatus(`Video pronto (${mb} MB). Lo preparo per Instagram…`);
      try {
        result.publicUrl = await uploadVideo(blob, type, (p) => setStatus(`Video pronto (${mb} MB). Lo preparo per Instagram… ${Math.round(p * 100)}%`));
        if (deps.onVideo) deps.onVideo(result.publicUrl);
        $('vd-ig').classList.remove('hidden');
        setStatus(`Video pronto (${mb} MB). Puoi scaricarlo o dire «pubblicalo su Instagram»: prima di pubblicare ti chiedo conferma.`);
      } catch (e) {
        setStatus(`Video pronto (${mb} MB): puoi scaricarlo. Non sono riuscito a prepararlo per Instagram (${e.message}).`);
      }
    } catch (e) {
      setStatus(`Il montaggio non è riuscito: ${e.message}. Prova con meno clip o togli «Alta qualità».`);
    } finally {
      running = false;
      try { if (rec && rec.state !== 'inactive') rec.stop(); } catch (_) { /* ignore */ }
      for (const v of videos) { try { v.pause(); v.removeAttribute('src'); v.load(); } catch (_) { /* ignore */ } }
      if (musicEl) { try { musicEl.pause(); } catch (_) { /* ignore */ } }
      if (ac) ac.close().catch(() => {});
      holder.remove();
      rendering = false;
      $('vd-go').disabled = false; $('vd-stop').classList.add('hidden');
      $('vd-go').textContent = result ? 'Rimonta il video' : 'Monta il video';
    }
  }

  function put(url, body, headers, onProg) {
    return new Promise((res, rej) => {
      const x = new XMLHttpRequest();
      x.open('PUT', url);
      for (const [k, v] of Object.entries(headers)) x.setRequestHeader(k, v);
      x.upload.onprogress = (e) => { if (e.lengthComputable) onProg(e.loaded / e.total); };
      x.onload = () => (x.status >= 200 && x.status < 300 ? res() : rej(new Error(`caricamento ${x.status}`)));
      x.onerror = () => rej(new Error('rete non disponibile'));
      x.send(body);
    });
  }

  // Caricamento diretto nello spazio del server (indirizzo firmato valido pochi minuti)
  async function uploadVideo(blob, type, onProg) {
    const j = await deps.req('/video/upload-url', { method: 'POST', body: { mime: type } });
    const fd = new FormData();
    fd.append('cacheControl', '3600');
    fd.append('', blob, `video.${type === 'video/mp4' ? 'mp4' : 'webm'}`);
    try {
      await put(j.signed_url, fd, { 'x-upsert': 'false' }, onProg);
    } catch (e) {
      if (/rete/.test(e.message)) throw e;
      await put(j.signed_url, blob, { 'x-upsert': 'true', 'content-type': type, 'cache-control': 'max-age=3600' }, onProg);
    }
    return j.public_url;
  }

  // ---------- apertura ----------
  function open(settings) {
    build();
    const hadVideo = !!result;
    let changed = false;
    if (settings && !rendering && settings.nuovo) {
      // video nuovo: si riparte dalle impostazioni normali (le clip già scelte restano, si possono togliere)
      for (const k of Object.keys(DEF)) if (k !== 'hq' && opts[k] !== DEF[k]) { opts[k] = DEF[k]; changed = true; }
    }
    if (settings && !rendering) {
      // cambia solo quello che hai chiesto: il resto (scritta, durata, clip…) resta com'era
      for (const k of Object.keys(DEF)) if (settings[k] !== undefined && k !== 'hq' && settings[k] !== opts[k]) { opts[k] = settings[k]; changed = true; }
      opts.durata_sec = clamp(Number(opts.durata_sec) || DEF.durata_sec, 5, 90);
      if (!FORMATS[opts.formato]) opts.formato = 'reel';
      opts.scritta_colore = colore(opts.scritta_colore);
    }
    fillForm(); renderItems(); renderMusic();
    if (changed) invalidate();
    preview();
    document.getElementById('vd').classList.remove('hidden');
    // se il video era già montato e chiedi una modifica a voce, lo rimonta da solo con le clip già scelte
    if (changed && hadVideo && !settings.nuovo && items.length && !rendering) setTimeout(() => { if (!rendering) render(); }, 400);
  }
  function close() { const o = document.getElementById('vd'); if (o) o.classList.add('hidden'); }

  window.CiccioVideo = { init: (d) => { deps = d; }, open, close, _plan: plan, _items: () => items };
})();
