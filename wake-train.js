/* «Insegna la parola»: Andrea dice «Hey Cicciopasticcio» una ventina di volte e parla normalmente per un minuto;
   l'app impara la sua voce e crea il modello sul dispositivo (niente esce dal Chromebook).
   Modello: regressione logistica sulle ultime 16 finestre di embedding di openWakeWord (16 x 96 valori). */
(function () {
  const SR = 16000, HOP = 1280, WIN = 16, DIM = WIN * 96;
  const T = {};

  // ---------- audio ----------
  function frameRms(a, s, e, fr) {
    const n = Math.max(0, Math.floor((e - s) / fr)); const r = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let q = 0; const o = s + i * fr;
      for (let j = 0; j < fr; j++) { const v = a[o + j] || 0; q += v * v; }
      r[i] = Math.sqrt(q / fr);
    }
    return r;
  }
  function pct(arr, p) {
    if (!arr.length) return 0;
    const s = Array.from(arr).sort((x, y) => x - y);
    return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
  }
  // Inizio e fine del parlato tra s ed e (campioni); null se non c'è parlato
  T.speechSpan = function (a, s, e, floorRef) {
    s = Math.max(0, s); e = Math.min(a.length, e);
    const fr = 320; const r = frameRms(a, s, e, fr);
    let floor = pct(r, 0.1);
    if (floorRef) floor = Math.min(floor, floorRef);
    const th = Math.max(floor * 4, 0.008);
    let first = -1, last = -1;
    for (let i = 0; i + 2 < r.length; i++) { if (r[i] > th && r[i + 1] > th && r[i + 2] > th) { first = i; break; } }
    if (first < 0) return null;
    for (let i = r.length - 1; i > first; i--) { if (r[i] > th && r[i - 1] > th) { last = i; break; } }
    if (last < 0) last = first + 2;
    return { s: s + first * fr, e: s + (last + 1) * fr, th };
  };
  T.speechRatio = function (a, s, e, floorRef) {
    const r = frameRms(a, s, e, 320); const th = Math.max((floorRef || pct(r, 0.1)) * 4, 0.008);
    let k = 0; for (const v of r) if (v > th) k++;
    return r.length ? k / r.length : 0;
  };

  function rng(seed) { let x = seed >>> 0 || 1; return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; }; }
  // Variante dell'audio: velocità, volume e rumore di fondo preso dal parlato normale
  T.augment = function (a, v, noise, rand) {
    let b = a;
    if (v.speed !== 1) {
      const n = Math.floor(a.length / v.speed); b = new Float32Array(n);
      for (let i = 0; i < n; i++) { const x = i * v.speed; const i0 = Math.floor(x); const f = x - i0; b[i] = (a[i0] || 0) * (1 - f) + (a[i0 + 1] || 0) * f; }
    } else b = Float32Array.from(a);
    let ps = 0; for (let i = 0; i < b.length; i++) { b[i] *= v.gain; ps += b[i] * b[i]; }
    if (v.snr != null && noise && noise.length > SR) {
      let pn = 0; for (let i = 0; i < noise.length; i++) pn += noise[i] * noise[i];
      ps /= b.length; pn = pn / noise.length + 1e-9;
      const k = Math.sqrt(ps / pn / Math.pow(10, v.snr / 10)) * 0.5;
      let o = Math.floor(rand() * noise.length);
      for (let i = 0; i < b.length; i++) { b[i] += noise[o] * k; o++; if (o >= noise.length) o = 0; }
    }
    for (let i = 0; i < b.length; i++) b[i] = Math.max(-1, Math.min(1, b[i]));
    return b;
  };
  T.VARIANTS = [
    { speed: 1, gain: 1, snr: null },
    { speed: 1, gain: 0.6, snr: 10 },
    { speed: 0.94, gain: 1.2, snr: 15 },
    { speed: 1.06, gain: 0.8, snr: 6 },
  ];

  // ---------- esempi ----------
  function windowAt(E, k, out, off) { for (let r = 0; r < WIN; r++) out.set(E[k - WIN + 1 + r], off + r * 96); }
  // etichette: 1 = parola appena finita, 0 = non è la parola, -1 = da ignorare (parola a metà)
  T.labelFor = function (t, spans) {
    let lab = 0;
    for (const sp of spans) {
      if (t >= sp.e && t <= sp.e + 0.4 * SR) return 1;
      if (t >= sp.s && t < sp.e + 1.0 * SR) lab = -1;
    }
    return lab;
  };

  // Raccoglie gli esempi da un elenco di sorgenti {E, spans, exclude, neg}
  T.collect = function (sources) {
    let n = 0;
    const keep = sources.map((src) => {
      const ks = [];
      for (let k = WIN - 1; k < src.E.length; k++) {
        const t = (k + 1) * HOP;
        if (src.exclude && src.exclude.some((x) => t >= x.s - 0.5 * SR && t <= x.e + 1.5 * SR)) continue;
        const y = src.neg ? 0 : T.labelFor(t, src.spans);
        if (y >= 0) ks.push([k, y]);
      }
      n += ks.length;
      return ks;
    });
    const X = new Float32Array(n * DIM); const Y = new Float32Array(n);
    let i = 0;
    sources.forEach((src, si) => { for (const [k, y] of keep[si]) { windowAt(src.E, k, X, i * DIM); Y[i] = y; i++; } });
    return { X, Y, n };
  };

  // ---------- addestramento: regressione logistica con Adam ----------
  T.fit = async function (data, opt) {
    opt = Object.assign({ epochs: 300, lr: 0.05, l2: 0.05 }, opt || {});
    const { X, Y, n } = data; const d = DIM;
    const mu = new Float32Array(d), sd = new Float32Array(d);
    for (let i = 0; i < n; i++) for (let j = 0; j < d; j++) mu[j] += X[i * d + j];
    for (let j = 0; j < d; j++) mu[j] /= n;
    for (let i = 0; i < n; i++) for (let j = 0; j < d; j++) { const v = X[i * d + j] - mu[j]; sd[j] += v * v; }
    for (let j = 0; j < d; j++) sd[j] = Math.sqrt(sd[j] / n) + 1e-3;
    const Z = new Float32Array(n * d);
    for (let i = 0; i < n; i++) for (let j = 0; j < d; j++) Z[i * d + j] = (X[i * d + j] - mu[j]) / sd[j];
    let pos = 0; for (let i = 0; i < n; i++) pos += Y[i];
    const wp = (n - pos) / Math.max(pos, 1);
    const sw = new Float32Array(n); let m0 = 0;
    for (let i = 0; i < n; i++) { sw[i] = Y[i] > 0 ? wp : 1; m0 += sw[i]; }
    for (let i = 0; i < n; i++) sw[i] /= m0 / n;
    const w = new Float32Array(d), m = new Float32Array(d), v = new Float32Array(d), gw = new Float32Array(d), g = new Float32Array(n);
    let b = 0, mb = 0, vb = 0; const b1 = 0.9, b2 = 0.999;
    for (let t = 1; t <= opt.epochs; t++) {
      gw.fill(0); let gb = 0;
      for (let i = 0; i < n; i++) {
        let z = b; const o = i * d;
        for (let j = 0; j < d; j++) z += w[j] * Z[o + j];
        const p = 1 / (1 + Math.exp(-z));
        g[i] = (p - Y[i]) * sw[i]; gb += g[i];
      }
      for (let i = 0; i < n; i++) { const gi = g[i]; if (gi === 0) continue; const o = i * d; for (let j = 0; j < d; j++) gw[j] += gi * Z[o + j]; }
      gb /= n;
      const c1 = 1 - Math.pow(b1, t), c2 = 1 - Math.pow(b2, t);
      for (let j = 0; j < d; j++) {
        const gj = gw[j] / n + opt.l2 * w[j];
        m[j] = b1 * m[j] + (1 - b1) * gj; v[j] = b2 * v[j] + (1 - b2) * gj * gj;
        w[j] -= opt.lr * (m[j] / c1) / (Math.sqrt(v[j] / c2) + 1e-8);
      }
      mb = b1 * mb + (1 - b1) * gb; vb = b2 * vb + (1 - b2) * gb * gb;
      b -= opt.lr * (mb / c1) / (Math.sqrt(vb / c2) + 1e-8);
      if (t % 10 === 0) { if (opt.onProgress) opt.onProgress(t / opt.epochs); await new Promise((r) => setTimeout(r, 0)); }
    }
    // normalizzazione dentro i pesi: punteggio = sigmoide(w·x + b) sui valori grezzi
    const wf = new Float32Array(d); let bf = b;
    for (let j = 0; j < d; j++) { wf[j] = w[j] / sd[j]; bf -= w[j] * mu[j] / sd[j]; }
    return { w: wf, b: bf };
  };

  T.scores = function (model, E) {
    const out = new Float32Array(E.length); const x = new Float32Array(DIM);
    for (let k = WIN - 1; k < E.length; k++) {
      windowAt(E, k, x, 0);
      let z = model.b; for (let j = 0; j < DIM; j++) z += model.w[j] * x[j];
      out[k] = 1 / (1 + Math.exp(-z));
    }
    return out;
  };
  // attivazioni come nell'uso reale: 2 blocchi consecutivi sopra soglia, poi 2 secondi di pausa
  T.triggers = function (sc, thr, patience) {
    const hits = []; let over = 0, last = -1e9;
    for (let k = 0; k < sc.length; k++) {
      over = sc[k] >= thr ? over + 1 : 0;
      if (over >= (patience || 2) && k - last > 25) { hits.push(k); last = k; over = 0; }
    }
    return hits;
  };

  // Tutto il lavoro dopo la registrazione. rec = {audio, posEnd, negStart, negEnd, spans, floor}
  T.build = async function (rec, embed, onProgress) {
    const prog = (a, b) => (x) => onProgress && onProgress(a + (b - a) * x);
    const rand = rng(12345);
    const posAudio = rec.audio.subarray(0, rec.posEnd);
    const negAudio = rec.audio.subarray(rec.negStart, rec.negEnd);
    const negSplit = Math.floor(negAudio.length * 0.7);
    const spans = rec.spans;
    const hold = spans.filter((_, i) => i % 5 === 2);
    // caratteristiche
    const posE = [];
    for (let i = 0; i < T.VARIANTS.length; i++) {
      const v = T.VARIANTS[i];
      const a = T.augment(posAudio, v, negAudio, rand);
      const E = await embed(a, prog(0.05 + i * 0.12, 0.17 + i * 0.12));
      posE.push({ E, spans: spans.map((s) => ({ s: Math.round(s.s / v.speed), e: Math.round(s.e / v.speed) })), v });
    }
    const negE = await embed(negAudio, prog(0.53, 0.6));
    const negTrainE = negE.slice(0, Math.floor(negSplit / HOP));
    const negEvalE = negE.slice(Math.max(0, Math.floor(negSplit / HOP) - WIN));
    // 1) modello di controllo: senza 4 prove e senza l'ultimo pezzo di parlato, per misurare come va
    const dA = T.collect([
      ...posE.map((p) => ({ E: p.E, spans: p.spans, exclude: hold.map((h) => ({ s: Math.round(h.s / p.v.speed), e: Math.round(h.e / p.v.speed) })) })),
      { E: negTrainE, neg: true },
    ]);
    const A = await T.fit(dA, { onProgress: prog(0.6, 0.78) });
    const sc = T.scores(A, posE[0].E);
    const holdHit = hold.map((h) => {
      let best = 0, over = 0, hit = false;
      for (let k = WIN - 1; k < sc.length; k++) {
        const t = (k + 1) * HOP;
        if (t < h.e - 0.2 * SR || t > h.e + 1.0 * SR) continue;
        best = Math.max(best, sc[k]);
        over = sc[k] >= 0.5 ? over + 1 : 0; if (over >= 2) hit = true;
      }
      return { hit, best };
    });
    const falseAlarms = T.triggers(T.scores(A, negEvalE), 0.5, 2).length;
    // 2) modello finale con tutto
    const dB = T.collect([...posE.map((p) => ({ E: p.E, spans: p.spans })), { E: negE, neg: true }]);
    const B = await T.fit(dB, { onProgress: prog(0.78, 1) });
    return {
      model: B,
      report: {
        takes: spans.length,
        holdTotal: hold.length,
        holdHit: holdHit.filter((h) => h.hit).length,
        holdBest: holdHit.map((h) => Math.round(h.best * 100) / 100),
        falseAlarms,
        evalSeconds: Math.round((negAudio.length - negSplit) / SR),
        examples: dB.n,
      },
    };
  };

  window.CiccioTrainer = T;
})();

