/* Riconoscimento locale di «Hey Cicciopasticcio» (openWakeWord, gira tutto sul dispositivo).
   Si attiva solo se esiste models/hey_cicciopasticcio.onnx; altrimenti resta il riconoscimento di Chrome.
   Pipeline identica a openWakeWord: blocchi da 1280 campioni a 16 kHz -> melspettrogramma -> embedding -> modello. */
(function () {
  const ORT_VER = '1.20.1';
  const ORT_CDN = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VER}/dist/`;
  const MODEL_URL = 'models/hey_cicciopasticcio.onnx';

  const W = {
    available: false,   // modello presente e caricato
    running: false,
    threshold: 0.5,
    onDetect: null,      // () => void
    onError: null,       // (msg) => void
    lastScore: 0,
  };

  let mel = null, emb = null, ww = null;
  let ctx = null, stream = null, node = null, src = null;
  let raw = new Float32Array(0);
  let melBuf = [];
  let feats = [];
  let busy = false, queue = [], lastFire = 0, paused = false;

  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url; s.async = true;
      s.onload = resolve; s.onerror = () => reject(new Error('script non caricato'));
      document.head.appendChild(s);
    });
  }

  W.init = async function () {
    try {
      const head = await fetch(MODEL_URL, { method: 'HEAD', cache: 'no-store' });
      if (!head.ok) return false;
      if (!window.ort) await loadScript(`${ORT_CDN}ort.min.js`);
      ort.env.wasm.wasmPaths = ORT_CDN;
      ort.env.wasm.numThreads = 1;
      const opt = { executionProviders: ['wasm'] };
      [mel, emb, ww] = await Promise.all([
        ort.InferenceSession.create('models/melspectrogram.onnx', opt),
        ort.InferenceSession.create('models/embedding_model.onnx', opt),
        ort.InferenceSession.create(MODEL_URL, opt),
      ]);
      W.available = true;
      return true;
    } catch (e) {
      console.warn('[wake-local] non disponibile:', e);
      W.available = false;
      return false;
    }
  };

  function reset() {
    raw = new Float32Array(0);
    melBuf = [];
    for (let i = 0; i < 76; i++) melBuf.push(new Float32Array(32).fill(1));
    feats = [];
    queue = [];
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
    if (feats.length < 16) return;

    // punteggio del modello sulle ultime 16 finestre
    const input = new Float32Array(16 * 96);
    for (let r = 0; r < 16; r++) input.set(feats[r], r * 96);
    const out = await ww.run({ [ww.inputNames[0]]: new ort.Tensor('float32', input, [1, 16, 96]) });
    const score = out[ww.outputNames[0]].data[0];
    W.lastScore = score;
    if (score >= W.threshold && Date.now() - lastFire > 2000 && !paused) {
      lastFire = Date.now();
      feats = [];
      if (W.onDetect) W.onDetect();
    }
  }

  async function pump() {
    if (busy) return;
    busy = true;
    try {
      while (queue.length) {
        const c = queue.shift();
        if (queue.length > 6) queue.splice(0, queue.length - 2); // se resta indietro, salta l'audio vecchio
        await processChunk(c);
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

  W.start = async function () {
    if (!W.available || W.running) return W.running;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
      await ctx.audioWorklet.addModule(url);
      src = ctx.createMediaStreamSource(stream);
      node = new AudioWorkletNode(ctx, 'ciccio-chunker');
      node.port.onmessage = (ev) => { if (!paused) { queue.push(ev.data); pump(); } };
      src.connect(node);
      reset();
      W.running = true;
      return true;
    } catch (e) {
      W.running = false;
      if (W.onError) W.onError('Microfono non disponibile per la parola di attivazione: consenti il microfono a questa pagina.');
      return false;
    }
  };

  W.stop = function () {
    try { if (src) src.disconnect(); } catch (_) { /* ignore */ }
    try { if (node) node.disconnect(); } catch (_) { /* ignore */ }
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (ctx) ctx.close().catch(() => {});
    ctx = stream = node = src = null;
    W.running = false;
  };

  // In pausa mentre Cicciopasticcio parla o ascolta il comando (evita falsi attivamenti)
  W.pause = function () { paused = true; queue = []; };
  W.resume = function () { paused = false; feats = []; lastFire = Date.now(); };

  window.CiccioWakeLocal = W;
})();
