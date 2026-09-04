// Plays a word: the parent's own recording when one exists, speech synthesis
// otherwise. Also generates the tiny feedback chimes with the Web Audio API so
// no sound assets are needed at all (everything works with zero network calls).

const Audio2 = (() => {
  let actx = null;
  function ctx() {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    return actx;
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

  let currentEl = null;
  let currentUtterance = null;

  function stopAll() {
    if (currentEl) {
      currentEl.pause();
      currentEl = null;
    }
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    currentUtterance = null;
  }

  function playRecording(url) {
    return new Promise((resolve) => {
      stopAll();
      const el = new window.Audio(url);
      currentEl = el;
      el.onended = () => resolve();
      el.onerror = () => resolve();
      el.play().catch(() => resolve());
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
    stopAll,
    playCorrectChime,
    playTryAgainChime,
    playAttemptChime,
    invalidateCache,
    getRecordingURL,
    speak,
  };
})();
