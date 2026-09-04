// End-to-end smoke test. Needs playwright + a static server on :8899:
//   npx http-server -p 8899 -c-1 .   &&   node test/smoke.js
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node22/lib/node_modules/playwright'));
}

const URL = 'http://127.0.0.1:8899/index.html';
const results = [];
function check(name, ok, extra = '') {
  results.push({ name, ok, extra });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
}

(async () => {
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
  check('tap plays home word then English word', spoken.length === 2 && spoken[0].endsWith(':home') && spoken[1].endsWith(':target'), JSON.stringify(spoken));

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
  check('parent mode lists every word in both languages', groups === 30 && rows === 60, `${groups} words, ${rows} rows`);

  // 10. recording own voice: record -> stored -> used instead of synthesis
  const recResult = await page.evaluate(async () => {
    const id = WORDS[0].id;
    const rowBtn = document.querySelectorAll('.word-group')[0].querySelectorAll('.pbtn-record')[0];
    rowBtn.click();
    await new Promise(r => setTimeout(r, 900));
    rowBtn.click();
    await new Promise(r => setTimeout(r, 700));
    const blob = await Storage.getRecording(id, 'home');
    const url = await Audio2.getRecordingURL(id, 'home');
    return { hasBlob: !!blob, size: blob ? blob.size : 0, usesRecording: !!url };
  });
  check('parent can record own voice, app then prefers it',
    recResult.hasBlob && recResult.size > 0 && recResult.usesRecording, JSON.stringify(recResult));

  // 11. synthesis fallback for words with no recording
  const fallback = await page.evaluate(async () => {
    const w = WORDS[3];
    let usedSynthesis = false;
    const orig = window.speechSynthesis.speak;
    window.speechSynthesis.speak = function (u) { usedSynthesis = u.text; };
    await Audio2.playWord(w, 'target');
    window.speechSynthesis.speak = orig;
    return { usedSynthesis, expected: w.target };
  });
  check('falls back to speech synthesis when not recorded',
    fallback.usedSynthesis === fallback.expected, JSON.stringify(fallback));

  // 12. offline: service worker caches the app
  await page.click('#parent-close');
  const swReady = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return !!reg.active;
  });
  check('service worker active', swReady);

  const cached = await page.evaluate(async () => {
    const cache = await caches.open('palavras-v1');
    const keys = await cache.keys();
    return keys.map(k => new URL(k.url).pathname);
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
  p3.on('request', (r) => { if (!r.url().startsWith('http://127.0.0.1:8899') && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) externalReqs.push(r.url()); });
  await p3.goto(URL, { waitUntil: 'networkidle' });
  check('makes zero external requests', externalReqs.length === 0, externalReqs.join(', '));

  // 16. fuzzy matching is toddler-generous but not a pushover
  const matching = await page.evaluate(() => {
    const ball = WORDS.find(w => w.id === 'bola');
    return {
      exactHome: Speech.matchesEither('bola', ball),
      exactTarget: Speech.matchesEither('ball', ball),
      babble: Speech.matchesEither('bó', ball),
      caps: Speech.matchesEither('Bola.', ball),
      accented: Speech.matchesEither('maça', WORDS.find(w => w.id === 'maca')),
      wrong: Speech.matchesEither('cachorro', ball),
      nonsense: Speech.matchesEither('telefone', ball),
    };
  });
  check('accepts either language + toddler approximations, rejects wrong words',
    matching.exactHome && matching.exactTarget && matching.babble && matching.caps &&
    matching.accented && !matching.wrong && !matching.nonsense,
    JSON.stringify(matching));

  // 17. a bundled voice file (recorded on a computer) beats synthesis
  const bundledCtx = await browser.newContext({ viewport: { width: 412, height: 869 }, serviceWorkers: 'block' });
  const bundledPage = await bundledCtx.newPage();
  await bundledPage.route('**/audio/manifest.json', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ext: '.mp3', home: ['gato'], target: [] }) }));
  await bundledPage.goto(URL, { waitUntil: 'networkidle' });
  await bundledPage.waitForTimeout(300);
  const bundledSrc = await bundledPage.evaluate(async () => ({
    listed: await Audio2.sourceFor('gato', 'home'),
    notListed: await Audio2.sourceFor('lua', 'home'),
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

  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
