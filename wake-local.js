/* Riconoscimento locale di «Hey Cicciopasticcio»: gira tutto sul dispositivo, prima della parola non esce audio.
   Estrazione delle caratteristiche identica a openWakeWord (melspettrogramma + embedding a 16 kHz, blocchi da 1280 campioni).
   Il punteggio viene da:
   1) la parola insegnata dall'utente nell'app (modello salvato in questo browser, vedi wake-train.js), oppure
   2) un file models/hey_cicciopasticcio.onnx, se presente.
   Senza nessuno dei due resta il riconoscimento di Chrome. */
(function () {
  const ORT_VER = '1.20.1';
  const ORT_CDN = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VER}/dist/`;
  const MODEL_URL = 'models/hey_cicciopasticcio.onnx';
  const LS_MODEL = 'ciccio_wake_model';
  const LS_SENS = 'ciccio_wake_sens';
  const SENS = { alta: 0.35, normale: 0.5, bassa: 0.7 };
  const MIC = { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true };

  const W = {
    available: false,    // c'è un modello con cui dare il punteggio
    engineReady: false,  // melspettrogramma ed embedding caricati
    running: false,
    source: null,        // 'custom' | 'file' | null
    threshold: 0.5,
    patience: 2,         // blocchi consecutivi sopra soglia per attivarsi
    strict: false,       // true mentre Cicciopasticcio parla: serve un «Hey Cicciopasticcio» più netto
    onDetect: null,      // () => void
    onTest: null,        // (score) => void, se impostato sostituisce onDetect (prova nell'addestramento)
    onScore: null,       // (score) => void
    onError: null,       // (msg) => void
    onGesture: null,     // (true) se serve un tocco sulla pagina per avviare l'audio, (false) quando è partito
    lastScore: 0,
    MIC,
  };

  let mel = null, emb = null, ww = null, custom = null;
  let ctx = null, stream = null, node = null, src = null;
  let raw = new Float32Array(0);
  let melBuf = [];
  let feats = [];
  let busy = false, queue = [], lastFire = 0, paused = false, over = 0, warm = 0;
  const WARMUP = 28; // blocchi da scartare dopo l'avvio (circa 2 secondi): il buffer non è ancora pieno di audio vero

  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url; s.async = true;
      s.onload = resolve; s.onerror = () => reject(new Error('script non caricato'));
      document.head.appendChild(s);
    });
  }

  // ---------- modello salvato ----------
  function b64ToF32(s) {
    const bin = atob(s); const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new Float32Array(u.buffer);
  }
  function f32ToB64(a) {
    const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); let s = '';
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function readSaved() {
    try {
      const j = JSON.parse(localStorage.getItem(LS_MODEL) || 'null');
      if (!j || j.v !== 1) return null;
      const w = b64ToF32(j.w);
      if (w.length !== 16 * 96) return null;
      return { w, b: j.b, info: j };
    } catch (_) { return null; }
  }
  W.savedInfo = function () { const m = readSaved(); return m ? m.info : null; };
  W.saveModel = function (m, extra) {
    const j = Object.assign({ v: 1, w: f32ToB64(m.w), b: m.b, created: new Date().toISOString() }, extra || {});
    localStorage.setItem(LS_MODEL, JSON.stringify(j));
  };
  W.deleteModel = function () {
    try { localStorage.removeItem(LS_MODEL); } catch (_) { /* ignore */ }
    if (W.source === 'custom') { custom = null; W.source = ww ? 'file' : null; W.available = !!ww; }
  };
  W.useModel = function (m) { custom = m; W.source = 'custom'; W.available = true; over = 0; };

  W.sensitivity = function (v) {
    if (v) { try { localStorage.setItem(LS_SENS, v); } catch (_) { /* ignore */ } }
    let s = 'normale';
    try { s = localStorage.getItem(LS_SENS) || 'normale'; } catch (_) { /* ignore */ }
    if (!SENS[s]) s = 'normale';
    W.threshold = SENS[s];
    return s;
  };

  // ---------- motore ----------
  W.ensureEngine = async function () {
    if (W.engineReady) return true;
    if (!window.ort) await loadScript(`${ORT_CDN}ort.min.js`);
    ort.env.wasm.wasmPaths = ORT_CDN;
    ort.env.wasm.numThreads = 1;
    const opt = { executionProviders: ['wasm'] };
    [mel, emb] = await Promise.all([
      ort.InferenceSession.create('models/melspectrogram.onnx', opt),
      ort.InferenceSession.create('models/embedding_model.onnx', opt),
    ]);
    W.engineReady = true;
    return true;
  };

  W.init = async function () {
    W.sensitivity();
    try {
      const saved = readSaved();
      let hasFile = false;
      if (!saved) {
        const head = await fetch(MODEL_URL, { method: 'HEAD', cache: 'no-store' }).catch(() => null);
        hasFile = !!(head && head.ok);
      }
      if (!saved) { custom = null; if (W.source === 'custom') W.source = ww ? 'file' : null; }
      if (!saved && !hasFile) { W.available = false; W.source = null; return false; }
      await W.ensureEngine();
      if (saved) { W.useModel(saved); return true; }
      ww = await ort.InferenceSession.create(MODEL_URL, { executionProviders: ['wasm'] });
      W.source = 'file'; W.available = true;
      return true;
    } catch (e) {
      console.warn('[wake-local] non disponibile:', e);
      W.available = false;
      return false;
    }
  };

  function scoreCustom(input) {
    let z = custom.b;
    const w = custom.w;
    for (let i = 0; i < w.length; i++) z += w[i] * input[i];
    return 1 / (1 + Math.exp(-z));
  }
  W.scoreWindow = (input) => scoreCustom(input);

  function reset() {
    raw = new Float32Array(0);
    melBuf = [];
    for (let i = 0; i < 76; i++) melBuf.push(new Float32Array(32).fill(1));
    feats = [];
    queue = [];
    over = 0;
    warm = 0;
  }

  async function processChunk(chunk) {
    // chunk: 1280 campioni float [-1,1] -> scala int16 come openWakeWord
    const scaled = new Float32Array(chunk.length);
    for (let i = 0; i < chunk.length; i++) {
      const v = Math.max(-1, Math.min(1, chunk[i]));
      scaled[i] = Math.round(v * 32767);
    }
    const joined = new Float32Array(raw.length + scaled.length);
    joined.set(raw); joined.set(scaled, raw.length);
    raw = joined.length > 1760 ? joined.slice(joined.length - 1760) : joined;

    // melspettrogramma sugli ultimi 1760 campioni (1280 + 3*160)
    const melOut = await mel.run({ [mel.inputNames[0]]: new ort.Tensor('float32', raw, [1, raw.length]) });
    const m = melOut[mel.outputNames[0]];
    const frames = m.dims[m.dims.length - 2];
    for (let f = 0; f < frames; f++) {
      const row = new Float32Array(32);
      for (let j = 0; j < 32; j++) row[j] = m.data[f * 32 + j] / 10 + 2;
      melBuf.push(row);
    }
    if (melBuf.length > 970) melBuf.splice(0, melBuf.length - 970);

    // embedding dagli ultimi 76 frame
    const win = new Float32Array(76 * 32);
    const start = melBuf.length - 76;
    for (let r = 0; r < 76; r++) win.set(melBuf[start + r], r * 32);
    const embOut = await emb.run({ [emb.inputNames[0]]: new ort.Tensor('float32', win, [1, 76, 32, 1]) });
    feats.push(Float32Array.from(embOut[emb.outputNames[0]].data));
    if (feats.length > 16) feats.shift();
    warm++;
    if (feats.length < 16 || warm < WARMUP) return;

    // punteggio sulle ultime 16 finestre
    const input = new Float32Array(16 * 96);
    for (let r = 0; r < 16; r++) input.set(feats[r], r * 96);
    let score;
    if (W.source === 'custom' && custom) score = scoreCustom(input);
    else if (ww) {
      const out = await ww.run({ [ww.inputNames[0]]: new ort.Tensor('float32', input, [1, 16, 96]) });
      score = out[ww.outputNames[0]].data[0];
    } else return;
    W.lastScore = score;
    if (W.onScore) W.onScore(score);
    const thr = W.strict ? Math.min(0.92, W.threshold + 0.2) : W.threshold;
    const pat = W.strict ? W.patience + 1 : W.patience;
    over = score >= thr ? over + 1 : 0;
    if (over >= pat && Date.now() - lastFire > 2000 && !paused) {
      lastFire = Date.now();
      over = 0;
      feats = [];
      W.detectSeq = curSeq;
      if (W.onTest) W.onTest(score);
      else if (W.onDetect) W.onDetect();
    }
  }

  async function pump() {
    if (busy) return;
    busy = true;
    try {
      while (queue.length) {
        const it = queue.shift();
        if (queue.length > 6) queue.splice(0, queue.length - 2); // se resta indietro, salta l'audio vecchio
        curSeq = it.seq;
        await processChunk(it.c);
      }
    } catch (e) {
      console.warn('[wake-local] errore', e);
    } finally {
      busy = false;
    }
  }

  const WORKLET = `
    class Chunker extends AudioWorkletProcessor {
      constructor() { super(); this.buf = new Float32Array(1280); this.n = 0; }
      process(inputs) {
        const ch = inputs[0] && inputs[0][0];
        if (ch) {
          for (let i = 0; i < ch.length; i++) {
            this.buf[this.n++] = ch[i];
            if (this.n === 1280) { this.port.postMessage(this.buf.slice(0)); this.n = 0; }
          }
        }
        return true;
      }
    }
    registerProcessor('ciccio-chunker', Chunker);`;

  // Apre il microfono a 16 kHz e chiama onChunk(Float32Array(1280)) ogni 80 ms
  async function openMic(onChunk) {
    const st = await navigator.mediaDevices.getUserMedia({ audio: MIC });
    const ac = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    await ac.audioWorklet.addModule(url);
    const s = ac.createMediaStreamSource(st);
    const n = new AudioWorkletNode(ac, 'ciccio-chunker');
    n.port.onmessage = (ev) => onChunk(ev.data);
    s.connect(n);
    // Chrome può tenere l'audio in pausa finché non si tocca la pagina: riprova al primo tocco o tasto
    if (ac.state !== 'running') {
      ac.resume().catch(() => {});
      const wake = () => {
        if (ac.state === 'closed') return;
        ac.resume().then(() => {
          if (ac.state === 'running') { off(); if (W.onGesture) W.onGesture(false); }
        }).catch(() => {});
      };
      const off = () => { ['pointerdown', 'keydown', 'touchstart'].forEach((e) => document.removeEventListener(e, wake, true)); };
      ['pointerdown', 'keydown', 'touchstart'].forEach((e) => document.addEventListener(e, wake, true));
      setTimeout(() => { if (ac.state === 'suspended' && W.onGesture) W.onGesture(true); }, 600);
    }
    return {
      close() {
        try { s.disconnect(); } catch (_) { /* ignore */ }
        try { n.disconnect(); } catch (_) { /* ignore */ }
        st.getTracks().forEach((t) => t.stop());
        ac.close().catch(() => {});
      },
    };
  }

  let mic = null;
  W.start = async function () {
    if (!W.available || W.running) return W.running;
    try {
      reset();
      mic = await openMic((c) => {
        const item = { seq: ++seq, c };
        ring.push(item); if (ring.length > 25) ring.shift();      // ultimi 2 secondi, sempre
        if (recorder) recorder.feed(item);
        if (!paused) { queue.push(item); pump(); }
      });
      W.running = true;
      return true;
    } catch (e) {
      W.running = false;
      if (W.onError) W.onError('Microfono non disponibile per la parola di attivazione: consenti il microfono a questa pagina.');
      return false;
    }
  };

  W.stop = function () {
    if (mic) mic.close();
    mic = null;
    W.running = false;
  };

  // In pausa mentre Cicciopasticcio parla o ascolta il comando (evita falsi attivamenti)
  W.pause = function () { paused = true; queue = []; over = 0; };
  W.resume = function () { reset(); paused = false; lastFire = Date.now(); };
  W.isPaused = function () { return paused; };

  // ---------- registrazione della richiesta (dopo «Hey Cicciopasticcio») ----------
  // Parte dall'audio subito dopo la parola (già in memoria), così non si perdono le prime parole,
  // e si ferma da sola quando smetti di parlare.
  let seq = 0, curSeq = 0, ring = [], recorder = null;
  W.detectSeq = 0;
  W.seq = () => seq;
  const rms = (c) => { let x = 0; for (let i = 0; i < c.length; i++) x += c[i] * c[i]; return Math.sqrt(x / c.length); };

  function toWav(chunks) {
    let n = 0; for (const c of chunks) n += c.length;
    const buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const str = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, n * 2, true);
    let o = 44;
    for (const c of chunks) for (let i = 0; i < c.length; i++) { const x = Math.max(-1, Math.min(1, c[i])); v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true); o += 2; }
    return new Blob([buf], { type: 'audio/wav' });
  }

  // opt: fromSeq, noSpeechMs, silenceMs, maxMs -> Promise<{ wav, speech, cancelled }>
  W.record = function (opt) {
    if (recorder) recorder.finish(true);
    opt = Object.assign({ fromSeq: seq + 1, noSpeechMs: 6000, silenceMs: 1000, maxMs: 20000 }, opt || {});
    const BLK = 80;   // ms per blocco
    // rumore di fondo: i blocchi più bassi degli ultimi 2 secondi
    const lv = ring.map((r) => rms(r.c)).sort((a, b) => a - b);
    const floor = lv.length ? lv[Math.floor(lv.length * 0.2)] : 0.005;
    const thr = Math.max(0.012, floor * 2.8);
    return new Promise((resolve) => {
      const chunks = []; let t = 0, speechBlocks = 0, started = false, quiet = 0, done = false;
      const r = {
        feed(item) {
          if (done || item.seq < opt.fromSeq) return;
          chunks.push(item.c); t += BLK;
          const loud = rms(item.c) > thr;
          if (loud) { speechBlocks++; quiet = 0; if (speechBlocks >= 2) started = true; } else { quiet += BLK; }
          if (!started && t >= opt.noSpeechMs) return r.finish(false);
          if (started && quiet >= opt.silenceMs) return r.finish(false);
          if (t >= opt.maxMs) return r.finish(false);
        },
        finish(cancelled) {
          if (done) return; done = true;
          if (recorder === r) recorder = null;
          resolve({ wav: started && !cancelled ? toWav(chunks) : null, speech: started && !cancelled, cancelled: !!cancelled });
        },
      };
      recorder = r;
      // sicurezza: se il microfono non manda audio, non resta in attesa per sempre
      setTimeout(() => r.finish(false), opt.maxMs + 1500);
      setTimeout(() => { if (!done && !chunks.length) r.finish(false); }, opt.noSpeechMs + 1500);
      for (const it of ring) r.feed(it);   // l'audio già sentito dopo la parola
    });
  };
  W.cancelRecord = function () { if (recorder) recorder.finish(true); };
  W.recording = () => !!recorder;

  // ---------- strumenti per l'addestramento ----------
  // Registra dal microfono finché non si chiama stop(); level() dà il volume dell'ultimo blocco
  W.capture = async function () {
    const parts = []; let n = 0, lvl = 0;
    const m = await openMic((c) => {
      parts.push(c); n += c.length;
      let s = 0; for (let i = 0; i < c.length; i++) s += c[i] * c[i];
      lvl = Math.sqrt(s / c.length);
    });
    const join = () => {
      const out = new Float32Array(n); let o = 0;
      for (const p of parts) { out.set(p, o); o += p.length; }
      return out;
    };
    return {
      samples: () => n,
      level: () => lvl,
      audio: join,
      stop() {
        m.close();
        const out = new Float32Array(n); let o = 0;
        for (const p of parts) { out.set(p, o); o += p.length; }
        return out;
      },
    };
  };

  // Embedding di un audio intero (equivale al calcolo in streaming): uno ogni 1280 campioni
  W.embedAudio = async function (audio, onProgress) {
    await W.ensureEngine();
    const nChunks = Math.floor(audio.length / 1280);
    if (nChunks < 1) return [];
    const scaled = new Float32Array(nChunks * 1280);
    for (let i = 0; i < scaled.length; i++) scaled[i] = Math.round(Math.max(-1, Math.min(1, audio[i])) * 32767);
    const melOut = await mel.run({ [mel.inputNames[0]]: new ort.Tensor('float32', scaled, [1, scaled.length]) });
    const md = melOut[mel.outputNames[0]].data;
    const frames = Math.floor(md.length / 32);
    const M = new Float32Array((76 + frames) * 32).fill(1);
    for (let i = 0; i < frames * 32; i++) M[76 * 32 + i] = md[i] / 10 + 2;
    const out = [];
    const B = 64;
    for (let k0 = 0; k0 < nChunks; k0 += B) {
      const ks = [];
      for (let k = k0; k < Math.min(nChunks, k0 + B); k++) { if (76 + 8 * k + 5 <= 76 + frames) ks.push(k); }
      if (!ks.length) break;
      const x = new Float32Array(ks.length * 76 * 32);
      ks.forEach((k, j) => { const end = 76 + 8 * k + 5; x.set(M.subarray((end - 76) * 32, end * 32), j * 76 * 32); });
      const r = await emb.run({ [emb.inputNames[0]]: new ort.Tensor('float32', x, [ks.length, 76, 32, 1]) });
      const d = r[emb.outputNames[0]].data;
      ks.forEach((k, j) => out.push(Float32Array.from(d.subarray(j * 96, (j + 1) * 96))));
      if (onProgress) onProgress(Math.min(1, (k0 + B) / nChunks));
      await new Promise((res) => setTimeout(res, 0));
    }
    return out;
  };

  window.CiccioWakeLocal = W;
})();
