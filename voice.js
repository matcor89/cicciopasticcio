/* Voce di Cicciopasticcio: ascolto, parola di attivazione e lettura delle risposte.
   Modalità attuale: riconoscimento vocale di Chrome (it-IT).
   Fase 2: modello locale "hey cicciopasticcio" (vedi guida) che sostituisce solo il rilevamento della parola. */
(function () {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const WAKE_RE = /(?:^|\s)(?:hey|ehi|ehy|hei|ei|e|ok)?\s*cicci[oa]\s*-?\s*pastic+i[oa]?\b[,.!?]?/i;

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
    useAzure: null,          // null = da scoprire
    voiceEnabled: true,
    api: null,
  };

  let rec = null, running = false, wantRunning = false, cmdTimer = null, restartDelay = 300, lastError = '';

  function norm(s) { return (s || '').trim(); }

  function setMode(m) {
    V.mode = m;
    if (V.onState) V.onState(m === 'command' ? 'listening' : 'idle');
  }

  function create() {
    rec = new SR();
    rec.lang = 'it-IT';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (ev) => {
      if (V.speaking) return;
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        const text = norm(res[0].transcript);
        if (!text) continue;
        if (V.mode === 'wake') {
          const m = text.match(WAKE_RE);
          if (m) {
            const after = norm(text.slice(m.index + m[0].length));
            if (res.isFinal) {
              if (after.split(/\s+/).filter(Boolean).length >= 2) { finishCommand(after); }
              else { startCommandWindow(); }
            } else if (V.onInterim && after) {
              V.onInterim(after);
            }
            if (!res.isFinal && V.mode === 'wake') { V._pendingWake = true; }
          } else if (res.isFinal && V._pendingWake) {
            V._pendingWake = false;
          }
        } else if (V.mode === 'command') {
          const clean = norm(text.replace(WAKE_RE, ' '));
          if (V.onInterim) V.onInterim(clean);
          if (res.isFinal && clean) finishCommand(clean);
        }
      }
    };

    rec.onerror = (e) => {
      lastError = e.error;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        wantRunning = false; V.wakeEnabled = false; setMode('off');
        if (V.onError) V.onError('Microfono non autorizzato: consenti il microfono a questa pagina (icona a sinistra dell\'indirizzo).');
      } else if (e.error === 'network') {
        restartDelay = 3000;
      } else if (e.error === 'audio-capture') {
        wantRunning = false; V.wakeEnabled = false; setMode('off');
        if (V.onError) V.onError('Nessun microfono trovato.');
      }
    };

    rec.onend = () => {
      running = false;
      if (wantRunning && !V.speaking) {
        setTimeout(() => { if (wantRunning && !running && !V.speaking) start(); }, restartDelay);
        restartDelay = Math.min(restartDelay * 1.5, 3000);
      }
    };
    rec.onstart = () => { running = true; restartDelay = 300; };
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

  function startCommandWindow() {
    if (LW()) LW().pause();
    setMode('command');
    beep(880);
    if (V.onWake) V.onWake();
    clearTimeout(cmdTimer);
    cmdTimer = setTimeout(() => { if (V.mode === 'command') backToWake(); }, 8000);
  }

  function finishCommand(text) {
    clearTimeout(cmdTimer);
    backToWake();
    if (V.onCommand) V.onCommand(text);
  }

  function backToWake() {
    setMode(V.wakeEnabled ? 'wake' : 'off');
    if (LW()) {
      // In modalità locale Chrome ascolta solo il comando: poi si spegne e torna il modello locale
      wantRunning = false; stop();
      if (V.wakeEnabled && !V.speaking) LW().resume();
      return;
    }
    if (!V.wakeEnabled) { wantRunning = false; stop(); }
  }

  V.wakeMode = 'chrome';   // 'chrome' oppure 'local'

  // Prova a usare il modello locale; se non c'è resta il riconoscimento di Chrome
  V.initLocalWake = async function () {
    const L = window.CiccioWakeLocal;
    if (!L || !SR) return false;
    const ok = await L.init();
    if (!ok) return false;
    L.onDetect = () => {
      if (V.mode !== 'wake' || V.speaking) return;
      wantRunning = true;
      startCommandWindow();
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
    wantRunning = true;
    startCommandWindow();
    start();
  };

  V.cancel = function () { clearTimeout(cmdTimer); backToWake(); };

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

  function pauseListening() { V.speaking = true; stop(); if (LW()) LW().pause(); }
  function resumeListening() {
    V.speaking = false;
    if (LW()) { if (V.wakeEnabled && V.mode === 'wake') setTimeout(() => LW().resume(), 300); }
    else if (wantRunning) setTimeout(start, 250);
  }

  function browserSpeak(text) {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window)) { note('voce del telefono non disponibile'); return resolve(); }
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'it-IT';
      const it = speechSynthesis.getVoices().filter((v) => v.lang && v.lang.startsWith('it'));
      const pick = it.find((v) => /google|natural|online|alice|federica|luca/i.test(v.name)) || it[0];
      if (pick) u.voice = pick;
      u.rate = 1.05;
      let done = false;
      const fin = () => { if (!done) { done = true; resolve(); } };
      u.onend = () => { note('voce del telefono: ok'); fin(); };
      u.onerror = (e) => { note(`voce del telefono: errore ${e && e.error}`); fin(); };
      setTimeout(fin, Math.min(60000, 4000 + text.length * 90)); // se il telefono non avvisa la fine
      speechSynthesis.speak(u);
    });
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
      p.src = src;
      playing = true;
      const pr = p.play();
      if (pr && pr.catch) pr.catch((e) => { note(`riproduzione bloccata: ${e && e.name}`); fin(false); });
      // se dopo 4 secondi non è nemmeno partito, consideralo bloccato
      setTimeout(() => { if (!started && !done) { note('riproduzione non partita'); try { p.pause(); } catch (_) { /* ignore */ } fin(false); } }, 4000);
    });
  }

  V.speak = async function (text, onStart) {
    if (!V.voiceEnabled || !text) return;
    pauseListening();
    try {
      if (V.api) {
        const blob = await V.api.tts(text);
        if (blob && blob.size > 200) {
          if (onStart) onStart();
          const ok = await playBlob(blob);
          if (ok) { note('voce del server: ok'); return; }
          note('voce del server bloccata: uso quella del telefono');
          await browserSpeak(text);
          return;
        }
        note(`voce del server non disponibile (${blob ? blob.size : 'nessuna risposta'})`);
      }
      if (onStart) onStart();
      await browserSpeak(text);
    } finally {
      resumeListening();
    }
  };

  // Pulsante «Prova la voce»: va chiamato direttamente dal tocco
  V.testVoice = async function () {
    V.audioLog = [];
    unlocked = false; unlockAudio();
    const was = V.voiceEnabled; V.voiceEnabled = true;
    try { await V.speak('Ciao, mi senti? Questa è una prova della voce di Cicciopasticcio.'); } finally { V.voiceEnabled = was; }
    return V.audioLog.slice();
  };

  V.stopSpeaking = function () {
    if (player && playing) { try { player.pause(); } catch (_) { /* ignore */ } if (player.onended) player.onended(); }
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  };

  V.lastError = () => lastError;
  window.CiccioVoice = V;
})();
