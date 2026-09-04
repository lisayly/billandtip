// Caches the whole app on first visit so it runs with no connection at all
// afterwards. There are no external requests anywhere in this app — no CDNs,
// no fonts, no analytics — so this list is the entire thing.

const CACHE = 'palavras-v2';

const ASSETS = [
  './',
  'index.html',
  'manifest.json',
  'css/style.css',
  'js/words.js',
  'js/storage.js',
  'js/audio.js',
  'js/speech.js',
  'js/progress.js',
  'js/parent.js',
  'js/app.js',
  'icons/icon-192.png',
  'icons/apple-touch-icon.png',
  'icons/icon-512.png',
];

// Any voice files listed in audio/manifest.json get cached too, so bundled
// recordings are available offline just like the app itself.
async function bundledAudioAssets() {
  try {
    const res = await fetch('audio/manifest.json', { cache: 'no-cache' });
    const m = await res.json();
    const ext = m.ext || '.mp3';
    return ['home', 'target'].flatMap((lang) =>
      (m[lang] || []).map((id) => `audio/${lang}/${id}${ext}`)
    ).concat(['audio/manifest.json']);
  } catch {
    return [];
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS);
    const audio = await bundledAudioAssets();
    // tolerate a mis-listed filename rather than failing the whole install
    await Promise.all(audio.map((url) => cache.add(url).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // The audio manifest is meant to be edited (when voice files are added), so
  // it's network-first: pick up changes when there's a connection, fall back to
  // the cached copy when there isn't.
  if (url.pathname.endsWith('/audio/manifest.json')) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(event.request);
        const cache = await caches.open(CACHE);
        cache.put(event.request, fresh.clone());
        return fresh;
      } catch {
        return (await caches.match(event.request)) || new Response('{}', { headers: { 'Content-Type': 'application/json' } });
      }
    })());
    return;
  }

  event.respondWith(
    caches.match(event.request).then((hit) => {
      if (hit) return hit;
      return fetch(event.request).catch(() => caches.match('index.html'));
    })
  );
});