/* ---------- procedura guidata ---------- */
(function () {
  const SR = 16000;
  const TAKES = 20, MAX_TRIES = 32, SLOT = 2.5, PAUSE = 1.0, SILENCE = 4, NEG_SEC = 60, NEG_MIN = 40;
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let hooks = {}, cap = null, meterTimer = null, aborted = false, model = null, report = null, saved = false;

  function card() { return $('teach-card'); }
  function show(html) { card().innerHTML = html; }
  function meter() {
    clearInterval(meterTimer);
    meterTimer = setInterval(() => {
      const el = $('t-meter'); if (!el) return;
      let v = 0;
      if (cap) v = cap.level();
      else if (window.CiccioWakeLocal.running) v = window.CiccioWakeLocal.lastScore;
      el.style.width = `${Math.min(100, Math.round((cap ? v * 900 : v * 100)))}%`;
    }, 80);
  }
  function bindCancel() { const b = $('t-cancel'); if (b) b.onclick = () => close(false); }

  async function close(keep) {
    aborted = true;
    clearInterval(meterTimer);
    const W = window.CiccioWakeLocal;
    W.onTest = null; W.onScore = null;
    if (cap) { try { cap.stop(); } catch (_) { /* ignore */ } cap = null; }
    W.stop();
    if (keep && model) {
      W.saveModel(model, { report });
      saved = true;
    }
    await W.init();
    $('teach').classList.add('hidden');
    if (hooks.onEnd) hooks.onEnd(saved);
  }

  function intro() {
    show(`
      <h1>INSEGNA LA PAROLA</h1>
      <p>Cicciopasticcio imparerà a riconoscere <b>«Hey Cicciopasticcio»</b> con la voce di chi lo userà.
      Tutto resta su questo Chromebook.</p>
      <ol class="t-steps">
        <li><b>5 secondi di silenzio</b></li>
        <li><b>Dire «Hey Cicciopasticcio» 20 volte</b>, quando compare la scritta</li>
        <li><b>Parlare normalmente per un minuto</b> (o lasciare la TV accesa)</li>
      </ol>
      <p class="muted">Fallo nella stanza dove lo userete, alla distanza di sempre dal Chromebook. Servono circa 5 minuti.</p>
      <div class="t-btns"><button class="mini-btn" id="t-cancel">Annulla</button><button class="mini-btn primary" id="t-go">Inizia</button></div>`);
    bindCancel();
    $('t-go').onclick = run;
  }

  async function run() {
    aborted = false; model = null; report = null;
    const W = window.CiccioWakeLocal, T = window.CiccioTrainer;
    show('<h1>UN ATTIMO…</h1><p>Preparo il riconoscimento (la prima volta può volerci mezzo minuto).</p><div class="t-btns"><button class="mini-btn" id="t-cancel">Annulla</button></div>');
    bindCancel();
    try { await W.ensureEngine(); } catch (e) { return fail('Non riesco a scaricare i componenti del riconoscimento. Controlla la connessione e riprova.'); }
    if (aborted) return;
    try { cap = await W.capture(); } catch (e) { return fail('Microfono non disponibile: consenti il microfono a questa pagina (icona a sinistra dell\'indirizzo) e riprova.'); }
    meter();

    // 1) silenzio
    for (let s = SILENCE; s > 0; s--) {
      if (aborted) return;
      show(`<h1>SILENZIO</h1><p class="t-big">Resta in silenzio…</p><p class="muted">${s}</p><div class="t-meter"><span id="t-meter"></span></div><div class="t-btns"><button class="mini-btn" id="t-cancel">Annulla</button></div>`);
      bindCancel(); await sleep(1000);
    }
    const sil = cap.audio();
    const floor = Math.max(0.0005, (() => { const r = []; for (let i = 0; i + 320 <= sil.length; i += 320) { let q = 0; for (let j = 0; j < 320; j++) q += sil[i + j] * sil[i + j]; r.push(Math.sqrt(q / 320)); } r.sort((a, b) => a - b); return r[Math.floor(r.length * 0.5)] || 0.001; })());

    // 2) la parola
    const spans = []; let tries = 0, msg = '';
    for (let c = 3; c > 0; c--) {
      if (aborted) return;
      show(`<h1>PRONTI?</h1><p>Quando compare <b>«Ora!»</b> di' <b>«Hey Cicciopasticcio»</b> come faresti di solito.
        Ogni tanto varia: più piano, più forte, un po' più lontano.</p><p class="t-big">${c}</p><div class="t-btns"><button class="mini-btn" id="t-cancel">Annulla</button></div>`);
      bindCancel(); await sleep(1000);
    }
    while (spans.length < TAKES && tries < MAX_TRIES) {
      if (aborted) return;
      tries++;
      const start = cap.samples();
      show(`<h1>PROVA ${spans.length + 1} DI ${TAKES}</h1><p class="t-big t-now">Ora! «Hey Cicciopasticcio»</p>
        <div class="t-meter"><span id="t-meter"></span></div><p class="muted t-msg">${esc(msg)}</p>
        <div class="t-dots">${Array.from({ length: TAKES }, (_, i) => `<i class="${i < spans.length ? 'on' : ''}"></i>`).join('')}</div>
        <div class="t-btns"><button class="mini-btn" id="t-cancel">Annulla</button></div>`);
      bindCancel();
      await sleep(SLOT * 1000);
      if (aborted) return;
      const p = card().querySelector('.t-now'); if (p) { p.textContent = '…'; p.classList.remove('t-now'); }
      await sleep(PAUSE * 1000);
      if (aborted) return;
      const a = cap.audio();
      const s0 = Math.max(0, start - 0.2 * SR), e0 = start + (SLOT + PAUSE) * SR;
      const sp = T.speechSpan(a, s0, e0, floor * 1.5);
      const dur = sp ? (sp.e - sp.s) / SR : 0;
      if (!sp || dur < 0.4) msg = 'Non ho sentito bene: ripeti un po\' più forte.';
      else if (dur > 2.8 || sp.e > e0 - 0.05 * SR) msg = 'Troppo lungo o tagliato: di\' solo la frase, appena compare «Ora!».';
      else { spans.push(sp); msg = ''; }
    }
    if (spans.length < 12) return fail('Non riesco a sentire bene la frase. Avvicinati al Chromebook, controlla che il microfono sia quello giusto e riprova.');
    const posEnd = cap.samples();

    // 3) parlato normale
    const negStart = cap.samples();
    let next = false;
    for (let s = 0; s < NEG_SEC && !next; s++) {
      if (aborted) return;
      const left = NEG_SEC - s;
      show(`<h1>ORA PARLA NORMALMENTE</h1>
        <p>Per un minuto parla di quello che vuoi: racconta la giornata, leggi una notizia ad alta voce, oppure accendi la TV.
        Ogni tanto di' anche solo <b>«ciccio»</b> o <b>«pasticcio»</b> da soli, ma <b>mai la frase intera</b>.</p>
        <div class="t-meter"><span id="t-meter"></span></div>
        <div class="t-bar"><span style="width:${Math.round((s / NEG_SEC) * 100)}%"></span></div>
        <p class="muted">Ancora ${left} secondi</p>
        <div class="t-btns"><button class="mini-btn" id="t-cancel">Annulla</button>${s >= NEG_MIN ? '<button class="mini-btn primary" id="t-next">Ho finito</button>' : ''}</div>`);
      bindCancel();
      const nb = $('t-next'); if (nb) nb.onclick = () => { next = true; };
      for (let k = 0; k < 10 && !next; k++) await sleep(100);
    }
    if (aborted) return;
    const audio = cap.stop(); cap = null;
    const negEnd = audio.length;
    const talk = T.speechRatio(audio, negStart, negEnd, floor * 1.5);

    // 4) impara
    show('<h1>STO IMPARANDO…</h1><p>Ci vuole circa un minuto. Non chiudere la pagina.</p><div class="t-bar"><span id="t-prog" style="width:0%"></span></div><p class="muted" id="t-pct">0%</p>');
    try {
      const res = await T.build({ audio, posEnd, negStart, negEnd, spans, floor }, W.embedAudio, (x) => {
        const el = $('t-prog'); if (el) el.style.width = `${Math.round(x * 100)}%`;
        const t = $('t-pct'); if (t) t.textContent = `${Math.round(x * 100)}%`;
      });
      model = res.model; report = Object.assign(res.report, { talk: Math.round(talk * 100) / 100 });
    } catch (e) {
      console.error(e);
      return fail('Qualcosa è andato storto mentre imparavo. Riprova.');
    }
    if (aborted) return;
    result(talk);
  }

  function result(talk) {
    const W = window.CiccioWakeLocal;
    const r = report;
    let verdict, cls;
    if (r.holdHit >= r.holdTotal - 1 && r.falseAlarms === 0) { verdict = 'Ottimo, è venuto bene.'; cls = 'ok'; }
    else if (r.holdHit >= Math.ceil(r.holdTotal / 2) && r.falseAlarms <= 1) { verdict = 'Discreto. Se si attiva per sbaglio, metti la sensibilità su «Bassa»; se fatica a rispondere, su «Alta».'; cls = 'mid'; }
    else { verdict = 'Non è venuto molto bene: ti consiglio di rifarlo in una stanza più silenziosa, alla distanza di sempre.'; cls = 'bad'; }
    const lowTalk = talk < 0.08 ? '<p class="muted">Nell\'ultimo passo ho sentito poco parlato: se si attiva per sbaglio, rifallo parlando di più.</p>' : '';
    show(`
      <h1>FATTO</h1>
      <p class="t-verdict ${cls}">${verdict}</p>
      <p class="muted">Riconosciuta in ${r.holdHit} prove su ${r.holdTotal} di controllo · Attivazioni per sbaglio nel parlato: ${r.falseAlarms}</p>
      ${lowTalk}
      <div class="t-test" id="t-test">
        <p><b>Prova adesso:</b> di' «Hey Cicciopasticcio».</p>
        <div class="t-meter"><span id="t-meter"></span></div>
        <p class="t-heard" id="t-heard">In ascolto…</p>
      </div>
      <div class="t-btns"><button class="mini-btn" id="t-cancel">Annulla</button><button class="mini-btn" id="t-redo">Rifai</button><button class="mini-btn primary" id="t-save">Salva e usa</button></div>`);
    bindCancel();
    $('t-redo').onclick = async () => { W.onTest = null; W.stop(); intro(); };
    $('t-save').onclick = () => close(true);
    let n = 0;
    W.useModel(model);
    W.onTest = () => {
      n++;
      const h = $('t-heard'); if (!h) return;
      h.textContent = n === 1 ? '✓ Sentita!' : `✓ Sentita! (${n} volte)`;
      h.classList.remove('flash'); void h.offsetWidth; h.classList.add('flash');
    };
    W.start().then((ok) => { if (!ok) { const h = $('t-heard'); if (h) h.textContent = 'Microfono non disponibile per la prova.'; } else W.resume(); });
    meter();
  }

  function fail(msg) {
    clearInterval(meterTimer);
    if (cap) { try { cap.stop(); } catch (_) { /* ignore */ } cap = null; }
    show(`<h1>OPS</h1><p>${esc(msg)}</p><div class="t-btns"><button class="mini-btn" id="t-cancel">Chiudi</button><button class="mini-btn primary" id="t-retry">Riprova</button></div>`);
    bindCancel();
    $('t-retry').onclick = intro;
  }

  window.CiccioTeach = {
    open(h) {
      hooks = h || {}; saved = false; aborted = false;
      if (hooks.onBegin) hooks.onBegin();
      $('teach').classList.remove('hidden');
      intro();
    },
  };
})();
