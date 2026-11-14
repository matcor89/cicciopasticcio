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
  let audio = null;
  function pauseListening() { V.speaking = true; stop(); if (LW()) LW().pause(); }
  function resumeListening() {
    V.speaking = false;
    if (LW()) { if (V.wakeEnabled && V.mode === 'wake') setTimeout(() => LW().resume(), 300); }
    else if (wantRunning) setTimeout(start, 250);
  }

  function browserSpeak(text) {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window)) return resolve();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'it-IT';
      const it = speechSynthesis.getVoices().filter((v) => v.lang && v.lang.startsWith('it'));
      const pick = it.find((v) => /google|natural|online/i.test(v.name)) || it[0];
      if (pick) u.voice = pick;
      u.rate = 1.05;
      u.onend = resolve; u.onerror = resolve;
      speechSynthesis.speak(u);
    });
  }

  V.speak = async function (text, onStart) {
    if (!V.voiceEnabled || !text) return;
    pauseListening();
    try {
      if (V.useAzure !== false && V.api) {
        const blob = await V.api.tts(text);
        if (blob) {
          V.useAzure = true;
          if (onStart) onStart();
          await new Promise((resolve) => {
            audio = new Audio(URL.createObjectURL(blob));
            audio.onended = resolve; audio.onerror = resolve;
            audio.play().catch(resolve);
          });
          return;
        }
        V.useAzure = false;
      }
      if (onStart) onStart();
      await browserSpeak(text);
    } finally {
      audio = null;
      resumeListening();
    }
  };

  V.stopSpeaking = function () {
    if (audio) { try { audio.pause(); } catch (_) { /* ignore */ } audio = null; }
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  };

  V.lastError = () => lastError;
  window.CiccioVoice = V;
})();
