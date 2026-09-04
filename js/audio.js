// Plays a word: the parent's own recording when one exists, speech synthesis
// otherwise. Also generates the tiny feedback chimes with the Web Audio API so
// no sound assets are needed at all (everything works with zero network calls).
//
// iOS note — this file is shaped by two Safari rules:
//   1. Audio may only be *started* from inside a user gesture. Everything we
//      play happens after an await (IndexedDB lookups), which is outside the
//      gesture, so unlock() primes all three engines synchronously on the very
//      first tap and we reuse those primed objects forever after.
//   2. A media element is unlocked individually, so we keep ONE <audio> element
//      for the life of the app rather than doing `new Audio()` per word.

const Audio2 = (() => {
  let actx = null;
  function ctx() {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    return actx;
  }

  // The one <audio> element, unlocked on first tap and reused for every
  // recorded/bundled word from then on.
  const sharedEl = new window.Audio();
  sharedEl.preload = 'auto';
  sharedEl.playsInline = true;
  sharedEl.setAttribute('playsinline', '');

  const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

  let unlocked = false;

  // Must be called synchronously from inside a real touch handler, before any
  // await. Without this, iOS plays absolutely nothing and gives no error.
  function unlock() {
    if (unlocked) return;
    unlocked = true;

    // Let audio out even when the ringer switch is on silent (iOS 16.4+).
    setAudioSession('playback');

    // 1. Web Audio (the feedback chimes)
    try {
      const c = ctx();
      const buf = c.createBuffer(1, 1, 22050);
      const src = c.createBufferSource();
      src.buffer = buf;
      src.connect(c.destination);
      src.start(0);
    } catch { /* ignore */ }

    // 2. the shared media element (recorded words)
    try {
      sharedEl.src = SILENT_WAV;
      const p = sharedEl.play();
      if (p && p.then) p.then(() => sharedEl.pause()).catch(() => {});
    } catch { /* ignore */ }

    // 3. speech synthesis (the words we didn't record)
    try {
      if (window.speechSynthesis) {
        window.speechSynthesis.getVoices();
        const u = new SpeechSynthesisUtterance('');
        u.volume = 0;
        window.speechSynthesis.speak(u);
      }
    } catch { /* ignore */ }
  }

  // iOS 16.4+ lets a page declare what its audio is for. 'playback' ignores the
  // silent switch; 'play-and-record' is needed while the mic is open, and keeps
  // output on the loud speaker instead of dropping to the earpiece.
  function setAudioSession(type) {
    try {
      if (navigator.audioSession) navigator.audioSession.type = type;
    } catch { /* not supported — nothing to do */ }
  }

  // in-memory cache of blob -> object URL so we don't re-read IndexedDB every tap
  const urlCache = new Map();

  async function getRecordingURL(wordId, langKey) {
    const cacheKey = recKey(wordId, langKey);
    if (urlCache.has(cacheKey)) return urlCache.get(cacheKey);
    const blob = await Storage.getRecording(wordId, langKey);
    if (!blob) {
      urlCache.set(cacheKey, null);
      return null;
    }
    const url = URL.createObjectURL(blob);
    urlCache.set(cacheKey, url);
    return url;
  }

  function recKey(wordId, langKey) {
    return `${wordId}:${langKey}`;
  }

  function invalidateCache(wordId, langKey) {
    urlCache.delete(recKey(wordId, langKey));
  }

  let currentUtterance = null;

  function stopAll() {
    try {
      sharedEl.pause();
    } catch { /* ignore */ }
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    currentUtterance = null;
  }

  function playRecording(url) {
    return new Promise((resolve) => {
      stopAll();
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      sharedEl.onended = finish;
      sharedEl.onerror = finish;
      sharedEl.src = url;
      try {
        const p = sharedEl.play();
        if (p && p.catch) p.catch(finish);
      } catch {
        finish();
      }
      // never hang the sequence on a clip that won't fire its events
      setTimeout(finish, 6000);
    });
  }

  function speak(text, lang) {
    return new Promise((resolve) => {
      if (!window.speechSynthesis) return resolve();
      stopAll();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      u.rate = 0.85; // a touch slower, easier for a toddler to catch
      u.pitch = 1.05;
      currentUtterance = u;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      window.speechSynthesis.speak(u);
      // Some Android WebView TTS stacks silently no-op if voices aren't
      // loaded yet; guard so playback never hangs forever.
      setTimeout(resolve, 4000);
    });
  }

  // Optional voice files bundled with the app (recorded on a computer instead
  // of in parent mode). See audio/README.txt.
  let bundled = { ext: '.mp3', home: [], target: [] };
  fetch('audio/manifest.json')
    .then((r) => r.json())
    .then((m) => { bundled = { ext: m.ext || '.mp3', home: m.home || [], target: m.target || [] }; })
    .catch(() => { /* no bundled audio — synthesis handles it */ });

  function bundledURL(wordId, langKey) {
    return bundled[langKey] && bundled[langKey].includes(wordId)
      ? `audio/${langKey}/${wordId}${bundled.ext}`
      : null;
  }

  // wordEntry: {id, home, target}; langKey: 'home' | 'target'
  // Own voice wins over a bundled file, which wins over speech synthesis.
  async function playWord(wordEntry, langKey) {
    const recorded = await getRecordingURL(wordEntry.id, langKey);
    if (recorded) {
      await playRecording(recorded);
      return;
    }
    const file = bundledURL(wordEntry.id, langKey);
    if (file) {
      await playRecording(file);
      return;
    }
    const lang = langKey === 'home' ? HOME_LANG : TARGET_LANG;
    await speak(wordEntry[langKey], lang);
  }

  function tone(freq, startTime, duration, gain = 0.18) {
    const c = ctx();
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, startTime);
    g.gain.linearRampToValueAtTime(gain, startTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    osc.connect(g).connect(c.destination);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.05);
  }

  function playCorrectChime() {
    const c = ctx();
    const now = c.currentTime;
    // bright little ascending arpeggio
    tone(523.25, now, 0.18);
    tone(659.25, now + 0.1, 0.18);
    tone(783.99, now + 0.2, 0.28);
  }

  function playTryAgainChime() {
    const c = ctx();
    const now = c.currentTime;
    // soft two-note dip, never harsh or punishing
    tone(392.0, now, 0.22, 0.13);
    tone(329.63, now + 0.16, 0.3, 0.13);
  }

  function playAttemptChime() {
    // used offline when we can only tell "she said something", not right/wrong
    const c = ctx();
    const now = c.currentTime;
    tone(440.0, now, 0.16, 0.12);
    tone(523.25, now + 0.12, 0.22, 0.12);
  }

  // 'recording' (own voice) | 'file' (bundled) | 'synthesis' — for the parent panel
  async function sourceFor(wordId, langKey) {
    if (await getRecordingURL(wordId, langKey)) return 'recording';
    if (bundledURL(wordId, langKey)) return 'file';
    return 'synthesis';
  }

  return {
    playWord,
    sourceFor,
    unlock,
    setAudioSession,
    stopAll,
    playCorrectChime,
    playTryAgainChime,
    playAttemptChime,
    invalidateCache,
    getRecordingURL,
    speak,
  };
})();
