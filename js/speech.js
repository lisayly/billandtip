// Listens for the child's attempt at the word and decides if she got it.
//
// Best case (online, and the browser exposes SpeechRecognition — Safari has it
// from iOS 14.5): we get a real transcript and fuzzy-match it against the word.
//
// Offline (the normal case here, since the app is meant to run with no
// connection): the Web Speech recognizer isn't usable — Safari's implementation
// goes out to Apple's servers, and iOS's on-device dictation isn't exposed to
// web pages. Safari also wants start() to come from a user gesture, which ours
// can't, since it follows the word playing. Either way it fails safe.
//
// So we fall back to on-device voice-activity detection: we can hear THAT she
// said something, but not confirm WHICH word. In that mode every attempt gets
// warm, neutral feedback and is logged as "practised" rather than right/wrong,
// so we never tell her she's wrong when we simply couldn't check.

const Speech = (() => {
  const hasRecognition = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
  let micStream = null;
  let micDenied = false;

  // iOS holds the audio session in record mode for as long as a mic stream is
  // live, which drops playback off the loud speaker and makes the words sound
  // faint and far away. So we take the mic only while actually listening and
  // hand it straight back.
  async function acquireMic() {
    if (micDenied) return null;
    if (micStream && micStream.getAudioTracks().some((t) => t.readyState === 'live')) {
      return micStream;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return null;
    try {
      Audio2.setAudioSession('play-and-record');
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      // Only a real refusal is permanent. Everything else — the mic being busy
      // with a call or another app, an interrupted audio session, a request
      // that collided with one already in flight — is temporary, and latching
      // on it would leave the app deaf for the rest of the session.
      if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) {
        micDenied = true;
      }
      micStream = null;
      Audio2.setAudioSession('playback');
    }
    return micStream;
  }

  function releaseMic() {
    if (micStream) {
      micStream.getTracks().forEach((t) => { try { t.stop(); } catch { /* ignore */ } });
      micStream = null;
    }
    vadSource = null; // its stream is gone; a fresh one is built next listen
    Audio2.setAudioSession('playback');
  }

  // kept for callers that just want to know whether the mic is usable
  async function ensureMic() {
    const s = await acquireMic();
    return s;
  }

  function normalize(s) {
    return s
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents
      .replace(/[^a-z]/g, '')
      .trim();
  }

  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    const row = new Array(n + 1);
    for (let j = 0; j <= n; j++) row[j] = j;
    for (let i = 1; i <= m; i++) {
      let prev = row[0];
      row[0] = i;
      for (let j = 1; j <= n; j++) {
        const tmp = row[j];
        row[j] = a[i - 1] === b[j - 1]
          ? prev
          : 1 + Math.min(prev, row[j], row[j - 1]);
        prev = tmp;
      }
    }
    return row[n];
  }

  function fuzzyMatches(transcript, target) {
    const t = normalize(transcript);
    const w = normalize(target);
    if (!t || !w) return false;
    if (t === w || t.includes(w) || w.includes(t)) return true;
    const dist = levenshtein(t, w);
    return dist <= Math.max(1, Math.floor(w.length * 0.4));
  }

  // Only the languages she actually hears count as saying it back. With
  // SPOKEN_LANGS = ['target'] that means English: if she answers "bola" for the
  // ball she gets the gentle try-again tone and hears "ball" modelled again,
  // which is the whole point of the app.
  function matchesSpoken(transcript, wordEntry) {
    return SPOKEN_LANGS.some((langKey) => fuzzyMatches(transcript, wordEntry[langKey]));
  }

  // Set once the recognizer proves unusable on this device/connection, so we
  // stop burning three seconds of the child's patience on it every single tap.
  let recognitionUnusable = false;

  function listenWithRecognition(wordEntry, timeoutMs) {
    return new Promise((resolve) => {
      const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
      const rec = new Rec();
      rec.lang = SPOKEN_LANGS[0] === 'home' ? HOME_LANG : TARGET_LANG;
      rec.continuous = false;
      rec.interimResults = false;
      rec.maxAlternatives = 3;

      let done = false;
      const finish = (outcome, transcript) => {
        if (done) return;
        done = true;
        try { rec.stop(); } catch { /* ignore */ }
        resolve({ outcome, transcript: transcript || '' });
      };

      rec.onresult = (e) => {
        const alts = Array.from(e.results[0]).map((a) => a.transcript);
        const hit = alts.find((a) => matchesSpoken(a, wordEntry));
        finish(hit ? 'correct' : 'miss', alts[0]);
      };
      rec.onerror = (e) => {
        // 'network' happens on wifi with no real internet, 'service-not-allowed'
        // and 'not-allowed' on devices where the recognizer is unavailable.
        // None of those mean she got the word wrong — hand off to the offline path.
        if (e.error === 'network' || e.error === 'service-not-allowed' || e.error === 'audio-capture') {
          recognitionUnusable = true;
          finish('degraded', '');
        } else {
          finish('silence', '');
        }
      };
      rec.onend = () => finish('silence', '');

      setTimeout(() => finish('silence', ''), timeoutMs);

      try {
        rec.start();
      } catch {
        recognitionUnusable = true;
        finish('degraded', '');
      }
    });
  }

  // One AudioContext and analyser for the life of the app — phones don't like
  // having them built and torn down on every tap. Only the source node is
  // rebuilt, because each listening turn gets a fresh mic stream.
  let vadCtx = null;
  let vadAnalyser = null;
  let vadSource = null;
  let vadData = null;

  async function ensureAnalyser() {
    const stream = await acquireMic();
    if (!stream) return null;

    if (!vadCtx) {
      vadCtx = new (window.AudioContext || window.webkitAudioContext)();
      vadAnalyser = vadCtx.createAnalyser();
      vadAnalyser.fftSize = 512;
      vadData = new Uint8Array(vadAnalyser.frequencyBinCount);
    }
    if (vadCtx.state === 'suspended') {
      try { await vadCtx.resume(); } catch { /* ignore */ }
    }
    if (!vadSource) {
      vadSource = vadCtx.createMediaStreamSource(stream);
      vadSource.connect(vadAnalyser);
    }
    return vadAnalyser;
  }

  // Voice-activity fallback: watches mic energy for a sustained burst that
  // looks like a spoken attempt. Can't tell us WHAT was said.
  async function listenWithVAD(timeoutMs) {
    const analyser = await ensureAnalyser();
    if (!analyser) return { outcome: 'unavailable', transcript: '' };

    return new Promise((resolve) => {
      const start = performance.now();
      let voicedMs = 0;
      let lastTick = start;
      const THRESHOLD = 18; // empirical energy floor above room noise

      function tick() {
        const now = performance.now();
        analyser.getByteFrequencyData(vadData);
        const energy = vadData.reduce((a, b) => a + b, 0) / vadData.length;
        if (energy > THRESHOLD) voicedMs += now - lastTick;
        lastTick = now;

        if (voicedMs > 180) {
          cancelAnimationFrame(raf);
          resolve({ outcome: 'attempted', transcript: '' });
          return;
        }
        if (now - start > timeoutMs) {
          cancelAnimationFrame(raf);
          resolve({ outcome: 'silence', transcript: '' });
          return;
        }
        raf = requestAnimationFrame(tick);
      }
      let raf = requestAnimationFrame(tick);
    });
  }

  // Returns { outcome: 'correct' | 'miss' | 'attempted' | 'silence' | 'unavailable', transcript }
  async function listenForWord(wordEntry, timeoutMs = 3200) {
    try {
      if (hasRecognition && !recognitionUnusable && navigator.onLine) {
        const res = await listenWithRecognition(wordEntry, timeoutMs);
        // The recognizer couldn't run at all — don't let that read as a wrong
        // answer; fall through to the offline path for this attempt.
        if (res.outcome !== 'degraded') return res;
      }
      return await listenWithVAD(timeoutMs);
    } finally {
      // hand the mic back so the next word plays at full volume
      releaseMic();
    }
  }

  // 0..1 loudness right now, for the recording level meter. Lets a parent SEE
  // that the microphone is picking her up instead of guessing.
  async function startLevelMeter() {
    return !!(await ensureAnalyser());
  }
  function readLevel() {
    if (!vadAnalyser || !vadData) return 0;
    vadAnalyser.getByteFrequencyData(vadData);
    const avg = vadData.reduce((a, b) => a + b, 0) / vadData.length;
    return Math.min(1, avg / 60); // 60 ≈ a normal speaking voice
  }

  return {
    listenForWord,
    matchesSpoken,
    startLevelMeter,
    readLevel,
    ensureMic,
    acquireMic,
    releaseMic,
    get hasRecognition() { return hasRecognition; },
  };
})();
