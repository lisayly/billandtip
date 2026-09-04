(function () {
  const cardEl = document.getElementById('card');
  const emojiEl = document.getElementById('emoji');
  const ringEl = document.getElementById('listen-ring');
  const edgeLeft = document.getElementById('edge-left');
  const edgeRight = document.getElementById('edge-right');
  const parentDot = document.getElementById('parent-dot');

  let queue = Progress.buildRotation(WORDS);
  let index = 0;
  let sequenceToken = 0; // bumped to cancel any in-flight sequence
  let unlocked = false;

  function currentWord() {
    return queue[index];
  }

  function render() {
    const w = currentWord();
    const colorIndex = WORDS.findIndex((x) => x.id === w.id);
    cardEl.style.backgroundColor = CARD_COLORS[colorIndex % CARD_COLORS.length];
    emojiEl.textContent = w.emoji;
    ringEl.classList.remove('active');
  }

  function goNext() {
    cancelSequence();
    index += 1;
    if (index >= queue.length) {
      queue = Progress.buildRotation(WORDS);
      index = 0;
    }
    render();
  }

  function goPrev() {
    cancelSequence();
    index -= 1;
    if (index < 0) index = queue.length - 1;
    render();
  }

  function cancelSequence() {
    sequenceToken += 1;
    Audio2.stopAll();
    ringEl.classList.remove('active');
  }

  function wait(ms, token) {
    return new Promise((resolve) => {
      setTimeout(() => resolve(sequenceToken === token), ms);
    });
  }

  async function runSequence() {
    const token = ++sequenceToken;
    Audio2.stopAll();
    const w = currentWord();

    bounce();

    // Whatever SPOKEN_LANGS says — English only by default.
    for (const langKey of SPOKEN_LANGS) {
      await Audio2.playWord(w, langKey);
      if (sequenceToken !== token) return;
      if (!(await wait(220, token))) return;
    }
    if (!(await wait(150, token))) return;

    ringEl.classList.add('active');
    const { outcome } = await Speech.listenForWord(w, 3200);
    if (sequenceToken !== token) return;
    ringEl.classList.remove('active');

    if (outcome === 'correct') {
      Progress.recordCorrect(w.id);
      Audio2.playCorrectChime();
    } else if (outcome === 'miss') {
      Progress.recordMiss(w.id);
      Audio2.playTryAgainChime();
      if (!(await wait(700, token))) return;
      // model the word again, in the language she's learning
      await Audio2.playWord(w, SPOKEN_LANGS[0]);
    } else if (outcome === 'attempted') {
      Progress.recordPracticed(w.id);
      Audio2.playAttemptChime();
    }
    // 'silence' / 'unavailable': no pressure, no feedback — just wait for the next tap
  }

  function bounce() {
    cardEl.classList.add('tapped');
    setTimeout(() => cardEl.classList.remove('tapped'), 150);
  }

  // Runs on the first touch. Audio2.unlock() must be called synchronously here,
  // straight out of the gesture — on iOS anything played after an await is
  // silently dropped, so this is what makes the app audible at all.
  // The mic is deliberately NOT opened here; it's taken only while listening.
  function unlockOnce() {
    if (unlocked) return;
    unlocked = true;
    Audio2.unlock();
    requestFullscreen();
    requestWakeLock();
  }

  cardEl.addEventListener('pointerup', (e) => {
    if (e.target === edgeLeft || e.target === edgeRight || e.target === parentDot) return;
    unlockOnce();
    runSequence();
  });

  edgeLeft.addEventListener('pointerup', () => { unlockOnce(); goPrev(); });
  edgeRight.addEventListener('pointerup', () => { unlockOnce(); goNext(); });

  // swipe support across the whole app as an alternative to the edge zones
  let touchStartX = null;
  document.getElementById('app').addEventListener('touchstart', (e) => {
    touchStartX = e.changedTouches[0].clientX;
  }, { passive: true });
  document.getElementById('app').addEventListener('touchend', (e) => {
    if (touchStartX === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    touchStartX = null;
    if (Math.abs(dx) > 60) {
      unlockOnce();
      if (dx < 0) goNext(); else goPrev();
    }
  }, { passive: true });

  // hidden parent-mode gesture: long-press the near-invisible corner dot
  let pressTimer = null;
  parentDot.addEventListener('pointerdown', () => {
    unlockOnce(); // so parent mode's play buttons are audible on iOS too
    pressTimer = setTimeout(() => {
      cancelSequence();
      if (navigator.vibrate) navigator.vibrate(40);
      ParentPanel.open();
    }, 2500);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((evt) => {
    parentDot.addEventListener(evt, () => clearTimeout(pressTimer));
  });

  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelSequence();
  });

  function requestFullscreen() {
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req) req.call(el).catch(() => {});
  }

  let wakeLock = null;
  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    } catch { /* unsupported on this device — fine */ }
  }
  document.addEventListener('visibilitychange', async () => {
    if (wakeLock !== null && document.visibilityState === 'visible') {
      requestWakeLock();
    }
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }

  render();
})();
