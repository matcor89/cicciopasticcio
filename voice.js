/* Voce di Cicciopasticcio: ascolto, parola di attivazione e lettura delle risposte.
   La richiesta viene ascoltata finché non fai una pausa (non si ferma al primo pezzo di frase).
   «Hey Cicciopasticcio stop» (o «stop», «basta», «a riposo») lo zittisce e lo rimette ad aspettare la parola.
   Parola di attivazione: modello locale se insegnato nell'app, altrimenti riconoscimento di Chrome (it-IT). */
(function () {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  // «Hey Cicciopasticcio» e le storpiature più comuni del riconoscimento di Chrome
  // (ciccio pasticcio, cicciopasticci, chicco pasticcio, cicciopasticcino…)
  const WAKE_SRC = String.raw`(?:^|\s)(?:(?:hey|ehi|ehy|hei|hej|ei|e|ok|ciao)[\s,]*)?(?:c|ch)ic+[iy]?[oa]?\s*-?\s*pa[sz]+ti?c+h?i?(?:n?[oa])?\b[,.!?]*`;
  const WAKE_RE = new RegExp(WAKE_SRC, 'i');
  const WAKE_G = new RegExp(WAKE_SRC, 'gi');
  // Comandi per mandarlo a riposo (con o senza «Hey Cicciopasticcio» davanti)
  const STOP_RE = /^(?:ok\s+|no\s+|dai\s+)?(?:stop|stoppati|basta(?:\s+così)?|fermati|ferma|zitt[oa]|silenzio|(?:vai\s+|torna\s+|mettiti\s+)?a\s+riposo|riposo|riposati|dormi|vai\s+a\s+dormire|buonanotte|smetti(?:\s+di\s+ascoltare)?|grazie(?:\s+così)?|a\s+posto\s+così|niente|lascia\s+stare)$/i;

  const NO_SPEECH_MS = 7000;   // dopo «Hey Cicciopasticcio»: tempo per iniziare a parlare
  const SILENCE_MS = 1300;     // pausa che chiude la frase (tutto già trascritto)
  const SILENCE_INTERIM_MS = 2000; // pausa se Chrome sta ancora finendo di trascrivere
  const MAX_MS = 30000;        // durata massima di una richiesta

  const V = {
    supported: !!SR,
    wakeEnabled: false,
    mode: 'off',            // off | wake | command
    speaking: false,
    onWake: null,            // () => void
    onCommand: null,         // (text) => void
    onInterim: null,         // (text) => void
    onState: null,           // (state) => void  idle|listening
    onError: null,           // (msg) => void
    onRest: null,            // () => void  quando va a riposo con «stop»
    restAt: 0,               // ultima volta che è andato a riposo
    useAzure: null,          // null = da scoprire
    voiceEnabled: true,
    api: null,
  };

  let rec = null, running = false, wantRunning = false, restartDelay = 300, lastError = '';
  let cmd = null;          // richiesta in corso: { start, carry, cutWake, wakeOk, heard, text, last }
  let lastLen = 0;         // risultati della sessione di Chrome in corso
  let consumed = -1;       // risultati già usati (non vanno riletti come nuova parola di attivazione)
  let noSpeechTimer = null, silenceTimer = null, maxTimer = null;
  let ignoreUntil = 0;     // subito dopo che ha parlato ignora l'eco della sua voce
  let speakingText = '';   // quello che sta dicendo (se contiene il suo nome non deve interrompersi da solo)

  function norm(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
  function stripWake(s) { return norm((s || '').replace(WAKE_G, ' ')); }
  function isStop(text) {
    const t = stripWake(text).toLowerCase().replace(/[.,!?;:«»"']/g, ' ').replace(/\s+/g, ' ').trim();
    return !!t && STOP_RE.test(t);
  }
  V.isStop = isStop;
  function words(t) { return (t || '').toLowerCase().replace(/[^a-zàèéìíòóùú0-9\s]/gi, ' ').split(/\s+/).filter(Boolean); }
  // il testo sentito è (quasi tutto) quello che sta dicendo lui? allora è l'eco della sua voce
  const STOP_WORDS = new Set(['stop', 'stoppati', 'basta', 'fermati', 'zitto', 'zitta', 'silenzio', 'riposo', 'riposati']);
  function hasStopWord(text, ref) {
    const said = new Set(words(ref == null ? speakingText : ref));
    return words(stripWake(text)).some((x) => STOP_WORDS.has(x) && !said.has(x));
  }
  V.hasStopWord = hasStopWord;
  function isEcho(text, ref) {
    ref = ref == null ? speakingText : ref;
    if (!ref) return false;
    const w = words(stripWake(text)); if (!w.length) return false;
    const said = new Set(words(ref));
    return w.filter((x) => said.has(x)).length / w.length >= 0.6;
  }
  V.hasWake = (t) => WAKE_RE.test(t || '');

  function setMode(m) {
    V.mode = m;
    if (V.onState) V.onState(m === 'command' ? 'listening' : 'idle');
  }

  // fra le alternative di Chrome preferisce quella in cui c'è «Cicciopasticcio»
  function bestAlt(res) {
    for (let k = 0; k < res.length; k++) if (WAKE_RE.test(res[k].transcript)) return res[k].transcript;
    return res[0].transcript;
  }

  function create() {
    rec = new SR();
    rec.lang = 'it-IT';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 3;

    rec.onresult = (ev) => {
      lastLen = ev.results.length;
      if (V.mode === 'command' && cmd) return onCommandResult(ev);
      if (!V.speaking && Date.now() < ignoreUntil) { consumed = ev.results.length - 1; return; }
      for (let i = Math.max(ev.resultIndex, consumed + 1); i < ev.results.length; i++) {
        const res = ev.results[i];
        const text = norm(bestAlt(res));
        if (!text) continue;
        const wake = WAKE_RE.test(text);
        if (V.speaking) {
          // mentre parla ascolta solo «stop» o «Hey Cicciopasticcio» (per interromperlo)
          if ((isStop(text) && (wake || !isEcho(text))) || hasStopWord(text)) { consumed = ev.results.length - 1; V.rest(); return; }
          if (wake && !WAKE_RE.test(speakingText) && !(LW() && LW().recording && LW().recording())) { openCommand(i, true); V.stopSpeaking(); onCommandResult(ev); return; }
          continue;
        }
        if (V.mode === 'wake' && wake) { openCommand(i, true); onCommandResult(ev); return; }
      }
    };

    rec.onerror = (e) => {
      lastError = e.error;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        wantRunning = false; V.wakeEnabled = false; closeCommand(); setMode('off');
        if (V.onError) V.onError('Microfono non autorizzato: consenti il microfono a questa pagina (icona a sinistra dell\'indirizzo).');
      } else if (e.error === 'network') {
        restartDelay = 3000;
      } else if (e.error === 'audio-capture') {
        wantRunning = false; V.wakeEnabled = false; closeCommand(); setMode('off');
        if (V.onError) V.onError('Nessun microfono trovato.');
      }
    };

    rec.onend = () => {
      running = false;
      if (wantRunning) {
        setTimeout(() => { if (wantRunning && !running) start(); }, cmd ? 0 : restartDelay);
        restartDelay = Math.min(restartDelay * 1.5, 3000);
      }
    };
    rec.onstart = () => {
      running = true; restartDelay = 300; lastLen = 0; consumed = -1;
      // Chrome a volte riavvia l'ascolto a metà frase: teniamo quello che aveva già sentito
      if (cmd) { cmd.carry = cmd.text; cmd.start = 0; cmd.cutWake = false; }
    };
  }

  function start() {
    if (!SR) return;
    if (!rec) create();
    if (running) return;
    try { rec.start(); } catch (_) { /* già avviato */ }
  }

  function stop() {
    if (rec && running) { try { rec.stop(); } catch (_) { /* ignore */ } }
  }

  const LW = () => (V.wakeMode === 'local' ? window.CiccioWakeLocal : null);

  // ---------- una richiesta: si ascolta finché non fai una pausa ----------
  function openCommand(startIdx, cutWake, barge) {
    if (LW()) LW().pause();
    wantRunning = true;
    cmd = { start: startIdx, carry: '', cutWake: !!cutWake, wakeOk: !cutWake, heard: false, text: '', barge: !!barge, echoRef: barge ? speakingText : '' };
    setMode('command');
    beep(880);
    if (V.onWake) V.onWake();
    clearTimeout(noSpeechTimer); clearTimeout(silenceTimer); clearTimeout(maxTimer);
    noSpeechTimer = setTimeout(endCommand, barge ? 4000 : NO_SPEECH_MS);
    maxTimer = setTimeout(endCommand, MAX_MS);
  }

  function onCommandResult(ev) {
    if (!cmd) return;
    if (cmd.start == null) cmd.start = Math.max(ev.resultIndex, consumed + 1);
    let all = '', allFinal = true;
    for (let j = cmd.start; j < ev.results.length; j++) {
      const res = ev.results[j];
      let t = j === cmd.start ? bestAlt(res) : res[0].transcript;
      if (j === cmd.start && cmd.cutWake) {
        const m = t.match(WAKE_RE);
        cmd.wakeOk = !!m;
        if (m) t = t.slice(m.index + m[0].length);
      }
      all += ' ' + t;
      if (!res.isFinal) allFinal = false;
    }
    const text = stripWake(`${cmd.carry} ${all}`);
    // mentre parla a volume basso: se sente solo la sua voce, non è una richiesta
    if (cmd.barge && !isStop(text) && isEcho(text, cmd.echoRef)) return;
    if (cmd.barge && V.speaking && text) V.stopSpeaking();   // gli stai davvero parlando: si zittisce
    cmd.text = text;
    if (!text) return;
    if (!cmd.heard) { cmd.heard = true; clearTimeout(noSpeechTimer); }
    if (V.onInterim) V.onInterim(text);
    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(endCommand, allFinal ? SILENCE_MS : SILENCE_INTERIM_MS);
  }

  function closeCommand() {
    clearTimeout(noSpeechTimer); clearTimeout(silenceTimer); clearTimeout(maxTimer);
    cmd = null;
    consumed = lastLen - 1;
  }

  function endCommand() {
    const c = cmd;
    closeCommand();
    if (c && c.barge) V.duck(false);   // falso allarme: riprende a parlare a volume normale
    const text = c ? c.text : '';
    // niente di sensato (o la parola di attivazione era un errore di Chrome): torna in attesa senza rispondere
    if (!text || (c && c.cutWake && !c.wakeOk)) { backToWake(); return; }
    if (isStop(text)) { V.rest(); return; }
    backToWake();
    if (V.onCommand) V.onCommand(text);
  }

  function startCommandWindow() {
    openCommand(running && V.wakeMode !== 'local' ? lastLen : null, false);
  }

  function backToWake() {
    setMode(V.wakeEnabled ? 'wake' : 'off');
    if (LW()) {
      // In modalità locale Chrome ascolta solo la richiesta: poi si spegne e torna il modello locale
      if (!V.speaking) { wantRunning = false; stop(); }
      if (V.wakeEnabled) { LW().strict = V.speaking; LW().resume(); }
      return;
    }
    if (!V.wakeEnabled) { wantRunning = false; stop(); }
  }

  V.wakeMode = 'chrome';   // 'chrome' oppure 'local'
  V.serverStt = true;      // con la parola insegnata, la richiesta la capisce il server (Azure)

  let sttToken = 0;
  const TAIL_RE = /^[\s,.!?]*(?:(?:c|ch)ic+[iy]?[oa]?\s*-?\s*)?pa[sz]+ti?c+h?i?(?:n?[oa])?\b[\s,.!?]*/i;
  function cleanStt(t) { return norm(stripWake(t).replace(TAIL_RE, '')).replace(/^[,.\s]+/, '').replace(/\.$/, ''); }

  async function serverCommand(barge, fromSeq) {
    const L = LW();
    const my = ++sttToken;
    L.pause();
    setMode('command');
    const echoRef = barge ? speakingText : '';
    if (barge) V.duck(true);
    beep(880);
    if (V.onWake) V.onWake();
    const r = await L.record({ fromSeq, noSpeechMs: barge ? 4000 : 6500, silenceMs: 1000, maxMs: barge ? 12000 : 25000 });
    if (my !== sttToken || r.cancelled) return;
    const giveUp = () => { if (barge) V.duck(false); backToWake(); };
    if (!r.speech) return giveUp();
    if (V.onInterim) V.onInterim('…');
    let text = '';
    try { text = cleanStt(await V.api.stt(r.wav)); } catch (e) { if (V.onError) V.onError('Non sono riuscito a capire: riprova.'); }
    if (my !== sttToken) return;
    if (!text) return giveUp();
    if (isStop(text) || hasStopWord(text, echoRef)) { V.rest(); return; }
    if (barge && V.speaking && isEcho(text, echoRef)) return giveUp();   // era la sua voce
    if (barge) {
      // se all'inizio c'è un pezzo della sua risposta (sentito mentre parlava), lo toglie
      const said = new Set(words(echoRef)), w = text.split(/\s+/);
      let k = 0; while (k < w.length && said.has(words(w[k])[0])) k++;
      if (k >= 3 && k < w.length) text = w.slice(k).join(' ');
    }
    if (barge) V.stopSpeaking();
    backToWake();
    if (V.onInterim) V.onInterim(text);
    if (V.onCommand) V.onCommand(text);
  }
  const useServer = () => !!(LW() && LW().record && V.serverStt && V.api && V.api.stt && LW().running);

  // Prova a usare il modello locale; se non c'è resta il riconoscimento di Chrome
  V.initLocalWake = async function () {
    const L = window.CiccioWakeLocal;
    if (!L || !SR) return false;
    const ok = await L.init();
    if (!ok) return false;
    L.onDetect = () => {
      if (V.mode !== 'wake') return;
      if (useServer()) { serverCommand(V.speaking, L.detectSeq - 2); return; }
      wantRunning = true;
      if (V.speaking) {
        // «Hey Cicciopasticcio» mentre parla: abbassa la voce e controlla che sia davvero tu
        V.duck(true);
        openCommand(null, false, true);
      } else {
        startCommandWindow();
      }
      start();
    };
    L.onError = (m) => { if (V.onError) V.onError(m); };
    L.onGesture = (need) => { if (V.onGesture) V.onGesture(need); };
    V.wakeMode = 'local';
    return true;
  };

  V.setWake = function (on) {
    V.wakeEnabled = !!on && !!SR;
    if (LW()) {
      if (V.wakeEnabled) {
        setMode('wake');
        LW().start().then((ok) => { if (!ok) { V.wakeEnabled = false; setMode('off'); } else LW().resume(); });
      } else if (V.mode !== 'command') { setMode('off'); LW().stop(); }
      return;
    }
    if (V.wakeEnabled) { setMode('wake'); wantRunning = true; start(); }
    else if (V.mode !== 'command') { setMode('off'); wantRunning = false; stop(); }
  };

  V.pushToTalk = function () {
    if (!SR) { if (V.onError) V.onError('Questo browser non supporta il riconoscimento vocale: usa Chrome.'); return; }
    V.stopSpeaking();
    if (useServer()) { serverCommand(false, LW().seq() + 1); return; }
    wantRunning = true;
    startCommandWindow();
    start();
  };

  V.cancel = function () { sttToken++; if (LW() && LW().cancelRecord) LW().cancelRecord(); closeCommand(); backToWake(); };

  // «Hey Cicciopasticcio stop»: smette di parlare, chiude l'ascolto e torna ad aspettare la parola
  V.rest = function () {
    V.restAt = Date.now();
    sttToken++; if (LW() && LW().cancelRecord) LW().cancelRecord();
    V.stopSpeaking();
    closeCommand();
    backToWake();
    beep(520); setTimeout(() => beep(330), 170);
    if (V.onRest) V.onRest();
  };

  // ---------- suoni ----------
  let actx = null;
  function beep(freq) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, actx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.15, actx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + 0.18);
      o.connect(g).connect(actx.destination);
      o.start(); o.stop(actx.currentTime + 0.2);
    } catch (_) { /* ignore */ }
  }
  V.beep = beep;

  // ---------- lettura ad alta voce ----------
  // Su iPhone (e in parte su Android) l'audio parte solo se è stato "sbloccato" da un tocco:
  // al primo tocco sblocchiamo un lettore che poi riusiamo per tutte le risposte.
  const SILENT = 'data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YZABAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA';
  let player = null, playing = false, unlocked = false;
  function getPlayer() {
    if (!player) { player = new Audio(); player.preload = 'auto'; player.setAttribute('playsinline', ''); }
    return player;
  }
  function unlockAudio() {
    if (unlocked) return;
    unlocked = true;
    try {
      const p = getPlayer();
      p.src = SILENT;
      const pr = p.play();
      if (pr && pr.then) pr.then(() => { if (!playing) p.pause(); }).catch(() => { unlocked = false; });
    } catch (_) { unlocked = false; }
    try {
      if ('speechSynthesis' in window) { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); }
    } catch (_) { /* ignore */ }
    try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state !== 'running') actx.resume(); } catch (_) { /* ignore */ }
  }
  ['touchend', 'click', 'keydown'].forEach((ev) => document.addEventListener(ev, unlockAudio, true));
  V.unlockAudio = unlockAudio;

  // Mentre parla resta in ascolto solo di «stop» e di «Hey Cicciopasticcio», per poterlo interrompere
  function pauseListening() {
    V.speaking = true;
    if (LW()) {
      if (V.wakeEnabled) {
        LW().strict = true;
        wantRunning = true; start();          // per sentire «stop» anche senza la parola
      } else { LW().pause(); if (V.mode !== 'command') { wantRunning = false; stop(); } }
    } else if (!V.wakeEnabled && V.mode !== 'command') { stop(); }
  }
  function resumeListening() {
    V.speaking = false;
    speakingText = '';
    consumed = Math.max(consumed, lastLen - 1);
    ignoreUntil = Date.now() + 700;
    if (LW()) {
      LW().strict = false;
      if (V.mode !== 'command') { wantRunning = false; stop(); }   // finito di parlare: torna solo il modello locale
      if (V.wakeEnabled && V.mode === 'wake' && LW().isPaused()) setTimeout(() => LW().resume(), 300);
    } else if (wantRunning && !running) setTimeout(start, 250);
  }

  // Divide il testo in frasi: la voce di Chrome si blocca dopo circa 15 secondi di testo continuo,
  // e la voce del server parte prima se la prima frase è corta.
  function splitText(text, firstMax, max) {
    const sentences = (text.replace(/\s+/g, ' ').trim().match(/[^.!?;:]+[.!?;:]*["»)]*\s*/g) || [text]);
    const out = [];
    let cur = '';
    const push = () => { if (cur.trim()) out.push(cur.trim()); cur = ''; };
    for (let p of sentences) {
      const lim = out.length ? max : firstMax;
      while (p.length > lim) {           // frase lunghissima: taglia a una virgola o a uno spazio
        let cut = p.lastIndexOf(', ', lim); if (cut < lim * 0.4) cut = p.lastIndexOf(' ', lim); if (cut < 1) cut = lim;
        if (cur) push();
        out.push(p.slice(0, cut + 1).trim()); p = p.slice(cut + 1);
      }
      if (cur && (cur.length + p.length > (out.length ? max : firstMax))) push();
      cur += p;
    }
    push();
    return out.length ? out : [text];
  }
  V.splitText = splitText;

  let speakToken = 0;      // cambia quando lo interrompi: i pezzi successivi non vengono più letti

  function speakOne(text, my) {
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'it-IT';
      const it = speechSynthesis.getVoices().filter((v) => v.lang && v.lang.startsWith('it'));
      const pick = it.find((v) => /google|natural|online|alice|federica|luca/i.test(v.name)) || it[0];
      if (pick) u.voice = pick;
      u.rate = 1.05;
      let done = false;
      const fin = () => { if (!done) { done = true; resolve(); } };
      u.onend = () => fin();
      u.onerror = (e) => { note(`voce del telefono: errore ${e && e.error}`); fin(); };
      // se il dispositivo non avvisa la fine, non resta bloccato
      setTimeout(() => { if (!done && my === speakToken) { note('voce del telefono: fine non segnalata'); fin(); } }, Math.min(25000, 3000 + text.length * 85));
      try { speechSynthesis.resume(); } catch (_) { /* ignore */ }
      speechSynthesis.speak(u);
    });
  }

  async function browserSpeak(text, my) {
    if (!('speechSynthesis' in window)) { note('voce del telefono non disponibile'); return; }
    try { speechSynthesis.cancel(); } catch (_) { /* ignore */ }
    for (const part of splitText(text, 160, 220)) {
      if (my !== speakToken) return;
      await speakOne(part, my);
    }
    if (my === speakToken) note('voce del telefono: ok');
  }

  V.audioLog = [];
  function note(m) { V.audioLog.push(m); if (V.audioLog.length > 8) V.audioLog.shift(); }

  // Su Safari i file audio "blob:" a volte non partono: lo passiamo come data: con il tipo giusto
  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const b = blob.type && blob.type.startsWith('audio/') ? blob : new Blob([blob], { type: 'audio/mpeg' });
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result); fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(b);
    });
  }

  // true se l'audio è stato riprodotto, false se il browser l'ha bloccato
  // Seconda prova con un indirizzo diverso (blob:), che Chrome a volte preferisce
  async function playBlobUrl(blob) {
    const url = URL.createObjectURL(blob.type && blob.type.startsWith('audio/') ? blob : new Blob([blob], { type: 'audio/mpeg' }));
    try {
      return await new Promise((resolve) => {
        const p = getPlayer();
        let done = false, started = false;
        const fin = (ok) => { if (done) return; done = true; playing = false; p.onended = p.onerror = p.onplaying = null; resolve(ok); };
        p.onended = () => fin(true);
        p.onerror = () => fin(false);
        p.onplaying = () => { started = true; };
        p.volume = ducked ? 0.2 : 1;
        p.src = url; playing = true;
        const pr = p.play(); if (pr && pr.catch) pr.catch(() => fin(false));
        setTimeout(() => { if (!started && !done) { try { p.pause(); } catch (_) { /* ignore */ } fin(false); } }, 9000);
      });
    } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }

  async function playBlob(blob) {
    let src;
    try { src = await blobToDataUrl(blob); } catch (e) { note(`lettura audio: ${e && e.message}`); return false; }
    return new Promise((resolve) => {
      const p = getPlayer();
      let done = false, started = false;
      const fin = (ok) => { if (done) return; done = true; playing = false; p.onended = p.onerror = p.onplaying = null; resolve(ok); };
      p.onended = () => fin(true);
      p.onerror = () => { note(`errore lettore: ${p.error ? p.error.code : '?'}`); fin(false); };
      p.onplaying = () => { started = true; };
      p.volume = ducked ? 0.2 : 1;
      p.src = src;
      playing = true;
      const pr = p.play();
      if (pr && pr.catch) pr.catch((e) => { note(`riproduzione bloccata: ${e && e.name}`); fin(false); });
      // se dopo 4 secondi non è nemmeno partito, consideralo bloccato
      setTimeout(() => { if (!started && !done) { note('riproduzione non partita'); try { p.pause(); } catch (_) { /* ignore */ } fin(false); } }, 9000);
    });
  }

  V.serverOnly = true;     // con la voce del server attiva non passa mai alla voce di Chrome

  V.speak = async function (text, onStart) {
    if (!V.voiceEnabled || !text) return;
    const my = ++speakToken;
    speakingText = text;
    ducked = false;
    pauseListening();
    let started = false;
    const begin = () => { if (!started) { started = true; if (onStart) onStart(); } };
    try {
      if (V.api) {
        const parts = splitText(text, 220, 900);
        let next = V.api.tts(parts[0]);
        for (let i = 0; i < parts.length; i++) {
          let blob = await next;
          if (my !== speakToken) return;
          if (!(blob && blob.size > 200)) {          // il server non ha risposto: riprova una volta
            await new Promise((r) => setTimeout(r, 500));
            if (my !== speakToken) return;
            blob = await V.api.tts(parts[i]);
            if (my !== speakToken) return;
          }
          next = i + 1 < parts.length ? V.api.tts(parts[i + 1]) : null;   // scarica già il pezzo dopo
          if (blob && blob.size > 200) {
            begin();
            let ok = await playBlob(blob);
            if (my !== speakToken) return;
            if (!ok) { note('riprovo a riprodurre'); ok = await playBlobUrl(blob); if (my !== speakToken) return; }
            if (ok) continue;
            note('riproduzione non riuscita');
          } else {
            note(`voce del server non disponibile (${blob ? blob.size : 'nessuna risposta'})`);
          }
          if (V.serverOnly) {
            // niente voce di Chrome: la risposta resta scritta sullo schermo
            if (V.onVoiceFail) V.onVoiceFail();
            return;
          }
          begin();
          await browserSpeak(parts.slice(i).join(' '), my);
          return;
        }
        if (my === speakToken) note('voce del server: ok');
        return;
      }
      begin();
      await browserSpeak(text, my);
    } finally {
      if (my === speakToken) resumeListening();
    }
  };

  // Abbassa il volume mentre controlla se gli stai davvero parlando
  let ducked = false;
  V.duck = function (on) {
    ducked = !!on;
    if (player && playing) { try { player.volume = on ? 0.2 : 1; } catch (_) { /* ignore */ } }
  };

  // Pulsante «Prova la voce»: va chiamato direttamente dal tocco
  V.testVoice = async function () {
    V.audioLog = [];
    unlocked = false; unlockAudio();
    const was = V.voiceEnabled; V.voiceEnabled = true;
    try { await V.speak('Ciao, mi senti? Questa è una prova della voce di Cicciopasticcio.'); } finally { V.voiceEnabled = was; }
    return V.audioLog.slice();
  };

  V.interruptedAt = 0;
  V.stopSpeaking = function () {
    if (V.speaking) V.interruptedAt = Date.now();
    speakToken++;
    ducked = false;
    if (V.speaking) resumeListening();
    if (player && playing) { try { player.pause(); } catch (_) { /* ignore */ } if (player.onended) player.onended(); }
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  };

  V.lastError = () => lastError;
  window.CiccioVoice = V;
})();
