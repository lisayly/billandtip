// Listens for the child's attempt at the word and decides if she got it.
//
// Best case (online, and the browser exposes SpeechRecognition — true on most
// Android Chrome/WebView): we get a real transcript and fuzzy-match it against
// the word in either language.
//
// Offline (the normal case on this app, since it's meant to run with no
// connection): the Web Speech recognizer isn't usable at all — Chrome's
// implementation always calls out to Google's servers, offline dictation
// packs don't back it. We fall back to on-device voice-activity detection:
// we can hear THAT she said something and roughly how words-like it sounded,
// but not confirm WHICH word. In that mode every attempt gets warm, neutral
// feedback and is logged as "practiced" rather than right/wrong, so we never
// tell her she's wrong when we simply couldn't check.

const Speech = (() => {
  const hasRecognition = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
  let micStream = null;
  let micDenied = false;

  async function ensureMic() {
    if (micStream || micDenied) return micStream;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      micDenied = true;
    }
    return micStream;
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

  function matchesEither(transcript, wordEntry) {
    return fuzzyMatches(transcript, wordEntry.home) || fuzzyMatches(transcript, wordEntry.target);
  }

  // Set once the recognizer proves unusable on this device/connection, so we
  // stop burning three seconds of the child's patience on it every single tap.
  let recognitionUnusable = false;

  function listenWithRecognition(wordEntry, timeoutMs) {
    return new Promise((resolve) => {
      const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
      const rec = new Rec();
      rec.lang = HOME_LANG;
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
        const hit = alts.find((a) => matchesEither(a, wordEntry));
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

  // One analyser for the life of the app — old phones don't like having a new
  // AudioContext built and torn down on every tap.
  let vadAnalyser = null;
  let vadData = null;

  async function ensureAnalyser() {
    if (vadAnalyser) return vadAnalyser;
    const stream = await ensureMic();
    if (!stream) return null;
    const c = new (window.AudioContext || window.webkitAudioContext)();
    const src = c.createMediaStreamSource(stream);
    vadAnalyser = c.createAnalyser();
    vadAnalyser.fftSize = 512;
    src.connect(vadAnalyser);
    vadData = new Uint8Array(vadAnalyser.frequencyBinCount);
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
    if (hasRecognition && !recognitionUnusable && navigator.onLine) {
      const res = await listenWithRecognition(wordEntry, timeoutMs);
      // The recognizer couldn't run at all — don't let that read as a wrong
      // answer; fall through to the offline path for this attempt.
      if (res.outcome !== 'degraded') return res;
    }
    return listenWithVAD(timeoutMs);
  }

  return { listenForWord, matchesEither, ensureMic, get hasRecognition() { return hasRecognition; } };
})();
