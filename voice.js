/* Voce di Cicciopasticcio: ascolto, parola di attivazione e lettura delle risposte.
   Modalità attuale: riconoscimento vocale di Chrome (it-IT).
   Fase 2: modello locale "hey cicciopasticcio" (vedi guida) che sostituisce solo il rilevamento della parola.
   Dopo ogni risposta ascolta subito per qualche secondo, senza bisogno di ripetere la parola.
   «Cicciopasticcio riposati»: dorme e ignora tutto, anche «Hey Cicciopasticcio», finché non sente «Cicciopasticcio svegliati». */
(function () {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const WAKE_RE = /(?:^|\s)(?:hey|ehi|ehy|hei|ei|e|ok)?\s*cicci[oa]\s*-?\s*pastic+i[oa]?\b[,.!?]?/i;
  const SVEGLIA_RE = /svegli/i;                 // svegliati, sveglia, svegliamoci…
  const FOLLOW_MS = 6000;                       // dopo la risposta: tempo per rispondergli senza ripetere la parola
  const SLEEPCHECK_MS = 6000;                   // mentre dorme: dopo «Cicciopasticcio» aspetta «svegliati» per qualche secondo
  function words(t) { return (t || '').toLowerCase().replace(/[^a-zàèéìíòóùú\s]/gi, ' ').split(/\s+/).filter(Boolean); }
  // «riposati» (anche «riposa», «vai a riposare», «a riposo»), detto da solo dopo la parola
  function isSleepCmd(t) {
    const w = words(t);
    if (!w.length || w.length > 4) return false;
    return w.some((x) => /^(riposati|riposa|riposarti|riposare)$/.test(x)) || / a riposo$/.test(' ' + w.join(' '));
  }
  const isWakeUpOnly = (t) => { const w = words(t); return w.length > 0 && w.length <= 2 && w.some((x) => SVEGLIA_RE.test(x)); };

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
    sleeping: false,         // true quando dorme («Cicciopasticcio riposati»)
    onSleep: null,           // () => void
    onWakeUp: null,          // () => void
    useAzure: null,          // null = da scoprire
    voiceEnabled: true,
    api: null,
  };

  let rec = null, running = false, wantRunning = false, cmdTimer = null, restartDelay = 300, lastError = '';
  let sleepCheckUntil = 0, sleepTimer = null;
  try { V.sleeping = localStorage.getItem('ciccio_dorme') === '1'; } catch (_) { /* ignore */ }
  function saveSleep() { try { localStorage.setItem('ciccio_dorme', V.sleeping ? '1' : '0'); } catch (_) { /* ignore */ } }

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
      if (V.sleeping) return onSleepingResult(ev);
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        const text = norm(res[0].transcript);
        if (!text) continue;
        if (V.mode === 'wake') {
          const m = text.match(WAKE_RE);
          if (m) {
            const after = norm(text.slice(m.index + m[0].length));
            if (res.isFinal) {
              if (isSleepCmd(after)) { V.sleep(); return; }
              // ha già iniziato la domanda: la ascolta fino in fondo (non si ferma al primo pezzo)
              if (after.split(/\s+/).filter(Boolean).length >= 2) { startCommandWindow(null, 0, after); }
              else { startCommandWindow(); }
            } else if (V.onInterim && after) {
              V.onInterim(after);
            }
            if (!res.isFinal && V.mode === 'wake') { V._pendingWake = true; }
          } else if (res.isFinal && V._pendingWake) {
            V._pendingWake = false;
          }
        } else if (V.mode === 'command') {
          // la frase arriva a pezzi: li mette insieme e aspetta che tu abbia finito di parlare
          let fin = '', interim = '';
          for (let j = i; j < ev.results.length; j++) {
            const r = ev.results[j];
            const clean = norm(r[0].transcript.replace(WAKE_RE, ' '));
            if (r.isFinal) fin = norm(`${fin} ${clean}`); else interim = norm(`${interim} ${clean}`);
          }
          onCommandPiece(fin, interim);
          return;
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

  // ---------- la tua richiesta ----------
  // Chrome divide le frasi lunghe in pezzi: qui si mettono insieme, e la richiesta parte solo
  // quando smetti di parlare (pausa di circa un secondo e mezzo), non al primo pezzo.
  const SILENCE_MS = 1400;          // pausa dopo l'ultimo pezzo già scritto
  const SILENCE_INTERIM_MS = 2000;  // pausa se Chrome sta ancora scrivendo l'ultimo pezzo
  const MAX_MS = 30000;             // durata massima di una richiesta
  let cmdFinal = '', cmdInterim = '', silenceTimer = null, maxTimer = null;
  const cmdText = () => norm(`${cmdFinal} ${cmdInterim}`);

  function onCommandPiece(finalPiece, interim) {
    if (finalPiece) cmdFinal = norm(`${cmdFinal} ${finalPiece}`);
    cmdInterim = interim || '';
    const t = cmdText();
    if (!t) return;
    if (V.onInterim) V.onInterim(t);
    clearTimeout(cmdTimer);          // hai iniziato a parlare: non scade più, aspetta che finisci
    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(endCommand, cmdInterim ? SILENCE_INTERIM_MS : SILENCE_MS);
  }

  function clearCommand() {
    clearTimeout(cmdTimer); clearTimeout(silenceTimer); clearTimeout(maxTimer);
    cmdFinal = ''; cmdInterim = '';
  }

  function endCommand() {
    const t = cmdText();
    clearCommand();
    if (V.mode !== 'command') return;
    if (!t || isWakeUpOnly(t)) { backToWake(); return; }   // niente detto (o «svegliati» quando è già sveglio)
    if (isSleepCmd(t)) { V.sleep(); return; }
    finishCommand(t);
  }

  function startCommandWindow(ms, freq, seed) {
    if (LW()) LW().pause();
    clearCommand();
    setMode('command');
    if (freq !== 0) beep(freq || 880);
    if (V.onWake) V.onWake();
    cmdTimer = setTimeout(endCommand, ms || 8000);   // se non inizi a parlare
    maxTimer = setTimeout(endCommand, MAX_MS);
    if (seed) onCommandPiece(seed, '');
  }

  // Subito dopo la risposta: ti ascolta qualche secondo senza bisogno di dire di nuovo «Hey Cicciopasticcio»
  V.followUp = function () {
    if (!SR || !V.wakeEnabled || V.sleeping || V.speaking || V.mode === 'command') return;
    wantRunning = true;
    startCommandWindow(FOLLOW_MS, 660);
    start();
  };

  // ---------- sonno ----------
  // Mentre dorme ascolta solo «Cicciopasticcio svegliati»: tutto il resto non lo attiva
  function onSleepingResult(ev) {
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const text = norm(ev.results[i][0].transcript);
      if (!text) continue;
      const hasWake = WAKE_RE.test(text);
      if (hasWake) sleepCheckUntil = Math.max(sleepCheckUntil, Date.now() + SLEEPCHECK_MS);
      if (SVEGLIA_RE.test(text) && (hasWake || Date.now() < sleepCheckUntil)) { V.wakeUp(); return; }
    }
  }
  // Con la parola insegnata: il modello sente «Cicciopasticcio», poi Chrome controlla in silenzio se segue «svegliati»
  function sleepCheck() {
    sleepCheckUntil = Date.now() + SLEEPCHECK_MS;
    wantRunning = true; start();
    clearTimeout(sleepTimer);
    sleepTimer = setTimeout(() => { if (V.sleeping && LW()) { wantRunning = false; stop(); } }, SLEEPCHECK_MS + 200);
  }

  V.sleep = function () {
    V.sleeping = true; saveSleep();
    clearTimeout(cmdTimer); clearTimeout(sleepTimer); sleepCheckUntil = 0;
    V.stopSpeaking();
    setMode(V.wakeEnabled ? 'wake' : 'off');
    if (LW()) { wantRunning = false; stop(); if (V.wakeEnabled) LW().resume(); }
    else if (!V.wakeEnabled) { wantRunning = false; stop(); }
    beep(660); setTimeout(() => beep(440), 160); setTimeout(() => beep(330), 320);
    if (V.onSleep) V.onSleep();
  };

  V.wakeUp = function () {
    if (!V.sleeping) return;
    V.sleeping = false; saveSleep();
    clearTimeout(sleepTimer); sleepCheckUntil = 0;
    beep(440); setTimeout(() => beep(880), 160);
    if (V.onWakeUp) V.onWakeUp();
    // si riprende già in ascolto, come dopo «Hey Cicciopasticcio»
    wantRunning = true;
    setTimeout(() => { if (!V.sleeping && V.mode !== 'command') { startCommandWindow(8000, 0); start(); } }, 350);
  };

  function finishCommand(text) {
    clearCommand();
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
      if (V.sleeping) { if (!V.speaking) sleepCheck(); return; }
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
    if (V.sleeping) { V.sleeping = false; saveSleep(); if (V.onWakeUp) V.onWakeUp(); }   // l'hai chiamato tu
    wantRunning = true;
    startCommandWindow();
    start();
  };

  V.cancel = function () { clearCommand(); backToWake(); };

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
    if (LW()) { if (V.wakeEnabled && V.mode === 'wake') setTimeout(() => { if (V.mode === 'wake' && !V.speaking) LW().resume(); }, 300); }
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

  // Prima frase a parte: la voce del server la prepara in un attimo e intanto prepara il resto
  function splitFirst(text) {
    const m = text.match(/^[\s\S]{15,170}?[.!?](?=\s|$)/);
    if (!m || text.length - m[0].length < 15) return [text];
    return [m[0].trim(), text.slice(m[0].length).trim()];
  }
  let speakToken = 0;

  V.speak = async function (text, onStart) {
    if (!V.voiceEnabled || !text) return;
    const my = ++speakToken;
    pauseListening();
    try {
      if (V.api) {
        const parts = splitFirst(text);
        const reqs = parts.map((p) => V.api.tts(p));      // chieste insieme: la prima arriva subito
        for (let i = 0; i < parts.length; i++) {
          const blob = await reqs[i];
          if (my !== speakToken) return;
          if (blob && blob.size > 200) {
            if (onStart) onStart();
            const ok = await playBlob(blob);
            if (my !== speakToken) return;
            if (ok) { if (i === parts.length - 1) note('voce del server: ok'); continue; }
            note('voce del server bloccata: uso quella del telefono');
          } else {
            note(`voce del server non disponibile (${blob ? blob.size : 'nessuna risposta'})`);
          }
          if (onStart) onStart();
          await browserSpeak(parts.slice(i).join(' '));
          return;
        }
        return;
      }
      if (onStart) onStart();
      await browserSpeak(text);
    } finally {
      if (my === speakToken) resumeListening();
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
    const was = V.speaking;
    speakToken++;
    if (was) resumeListening();
    if (player && playing) { try { player.pause(); } catch (_) { /* ignore */ } if (player.onended) player.onended(); }
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  };

  V.lastError = () => lastError;
  window.CiccioVoice = V;
})();
