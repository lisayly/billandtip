// Update test:  node test/update.js
//
// Publishing a new version has to actually reach a phone that already has the
// app installed, without anyone reinstalling anything and without losing the
// recordings. This failed silently once already — the service worker refetched
// the files through the browser's own HTTP cache, so the new cache filled up
// with the old app and the phone kept showing the previous version.
//
// Runs against a throwaway copy of the app so it can publish changes mid-test,
// and serves it with a max-age header like a real host (GitHub Pages) sends.

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node22/lib/node_modules/playwright'));
}
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SRC = path.join(__dirname, '..');
const COPY = ['index.html', 'css', 'js', 'icons', 'audio', 'sw.js', 'manifest.json'];
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.txt': 'text/plain',
};

const results = [];
function check(name, ok, extra = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'palavras-update-'));
for (const entry of COPY) {
  fs.cpSync(path.join(SRC, entry), path.join(root, entry), { recursive: true });
}

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.join(root, rel);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'max-age=600', // what a real static host sends
  });
  fs.createReadStream(file).pipe(res);
});

function publish(edits) {
  for (const [rel, [from, to]] of Object.entries(edits)) {
    const f = path.join(root, rel);
    const before = fs.readFileSync(f, 'utf8');
    const after = before.replace(from, to);
    if (before === after) throw new Error(`update test could not patch ${rel}`);
    fs.writeFileSync(f, after);
  }
}

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/index.html`;

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();

  // 1. she installs it, records her voice, builds up some progress
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.evaluate(async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: 'audio/mp4' });
    await Storage.saveRecording('bola', SPOKEN_LANGS[0], blob);
    Progress.recordCorrect('bola');
    Progress.recordMiss('gato');
  });
  const installed = await page.evaluate(() => WORDS[0].target);
  check('installs and runs the published version', installed === 'ball', `word = "${installed}"`);

  // 2. a new version is published
  publish({
    'js/words.js': [/target: 'ball'/, "target: 'football'"],
    'sw.js': [/const CACHE = 'palavras-v\d+';/, "const CACHE = 'palavras-test-next';"],
  });

  // 3. she opens the app again — one launch should be enough
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const afterOneLaunch = await page.evaluate(() => WORDS[0].target);
  check('a published update reaches the phone on the next launch',
    afterOneLaunch === 'football', `word = "${afterOneLaunch}"`);

  // 4. nothing of hers was lost in the process
  const kept = await page.evaluate(async () => ({
    recording: !!(await Storage.getRecording('bola', SPOKEN_LANGS[0])),
    tracked: Object.keys(Progress.snapshot()).length,
  }));
  check('her recordings and progress survive the update',
    kept.recording && kept.tracked > 0, JSON.stringify(kept));

  // 5. old caches are cleaned up rather than piling up on her phone
  const cacheNames = await page.evaluate(() => caches.keys());
  check('the superseded cache is deleted',
    cacheNames.length === 1 && cacheNames[0] === 'palavras-test-next', JSON.stringify(cacheNames));

  // 6. and the updated app still works with no connection at all
  await context.setOffline(true);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const offline = await page.evaluate(() => WORDS[0].target);
  check('the updated app still runs offline', offline === 'football', `word = "${offline}"`);

  await browser.close();
  server.close();
  fs.rmSync(root, { recursive: true, force: true });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} update checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('HARNESS ERROR', e);
  try { server.close(); fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(2);
});
