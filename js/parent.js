// Parent mode: hidden behind a long-press on the corner dot. This is the only
// screen with text on it, and the child never sees it. Here you record your own
// voice for any word (in either language) — anything you don't record falls back
// to speech synthesis automatically.

const ParentPanel = (() => {
  const panel = document.getElementById('parent-panel');
  const listEl = document.getElementById('word-list');
  const statusEl = document.getElementById('mic-status');
  const closeBtn = document.getElementById('parent-close');
  const resetBtn = document.getElementById('reset-progress');

  let built = false;
  let recordedKeys = new Set();
  let activeRecorder = null;
  let activeButton = null;

  const LANG_LABEL = { home: 'Português', target: 'English' };
  const SOURCE_LABEL = {
    recording: 'sua voz',
    file: 'arquivo gravado',
    synthesis: 'voz sintética',
  };

  function sourceText(langKey, source) {
    return `${LANG_LABEL[langKey]} · ${SOURCE_LABEL[source]}`;
  }

  function pickMimeType() {
    // Safari/iOS only produces mp4-aac; Chrome prefers webm-opus. Ask in an
    // order where each browser hits its own native format first.
    const candidates = [
      'audio/mp4',
      'audio/mp4;codecs=mp4a.40.2',
      'audio/aac',
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/3gpp',
    ];
    if (!window.MediaRecorder) return null;
    for (const type of candidates) {
      if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(type)) return type;
    }
    return ''; // let the browser choose its default
  }

  function masteryClass(stat) {
    if (!stat || stat.attempts === 0) return '';
    const rate = stat.correct / stat.attempts;
    if (stat.correct >= 3 && rate >= 0.7) return 'mastered';
    return 'learning';
  }

  function build() {
    const stats = Progress.snapshot();
    listEl.innerHTML = '';

    WORDS.forEach((w) => {
      const group = document.createElement('div');
      group.className = 'word-group';

      const title = document.createElement('div');
      title.className = 'word-group-title';
      const dot = document.createElement('span');
      dot.className = 'mastery-dot ' + masteryClass(stats[w.id]);
      title.appendChild(dot);
      title.appendChild(document.createTextNode(`${w.emoji}  ${w.home} / ${w.target}`));
      group.appendChild(title);

      // one row per language she actually hears (English only by default);
      // the Portuguese word still shows in the title so you can find the word fast
      SPOKEN_LANGS.forEach((langKey) => {
        group.appendChild(buildRow(w, langKey));
      });

      listEl.appendChild(group);
    });
  }

  function buildRow(w, langKey) {
    const key = `${w.id}:${langKey}`;
    const row = document.createElement('div');
    row.className = 'word-row';

    const em = document.createElement('div');
    em.className = 'lang-emoji';
    em.textContent = langKey === 'home' ? '🇧🇷' : '🇬🇧';
    row.appendChild(em);

    const text = document.createElement('div');
    text.className = 'lang-text';
    const primary = document.createElement('span');
    primary.className = 'primary';
    primary.textContent = w[langKey];
    const secondary = document.createElement('span');
    secondary.className = 'secondary';
    secondary.textContent = sourceText(langKey, recordedKeys.has(key) ? 'recording' : 'synthesis');
    if (!recordedKeys.has(key)) {
      Audio2.sourceFor(w.id, langKey).then((src) => { secondary.textContent = sourceText(langKey, src); });
    }
    text.appendChild(primary);
    text.appendChild(secondary);
    row.appendChild(text);

    const actions = document.createElement('div');
    actions.className = 'lang-actions';

    const recBtn = document.createElement('button');
    recBtn.className = 'pbtn pbtn-record';
    recBtn.textContent = '●';
    recBtn.title = 'Gravar';
    recBtn.addEventListener('click', () => toggleRecord(w, langKey, recBtn, secondary));

    const playBtn = document.createElement('button');
    playBtn.className = 'pbtn pbtn-play';
    playBtn.textContent = '▶';
    playBtn.title = 'Ouvir';
    playBtn.addEventListener('click', () => Audio2.playWord(w, langKey));

    const clearBtn = document.createElement('button');
    clearBtn.className = 'pbtn pbtn-clear';
    clearBtn.textContent = '✕';
    clearBtn.title = 'Apagar gravação';
    clearBtn.addEventListener('click', async () => {
      await Storage.deleteRecording(w.id, langKey);
      Audio2.invalidateCache(w.id, langKey);
      recordedKeys.delete(key);
      const src = await Audio2.sourceFor(w.id, langKey);
      secondary.textContent = sourceText(langKey, src);
    });

    actions.appendChild(recBtn);
    actions.appendChild(playBtn);
    actions.appendChild(clearBtn);
    row.appendChild(actions);

    return row;
  }

  async function toggleRecord(w, langKey, btn, secondaryEl) {
    if (activeRecorder) {
      // second tap on the same button stops; tapping another word stops too
      stopRecording();
      if (activeButton === btn) return;
    }

    const stream = await Speech.acquireMic();
    if (!stream) {
      statusEl.textContent = 'Sem acesso ao microfone. Permita o microfone nas configurações do navegador.';
      return;
    }

    const mimeType = pickMimeType();
    if (mimeType === null) {
      statusEl.textContent = 'Este navegador não permite gravar áudio. Use a voz sintética.';
      return;
    }

    let recorder;
    try {
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch {
      statusEl.textContent = 'Não foi possível iniciar a gravação neste aparelho.';
      return;
    }

    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = async () => {
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      if (blob.size > 0) {
        await Storage.saveRecording(w.id, langKey, blob);
        Audio2.invalidateCache(w.id, langKey);
        recordedKeys.add(`${w.id}:${langKey}`);
        secondaryEl.textContent = sourceText(langKey, 'recording');
      }
      btn.classList.remove('recording');
      btn.textContent = '●';
      statusEl.textContent = '';
      activeRecorder = null;
      activeButton = null;
      // give the mic back so the ▶ preview plays out of the loud speaker
      Speech.releaseMic();
    };

    activeRecorder = recorder;
    activeButton = btn;
    btn.classList.add('recording');
    btn.textContent = '■';
    statusEl.textContent = `Gravando "${w[langKey]}" — toque de novo para parar.`;
    recorder.start();

    // safety net: never leave the mic recording forever
    setTimeout(() => { if (activeRecorder === recorder) stopRecording(); }, 5000);
  }

  function stopRecording() {
    if (activeRecorder && activeRecorder.state !== 'inactive') {
      activeRecorder.stop();
    }
  }

  async function open() {
    recordedKeys = await Storage.listRecordedKeys().catch(() => new Set());
    build();
    built = true;
    panel.classList.remove('hidden');
  }

  function close() {
    stopRecording();
    Speech.releaseMic();
    Audio2.stopAll();
    panel.classList.add('hidden');
  }

  closeBtn.addEventListener('click', close);
  resetBtn.addEventListener('click', () => {
    if (window.confirm('Apagar todo o progresso das palavras? As gravações continuam salvas.')) {
      Progress.resetAll();
      if (built) build();
    }
  });

  // ---------------------------------------------------------------------
  // Guided pass: record all 30 words in one sitting. Same storage and same
  // precedence as the per-word buttons — this is only a nicer way in, because
  // her own voice is the point of the app and doing it thirty times through a
  // scrolling list is a chore.
  // ---------------------------------------------------------------------

  const RA = {
    panel: document.getElementById('record-all-panel'),
    emoji: document.getElementById('ra-emoji'),
    word: document.getElementById('ra-word'),
    sub: document.getElementById('ra-sub'),
    counter: document.getElementById('ra-counter'),
    status: document.getElementById('ra-status'),
    recordBtn: document.getElementById('ra-record'),
    playBtn: document.getElementById('ra-play'),
    skipBtn: document.getElementById('ra-skip'),
    exitBtn: document.getElementById('ra-exit'),
    level: document.getElementById('ra-level-fill'),
    help: document.getElementById('ra-help'),
  };

  // Spelled out rather than a bare failure, because this is the step where a
  // parent gets stuck with no idea why nothing happened.
  const MIC_BLOCKED_HELP =
    'O iPhone está bloqueando o microfone. Toque em "aA" na barra do Safari → '
    + 'Ajustes do site → Microfone → Permitir. Se você abriu pelo ícone da tela '
    + 'de início, abra uma vez pelo Safari para liberar e depois volte.';

  let levelTimer = null;

  function startLevelMeter() {
    Speech.startLevelMeter();
    stopLevelMeter();
    levelTimer = setInterval(() => {
      RA.level.style.width = `${Math.round(Speech.readLevel() * 100)}%`;
    }, 80);
  }

  function stopLevelMeter() {
    clearInterval(levelTimer);
    levelTimer = null;
    RA.level.style.width = '0%';
  }

  const LANG = SPOKEN_LANGS[0];
  let raIndex = 0;
  let raRecorder = null;
  let raStopTimer = null;

  async function raRender() {
    const w = WORDS[raIndex];
    RA.help.textContent = '';
    RA.emoji.textContent = w.emoji;
    RA.word.textContent = w[LANG];
    RA.sub.textContent = LANG === 'target' ? w.home : w.target;
    RA.counter.textContent = `${raIndex + 1} / ${WORDS.length}`;
    const src = await Audio2.sourceFor(w.id, LANG);
    RA.status.textContent = src === 'recording' ? '✓ já gravada com a sua voz' : '';
  }

  function raOpen() {
    raIndex = 0;
    RA.panel.classList.remove('hidden');
    raRender();
  }

  function raClose() {
    raStopRecording();
    stopLevelMeter();
    Speech.releaseMic();
    Audio2.stopAll();
    RA.panel.classList.add('hidden');
    build(); // reflect anything just recorded in the list behind
  }

  function raAdvance() {
    if (raIndex >= WORDS.length - 1) {
      raClose();
      return;
    }
    raIndex += 1;
    raRender();
  }

  function raStopRecording() {
    clearTimeout(raStopTimer);
    if (raRecorder && raRecorder.state !== 'inactive') raRecorder.stop();
  }

  async function raToggleRecord() {
    if (raRecorder) {
      raStopRecording();
      return;
    }

    const w = WORDS[raIndex];
    const stream = await Speech.acquireMic();
    if (!stream) {
      RA.status.textContent = 'Sem acesso ao microfone';
      RA.help.textContent = MIC_BLOCKED_HELP;
      return;
    }
    const mimeType = pickMimeType();
    if (mimeType === null) {
      RA.status.textContent = 'Este aparelho não permite gravar áudio';
      RA.help.textContent = 'Atualize o iOS (a gravação exige iOS 14.3 ou mais novo). '
        + 'A voz sintética continua funcionando normalmente.';
      return;
    }

    let recorder;
    try {
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch {
      RA.status.textContent = 'Não foi possível iniciar a gravação.';
      return;
    }

    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = async () => {
      raRecorder = null;
      stopLevelMeter();
      RA.recordBtn.classList.remove('recording');
      RA.recordBtn.textContent = '●';
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/mp4' });
      if (blob.size > 0) {
        await Storage.saveRecording(w.id, LANG, blob);
        Audio2.invalidateCache(w.id, LANG);
        recordedKeys.add(`${w.id}:${LANG}`);
        RA.status.textContent = '✓ gravada';
        setTimeout(raAdvance, 500); // straight on to the next word
      } else {
        RA.status.textContent = 'Não gravou nada';
        RA.help.textContent = 'Fale mais perto do telefone e olhe a barra verde — '
          + 'se ela não se mexe, o microfone não está ouvindo.';
      }
    };

    raRecorder = recorder;
    RA.recordBtn.classList.add('recording');
    RA.recordBtn.textContent = '■';
    RA.status.textContent = 'Gravando… toque para parar';
    RA.help.textContent = '';
    startLevelMeter();
    recorder.start();
    raStopTimer = setTimeout(raStopRecording, 5000);
  }

  RA.recordBtn.addEventListener('click', raToggleRecord);
  RA.playBtn.addEventListener('click', () => Audio2.playWord(WORDS[raIndex], LANG));
  RA.skipBtn.addEventListener('click', () => { raStopRecording(); raAdvance(); });
  RA.exitBtn.addEventListener('click', raClose);
  document.getElementById('record-all').addEventListener('click', raOpen);

  return { open, close, openRecordAll: raOpen };
})();
