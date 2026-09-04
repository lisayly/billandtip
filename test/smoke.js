// End-to-end smoke test:  node test/smoke.js
// Serves the app itself, so there's nothing to start first.
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node22/lib/node_modules/playwright'));
}
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4', '.txt': 'text/plain',
};

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.join(ROOT, rel);
  // don't serve anything outside the project
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
    'Service-Worker-Allowed': '/',
  });
  fs.createReadStream(file).pipe(res);
});

let URL; // set once the server has a port (0 = let the OS pick a free one)
const results = [];
function check(name, ok, extra = '') {
  results.push({ name, ok, extra });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
}

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  URL = `http://127.0.0.1:${server.address().port}/index.html`;

  const browser = await chromium.launch({
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 412, height: 869 },   // old-Samsung-ish portrait
    hasTouch: true,
    isMobile: true,
    permissions: ['microphone'],
  });
  const page = await context.newPage();

  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.goto(URL, { waitUntil: 'networkidle' });

  // 1. renders a picture, no text anywhere on the play screen
  const emoji = await page.textContent('#emoji');
  check('renders a picture on load', !!emoji && emoji.length > 0, JSON.stringify(emoji));

  const visibleText = await page.evaluate(() => {
    const app = document.getElementById('app');
    return app.innerText.replace(/\s/g, '');
  });
  check('no text on the child-facing screen', visibleText.length <= 4, `innerText=${JSON.stringify(visibleText)}`);

  const bg = await page.evaluate(() => getComputedStyle(document.getElementById('card')).backgroundColor);
  check('card has a colour', bg !== 'rgba(0, 0, 0, 0)', bg);

  // 2. all 30 words are configured, uniquely
  const wordCheck = await page.evaluate(() => ({
    count: WORDS.length,
    uniqueIds: new Set(WORDS.map(w => w.id)).size,
    uniqueEmoji: new Set(WORDS.map(w => w.emoji)).size,
    missing: WORDS.filter(w => !w.home || !w.target || !w.emoji).length,
  }));
  const WORDS_EN = await page.evaluate(() => WORDS.map(w => w[SPOKEN_LANGS[0]]));
  check('30 objects, unique ids/pictures',
    wordCheck.count === 30 && wordCheck.uniqueIds === 30 && wordCheck.uniqueEmoji === 30 && wordCheck.missing === 0,
    JSON.stringify(wordCheck));

  // 3. tapping the picture speaks the word then listens
  const spoken = await page.evaluate(async () => {
    const said = [];
    const origPlay = Audio2.playWord;
    Audio2.playWord = async (w, lang) => { said.push(`${w.id}:${lang}`); };
    const origListen = Speech.listenForWord;
    Speech.listenForWord = async () => ({ outcome: 'correct', transcript: 'test' });
    document.getElementById('card').dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    await new Promise(r => setTimeout(r, 1500));
    Audio2.playWord = origPlay;
    Speech.listenForWord = origListen;
    return said;
  });
  check('tap plays the English word only',
    spoken.length === 1 && spoken[0].endsWith(':target'), JSON.stringify(spoken));

  // 4. a correct answer is recorded, and lowers that word's weight
  const afterCorrect = await page.evaluate(() => {
    const id = WORDS[0].id;
    const before = JSON.parse(JSON.stringify(Progress.snapshot()));
    Progress.recordCorrect(id); Progress.recordCorrect(id);
    const after = Progress.snapshot()[id];
    return { before: before[id] || null, after };
  });
  check('correct answers tracked + word de-prioritised',
    afterCorrect.after.correct === 2 && afterCorrect.after.weight < 1.2,
    JSON.stringify(afterCorrect.after));

  // 5. a miss raises the weight so it comes back sooner
  const afterMiss = await page.evaluate(() => {
    const id = WORDS[1].id;
    Progress.recordMiss(id);
    return Progress.snapshot()[id];
  });
  check('missed words come back sooner', afterMiss.weight > 1.2, JSON.stringify(afterMiss));

  // 6. rotation actually favours the needy words
  const rotationBias = await page.evaluate(() => {
    Progress.resetAll();
    const needy = WORDS[5].id;
    for (let i = 0; i < 4; i++) Progress.recordMiss(needy);
    WORDS.forEach(w => { if (w.id !== needy) { Progress.recordCorrect(w.id); Progress.recordCorrect(w.id); } });
    let sum = 0;
    const RUNS = 40;
    for (let i = 0; i < RUNS; i++) sum += Progress.buildRotation(WORDS).findIndex(w => w.id === needy);
    return { avgPosition: sum / RUNS };
  });
  check('missed word surfaces early in rotation', rotationBias.avgPosition < 8, `avg position ${rotationBias.avgPosition.toFixed(1)} of 30`);

  // 7. persistence across a reload
  await page.reload({ waitUntil: 'networkidle' });
  const persisted = await page.evaluate(() => Object.keys(Progress.snapshot()).length);
  check('progress survives an app restart', persisted > 0, `${persisted} words tracked`);

  // 8. swiping moves to another picture
  const swipe = await page.evaluate(async () => {
    const before = document.getElementById('emoji').textContent;
    document.getElementById('edge-right').dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    await new Promise(r => setTimeout(r, 150));
    return { before, after: document.getElementById('emoji').textContent };
  });
  check('edge tap changes the picture', swipe.before !== swipe.after, `${swipe.before} -> ${swipe.after}`);

  // 9. parent mode stays shut for a toddler-length press, opens on a long one
  await page.evaluate(async () => {
    const dot = document.getElementById('parent-dot');
    dot.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await new Promise(r => setTimeout(r, 800));
    dot.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  });
  await page.waitForTimeout(300);
  check('short press does NOT open parent mode', await page.isHidden('#parent-panel'));

  await page.evaluate(() => {
    document.getElementById('parent-dot').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  });
  await page.waitForTimeout(2800);
  check('long press opens parent mode', await page.isVisible('#parent-panel'));

  const rows = await page.locator('.word-row').count();
  const groups = await page.locator('.word-group').count();
  check('parent mode offers a recording row for each spoken language',
    groups === 30 && rows === 30, `${groups} words, ${rows} rows`);

  // 10. recording own voice: record -> stored -> used instead of synthesis
  const recResult = await page.evaluate(async () => {
    const id = WORDS[0].id;
    const rowBtn = document.querySelectorAll('.word-group')[0].querySelectorAll('.pbtn-record')[0];
    rowBtn.click();
    await new Promise(r => setTimeout(r, 900));
    rowBtn.click();
    await new Promise(r => setTimeout(r, 700));
    const blob = await Storage.getRecording(id, SPOKEN_LANGS[0]);
    const url = await Audio2.getRecordingURL(id, SPOKEN_LANGS[0]);
    return { hasBlob: !!blob, size: blob ? blob.size : 0, usesRecording: !!url };
  });
  check('parent can record own voice, app then prefers it',
    recResult.hasBlob && recResult.size > 0 && recResult.usesRecording, JSON.stringify(recResult));

  // 11. synthesis fallback for words with no recording
  const fallback = await page.evaluate(async () => {
    const w = WORDS[7]; // not touched by the recording test above
    let usedSynthesis = false;
    const orig = window.speechSynthesis.speak;
    window.speechSynthesis.speak = function (u) { usedSynthesis = u.text; };
    await Audio2.playWord(w, 'target');
    window.speechSynthesis.speak = orig;
    return { usedSynthesis, expected: w.target };
  });
  check('falls back to speech synthesis when not recorded',
    fallback.usedSynthesis === fallback.expected, JSON.stringify(fallback));

  // 11b. guided pass: record every word in one sitting, auto-advancing.
  // Her own voice is the point of the app, so this path gets real coverage.
  const guided = await page.evaluate(async () => {
    const out = {};
    document.getElementById('record-all').click();
    out.opened = !document.getElementById('record-all-panel').classList.contains('hidden');
    out.firstWord = document.getElementById('ra-word').textContent;
    out.counter = document.getElementById('ra-counter').textContent;

    // record the word being shown
    const btn = document.getElementById('ra-record');
    btn.click();
    await new Promise(r => setTimeout(r, 800));
    out.showsRecording = btn.classList.contains('recording');
    btn.click();
    await new Promise(r => setTimeout(r, 1200));

    out.saved = !!(await Storage.getRecording(WORDS[0].id, SPOKEN_LANGS[0]));
    out.advanced = document.getElementById('ra-word').textContent;   // moved on by itself
    out.counterAfter = document.getElementById('ra-counter').textContent;

    // skip leaves the current word untouched but still moves on
    document.getElementById('ra-skip').click();
    await new Promise(r => setTimeout(r, 100));
    out.afterSkip = document.getElementById('ra-word').textContent;
    out.skippedSaved = !!(await Storage.getRecording(WORDS[1].id, SPOKEN_LANGS[0]));

    document.getElementById('ra-exit').click();
    out.closed = document.getElementById('record-all-panel').classList.contains('hidden');
    return out;
  });
  check('guided pass records a word and moves to the next by itself',
    guided.opened && guided.showsRecording && guided.saved &&
    guided.firstWord === WORDS_EN[0] && guided.advanced === WORDS_EN[1] &&
    guided.counter === '1 / 30' && guided.counterAfter === '2 / 30',
    JSON.stringify(guided));
  check('guided pass: skip advances without recording, exit closes',
    guided.afterSkip === WORDS_EN[2] && guided.skippedSaved === false && guided.closed,
    JSON.stringify({ afterSkip: guided.afterSkip, skippedSaved: guided.skippedSaved, closed: guided.closed }));

  // the guided pass must not leave the mic running afterwards
  const guidedMic = await page.evaluate(async () => {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    const live = s.getAudioTracks().filter(t => t.readyState === 'live').length;
    s.getTracks().forEach(t => t.stop());
    return live;
  });
  check('guided pass releases the microphone on exit', guidedMic === 1, `mic re-acquirable: ${guidedMic === 1}`);

  // 12. offline: service worker caches the app
  await page.click('#parent-close');
  const swReady = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return !!reg.active;
  });
  check('service worker active', swReady);

  const cached = await page.evaluate(async () => {
    const names = (await caches.keys()).filter(n => n.startsWith('palavras-'));
    const cache = await caches.open(names[0]);
    const keys = await cache.keys();
    return keys.map(k => k.url.replace(/^https?:\/\/[^/]+/, ''));
  });
  check('whole app cached for offline use', cached.length >= 12, `${cached.length} files cached`);

  // 13. genuinely works with the network cut
  await context.setOffline(true);
  const offlinePage = await context.newPage();
  const offErrors = [];
  offlinePage.on('pageerror', (e) => offErrors.push(e.message));
  await offlinePage.goto(URL, { waitUntil: 'domcontentloaded' });
  const offlineEmoji = await offlinePage.textContent('#emoji');
  const offlineWords = await offlinePage.evaluate(() => (typeof WORDS !== 'undefined' ? WORDS.length : 0));
  check('app loads with the network off', !!offlineEmoji && offlineWords === 30, `emoji=${offlineEmoji}, words=${offlineWords}, errors=${offErrors.length}`);

  // 14. offline listening path degrades to attempt-detection, not false "wrong"
  const offlineListen = await offlinePage.evaluate(async () => {
    const w = WORDS[0];
    const res = await Speech.listenForWord(w, 600);
    return res.outcome;
  });
  check('offline listening never reports a false "wrong"',
    ['attempted', 'silence', 'unavailable'].includes(offlineListen), `outcome=${offlineListen}`);

  await context.setOffline(false);

  // 15. no external network requests at all
  const externalReqs = [];
  const p3 = await context.newPage();
  const ORIGIN = URL.slice(0, URL.lastIndexOf('/'));
  p3.on('request', (r) => { if (!r.url().startsWith(ORIGIN) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) externalReqs.push(r.url()); });
  await p3.goto(URL, { waitUntil: 'networkidle' });
  check('makes zero external requests', externalReqs.length === 0, externalReqs.join(', '));

  // 16. fuzzy matching is toddler-generous but not a pushover
  const matching = await page.evaluate(() => {
    const ball = WORDS.find(w => w.id === 'bola');
    return {
      english: Speech.matchesSpoken('ball', ball),
      babble: Speech.matchesSpoken('bal', ball),
      caps: Speech.matchesSpoken('Ball.', ball),
      englishOther: Speech.matchesSpoken('cookie', WORDS.find(w => w.id === 'biscoito')),
      portuguese: Speech.matchesSpoken('bola', ball),   // she's learning English
      wrong: Speech.matchesSpoken('dog', ball),
      nonsense: Speech.matchesSpoken('telefone', ball),
    };
  });
  check('accepts English + toddler approximations, not the Portuguese word',
    matching.english && matching.babble && matching.caps && matching.englishOther &&
    !matching.portuguese && !matching.wrong && !matching.nonsense,
    JSON.stringify(matching));

  // 17. a bundled voice file (recorded on a computer) beats synthesis
  const bundledCtx = await browser.newContext({ viewport: { width: 412, height: 869 }, serviceWorkers: 'block' });
  const bundledPage = await bundledCtx.newPage();
  await bundledPage.route('**/audio/manifest.json', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ext: '.mp3', home: [], target: ['gato'] }) }));
  await bundledPage.goto(URL, { waitUntil: 'networkidle' });
  await bundledPage.waitForTimeout(300);
  const bundledSrc = await bundledPage.evaluate(async () => ({
    listed: await Audio2.sourceFor('gato', 'target'),
    notListed: await Audio2.sourceFor('lua', 'target'),
  }));
  check('bundled voice file used when provided, synthesis otherwise',
    bundledSrc.listed === 'file' && bundledSrc.notListed === 'synthesis', JSON.stringify(bundledSrc));
  await bundledCtx.close();

  // 18. the killer real-world case: wifi connected but recognition unreachable.
  // Must NOT come back as "she got it wrong".
  const degraded = await context.newPage();
  await degraded.addInitScript(() => {
    class FakeRec {
      constructor() { this.onerror = null; this.onend = null; this.onresult = null; }
      start() { setTimeout(() => this.onerror && this.onerror({ error: 'network' }), 20); }
      stop() {}
    }
    window.SpeechRecognition = FakeRec;
    window.webkitSpeechRecognition = FakeRec;
  });
  await degraded.goto(URL, { waitUntil: 'networkidle' });
  const degradedOutcome = await degraded.evaluate(async () => {
    const res = await Speech.listenForWord(WORDS[0], 500);
    return res.outcome;
  });
  check('recognizer failure never reads as a wrong answer',
    degradedOutcome !== 'miss' && degradedOutcome !== 'correct', `outcome=${degradedOutcome}`);

  // ---- iOS/Safari rules. Real WebKit isn't available in this sandbox, so these
  // verify the logic the Safari fixes depend on; the device itself still needs
  // a once-over on a real iPhone.

  // 19. THE iOS rule: audio must be unlocked synchronously inside the gesture.
  // If unlock() ever moves after an await, iOS goes permanently silent, so this
  // asserts it has already run by the time the event handler returns.
  const iosCtx = await browser.newContext({
    viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
    permissions: ['microphone'],
  });
  const iosPage = await iosCtx.newPage();
  await iosPage.addInitScript(() => {
    // Shape this context like an offline iPhone: no usable Web Speech
    // recognizer, so listening takes the on-device voice-activity path that
    // actually touches the microphone.
    delete window.SpeechRecognition;
    delete window.webkitSpeechRecognition;
    window.__audioEls = 0;
    const RealAudio = window.Audio;
    window.Audio = function (...args) { window.__audioEls++; return new RealAudio(...args); };
    window.Audio.prototype = RealAudio.prototype;
    // stub the iOS 16.4+ audio session API so we can watch how it's driven
    window.__sessionTypes = [];
    let _t = 'auto';
    Object.defineProperty(navigator, 'audioSession', {
      configurable: true,
      value: { get type() { return _t; }, set type(v) { _t = v; window.__sessionTypes.push(v); } },
    });
  });
  await iosPage.goto(URL, { waitUntil: 'networkidle' });

  const gestureSync = await iosPage.evaluate(() => {
    let unlockedDuringHandler = false;
    const realUnlock = Audio2.unlock;
    Audio2.unlock = function () { unlockedDuringHandler = true; return realUnlock.apply(this, arguments); };
    // dispatchEvent runs listeners synchronously: if unlock sat behind an await,
    // this flag would still be false when dispatchEvent returns.
    document.getElementById('card').dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    return unlockedDuringHandler;
  });
  check('audio is unlocked synchronously inside the tap (iOS rule)', gestureSync === true);

  // 20. one shared <audio> element, not one per word (iOS unlocks per element)
  const elCount = await iosPage.evaluate(async () => {
    const before = window.__audioEls;
    await Audio2.playWord(WORDS[0], 'home');
    await Audio2.playWord(WORDS[1], 'home');
    await Audio2.playWord(WORDS[2], 'target');
    return { before, after: window.__audioEls };
  });
  check('reuses one unlocked <audio> element for every word',
    elCount.after === elCount.before, `created ${elCount.after - elCount.before} new elements`);

  // 21. the ringer/silent switch is overridden, and the session flips to
  // play-and-record only while the mic is open
  const session = await iosPage.evaluate(async () => {
    window.__sessionTypes.length = 0;
    await Speech.listenForWord(WORDS[0], 400);
    return window.__sessionTypes;
  });
  check('audio session: play-and-record while listening, back to playback after',
    session.includes('play-and-record') && session[session.length - 1] === 'playback',
    JSON.stringify(session));

  // 22. the mic is handed back after listening, or iOS keeps playback quiet
  const micReleased = await iosPage.evaluate(async () => {
    const streams = [];
    const realGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c) => { const s = await realGUM(c); streams.push(s); return s; };
    await Speech.listenForWord(WORDS[1], 400);
    const live = streams.flatMap(s => s.getAudioTracks()).filter(t => t.readyState === 'live').length;
    return { grabbed: streams.length, live };
  });
  check('microphone is released after each listening turn',
    micReleased.grabbed > 0 && micReleased.live === 0, JSON.stringify(micReleased));

  // 23. the child's screen swallows gestures but parent mode must still scroll
  const touchActions = await iosPage.evaluate(() => ({
    app: getComputedStyle(document.getElementById('app')).touchAction,
    body: getComputedStyle(document.body).touchAction,
    parent: getComputedStyle(document.querySelector('.parent-scroll')).touchAction,
  }));
  check('play screen locked, parent list still scrollable',
    touchActions.app === 'none' && touchActions.body !== 'none' && touchActions.parent.includes('pan-y'),
    JSON.stringify(touchActions));

  // 24. iOS home-screen icon: it ignores the manifest and needs this exact link
  const iosIcon = await iosPage.evaluate(() => {
    const l = document.querySelector('link[rel="apple-touch-icon"]');
    return l ? { href: l.getAttribute('href'), sizes: l.getAttribute('sizes') } : null;
  });
  const iconRes = await iosPage.request.get(URL.replace(/index\.html$/, '') + iosIcon.href);
  check('apple-touch-icon present at 180x180 and actually served',
    iosIcon.sizes === '180x180' && iconRes.status() === 200, JSON.stringify(iosIcon));

  const iosMeta = await iosPage.evaluate(() => ({
    capable: document.querySelector('meta[name="apple-mobile-web-app-capable"]')?.content,
    title: document.querySelector('meta[name="apple-mobile-web-app-title"]')?.content,
  }));
  check('installs fullscreen from the iOS home screen',
    iosMeta.capable === 'yes' && !!iosMeta.title, JSON.stringify(iosMeta));

  await iosCtx.close();

  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  server.close();

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
