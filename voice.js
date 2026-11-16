/* Voce di Cicciopasticcio: ascolto, parola di attivazione e lettura delle risposte.
   Ascolta solo dopo «Hey Cicciopasticcio»: prende la richiesta finché non fai una pausa,
   poi mentre pensa e risponde sente solo «stop» (nient'altro), e alla fine torna ad aspettare la parola.
   «Hey Cicciopasticcio stop» (o «stop», «basta», «dormi», «a riposo») lo mette a riposo:
   qualsiasi cosa venga detta viene ignorata finché non dici di nuovo «Hey Cicciopasticcio».
   Parola di attivazione: modello locale se insegnato nell'app, altrimenti riconoscimento di Chrome (it-IT). */
(function () {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  // «Hey Cicciopasticcio» e le storpiature più comuni del riconoscimento di Chrome
  // (ciccio pasticcio, cicciopasticci, chicco pasticcio, cicciopasticcino…)
  const WAKE_SRC = String.raw`(?:^|\s)(?:(?:hey|ehi|ehy|hei|hej|ei|e|ok|ciao)[\s,]*)?(?:c|ch)ic+[iy]?[oa]?\s*-?\s*pa[sz]+ti?c+h?i?(?:n?[oa])?\b[,.!?]*`;
  const WAKE_RE = new RegExp(WAKE_SRC, 'i');
  const WAKE_G = new RegExp(WAKE_SRC, 'gi');
  // Comandi per mandarlo a riposo (con o senza «Hey Cicciopasticcio» davanti)
  const STOP_RE = /^(?:ok\s+|no\s+|dai\s+)?(?:stop|stoppati|basta(?:\s+così)?|basta\s+ascoltare|fermati|ferma|zitt[oa]|silenzio|(?:vai\s+|torna\s+|mettiti\s+)?a\s+riposo|riposo|riposati|dormi|vai\s+a\s+dormire|buonanotte|spegniti|smetti(?:\s+di\s+ascoltare)?|non\s+ascoltare(?:\s+più)?|grazie(?:\s+così)?|a\s+posto\s+così|niente|lascia\s+stare)$/i;

  // Parole che lo zittiscono mentre pensa o risponde (se non le sta dicendo lui)
  const STOP_WORDS = new Set(['stop', 'stoppati', 'basta', 'fermati', 'zitto', 'zitta', 'silenzio', 'riposo', 'riposati', 'dormi', 'spegniti']);
  // Controllo largo che nella registrazione ci sia davvero «Cicciopasticcio» (scarta i falsi attivamenti)
  const LOOSE_WAKE = /(?:c|ch|g)i[cg]+h?i?[oa]?\s*-?\s*pa|pa[sz]+ti?c+|cicci/i;

  const NO_SPEECH_MS = 7000;   // dopo «Hey Cicciopasticcio»: tempo per iniziare a parlare
  const SILENCE_MS = 900;      // pausa che chiude la frase (tutto già trascritto)
  const SILENCE_INTERIM_MS = 1400; // pausa se Chrome sta ancora finendo di trascrivere
  const MAX_MS = 15000;        // durata massima di una richiesta: poi smette di ascoltare e risponde

  const V = {
    supported: !!SR,
    wakeEnabled: false,
    mode: 'off',            // off | wake | command
    speaking: false,
    deaf: false,             // true mentre pensa e risponde: non ascolta niente
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
  let cmd = null;          // richiesta in corso: { start, carry, cutWake, wakeOk, heard, text }
  let lastLen = 0;         // risultati della sessione di Chrome in corso
  let consumed = -1;       // risultati già usati (non vanno riletti come nuova parola di attivazione)
  let noSpeechTimer = null, silenceTimer = null, maxTimer = null;
  let ignoreUntil = 0;     // appena torna ad ascoltare ignora la coda della sua voce
  let heldAt = 0;          // quando ha smesso di ascoltare per rispondere
  let speakingText = '';   // quello che sta dicendo: se lo ripete il microfono non è un tuo «stop»

  function norm(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
  function stripWake(s) { return norm((s || '').replace(WAKE_G, ' ')); }
  function isStop(text) {
    const t = stripWake(text).toLowerCase().replace(/[.,!?;:«»"']/g, ' ').replace(/\s+/g, ' ').trim();
    return !!t && STOP_RE.test(t);
  }
  V.isStop = isStop;
  V.hasWake = (t) => WAKE_RE.test(t || '');
  function words(t) { return (t || '').toLowerCase().replace(/[^a-zàèéìíòóùú0-9\s]/gi, ' ').split(/\s+/).filter(Boolean); }
  function hasStopWord(text) {
    const said = new Set(words(speakingText));
    return words(stripWake(text)).some((x) => STOP_WORDS.has(x) && !said.has(x));
  }
  V.hasStopWord = hasStopWord;

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
      // mentre pensa o risponde sente solo «stop»: tutto il resto viene ignorato
      if (V.deaf || V.speaking) {
        for (let i = Math.max(ev.resultIndex, consumed + 1); i < ev.results.length; i++) {
          if (hasStopWord(norm(bestAlt(ev.results[i])))) { consumed = ev.results.length - 1; V.rest(); return; }
        }
        return;
      }
      if (V.mode === 'command' && cmd) return onCommandResult(ev);
      if (Date.now() < ignoreUntil) { consumed = ev.results.length - 1; return; }
      if (V.mode !== 'wake') return;
      // in attesa: conta solo «Hey Cicciopasticcio», tutto il resto viene ignorato
      for (let i = Math.max(ev.resultIndex, consumed + 1); i < ev.results.length; i++) {
        const text = norm(bestAlt(ev.results[i]));
        if (text && WAKE_RE.test(text)) { openCommand(i, true); onCommandResult(ev); return; }
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
      if (!wantRunning) { stop(); return; }   // nel frattempo non serviva più
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
  function openCommand(startIdx, cutWake) {
    if (LW()) LW().pause();
    V.deaf = false;
    wantRunning = true;
    cmd = { start: startIdx, carry: '', cutWake: !!cutWake, wakeOk: !cutWake, heard: false, text: '' };
    setMode('command');
    beep(880);
    if (V.onWake) V.onWake();
    clearTimeout(noSpeechTimer); clearTimeout(silenceTimer); clearTimeout(maxTimer);
    noSpeechTimer = setTimeout(endCommand, NO_SPEECH_MS);
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
    const text = c ? c.text : '';
    // niente di sensato (o la parola di attivazione era un errore di Chrome): torna in attesa senza rispondere
    if (!text || (c && c.cutWake && !c.wakeOk)) { idle(); return; }
    if (isStop(text)) { V.rest(); return; }
    beep(660);                    // «ho capito»
    hold();                       // da qui prende solo «stop» finché non ha risposto
    if (V.onCommand) V.onCommand(text);
  }

  function startCommandWindow() {
    openCommand(running && V.wakeMode !== 'local' ? lastLen : null, false);
  }

  // Torna ad aspettare «Hey Cicciopasticcio» (e nient'altro)
  function idle() {
    V.deaf = false;
    setMode(V.wakeEnabled ? 'wake' : 'off');
    ignoreUntil = Date.now() + 700;
    consumed = lastLen - 1;
    if (LW()) {
      // In modalità locale Chrome ascolta solo la richiesta: poi si spegne e resta il modello locale
      wantRunning = false; stop();
      if (V.wakeEnabled) { LW().strict = false; LW().resume(); }
      return;
    }
    if (V.wakeEnabled) { wantRunning = true; start(); }
    else { wantRunning = false; stop(); }
  }

  // Mentre pensa e risponde non prende richieste: sente solo «stop»
  // (con l'ascolto continuo spento, per esempio sul telefono, il microfono si spegne e lo zittisci toccando la sfera)
  function stopOnly() {
    if (LW()) LW().pause();
    if (V.wakeEnabled) { wantRunning = true; start(); }
    else { wantRunning = false; stop(); }
  }
  function hold() {
    V.deaf = true;
    heldAt = Date.now();
    closeCommand();
    stopOnly();
    V.mode = V.wakeEnabled ? 'wake' : 'off';
  }
  V.hold = hold;
  // Chiamato dall'app quando ha finito con la richiesta: torna ad aspettare la parola
  V.release = function () {
    if (!V.deaf) return;
    V.deaf = false;
    if (!V.speaking && V.mode !== 'command') idle();
  };
  // sicurezza: se per qualche motivo resta senza ascoltare troppo a lungo, torna ad aspettare la parola
  setInterval(() => { if (V.deaf && !V.speaking && Date.now() - heldAt > 120000) idle(); }, 10000);

  V.wakeMode = 'chrome';   // 'chrome' oppure 'local'
  V.serverStt = true;      // con la parola insegnata, la richiesta la capisce il server (Azure)

  let sttToken = 0;
  const TAIL_RE = /^[\s,.!?]*(?:(?:c|ch)ic+[iy]?[oa]?\s*-?\s*)?pa[sz]+ti?c+h?i?(?:n?[oa])?\b[\s,.!?]*/i;
  function cleanStt(t) { return norm(stripWake(t).replace(TAIL_RE, '')).replace(/^[,.\s]+/, '').replace(/\.$/, ''); }

  // checkWake: la registrazione parte un po' prima della parola, e se «Cicciopasticcio» non c'è era un falso attivamento
  async function serverCommand(fromSeq, vadFromSeq, checkWake) {
    const L = LW();
    const my = ++sttToken;
    V.deaf = false;
    L.pause();
    setMode('command');
    beep(880);
    if (V.onWake) V.onWake();
    const r = await L.record({ fromSeq, vadFromSeq, noSpeechMs: 6500, silenceMs: 750, maxMs: 15000 });
    if (my !== sttToken || r.cancelled) return;
    if (!r.speech) return idle();
    beep(660);                    // «ho capito»: smette di ascoltare la richiesta
    hold();                       // da qui prende solo «stop» finché non ha risposto
    if (V.onInterim) V.onInterim('…');
    let raw = '';
    try { raw = await V.api.stt(r.wav); } catch (e) { if (V.onError) V.onError('Non sono riuscito a capire: riprova.'); }
    if (my !== sttToken) return;
    if (checkWake && raw && !LOOSE_WAKE.test(raw)) { V.lastIgnored = raw; return idle(); }   // nessuno l'ha chiamato
    const text = cleanStt(raw);
    if (!text) return idle();
    if (isStop(text)) { V.rest(); return; }
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
      if (V.mode !== 'wake' || V.deaf || V.speaking) return;
      if (useServer()) { serverCommand(L.detectSeq - 2, L.detectSeq + 2, false); return; }
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
    const quiet = () => V.deaf || V.speaking;
    if (LW()) {
      if (V.wakeEnabled) {
        setMode('wake');
        LW().start().then((ok) => { if (!ok) { V.wakeEnabled = false; setMode('off'); } else if (!quiet()) LW().resume(); else LW().pause(); });
      } else if (V.mode !== 'command') { setMode('off'); LW().stop(); }
      return;
    }
    if (V.wakeEnabled) { setMode('wake'); if (!quiet()) { wantRunning = true; start(); } }
    else if (V.mode !== 'command') { setMode('off'); wantRunning = false; stop(); }
  };

  V.pushToTalk = function () {
    if (!SR) { if (V.onError) V.onError('Questo browser non supporta il riconoscimento vocale: usa Chrome.'); return; }
    V.stopSpeaking();
    V.deaf = false;
    if (useServer()) { serverCommand(LW().seq() + 1, LW().seq() + 1, false); return; }
    wantRunning = true;
    startCommandWindow();
    start();
  };

  V.cancel = function () { sttToken++; if (LW() && LW().cancelRecord) LW().cancelRecord(); closeCommand(); idle(); };

  // «Hey Cicciopasticcio stop»: smette di parlare e di ascoltare, e aspetta solo la parola
  V.rest = function () {
    V.restAt = Date.now();
    sttToken++; if (LW() && LW().cancelRecord) LW().cancelRecord();
    V.stopSpeaking();
    closeCommand();
    idle();
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

  // Mentre risponde si limita a dare la risposta: sente solo «stop»
  function pauseListening() {
    V.speaking = true;
    if (cmd) closeCommand();
    stopOnly();
  }
  function resumeListening() {
    V.speaking = false;
    speakingText = '';
    heldAt = Date.now();
    // se la risposta fa parte di una richiesta, torna ad ascoltare quando l'app ha finito (V.release)
    if (!V.deaf && V.mode !== 'command') idle();
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
        const parts = splitText(text, 130, 900);
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
