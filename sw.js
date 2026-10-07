// Service worker: keeps the app shell available offline. It never touches requests to other origins (Firebase).
// Caches are per origin, and a github.io address hosts every repository of the same person, so the cache name carries the
// scope (the repository's path): another copy of the app or another project never meets this one's cache.
const VERSION = 'b3930d0f69';
const SCOPE = new URL(self.registration.scope);
const PREFIX = 'wochenspiel:' + SCOPE.pathname + ':';
const CACHE = PREFIX + VERSION;
const INDEX = new URL('./index.html', SCOPE).href;
const ROOT = SCOPE.href;
const SHELL = ['./index.html', './manifest.json', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png'];
const MARK = 'name="ws-build"';              // present in the first bytes of the real page (see build.mjs)

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()));
});

// Only the real page may replace the stored copy: right address, HTML, and our marker. A 404 page, a captive portal's
// login page or any other file that happens to be opened inside the scope must never become "the app".
async function remember(response) {
  try {
    if (!response || !response.ok || response.type === 'opaque') return;
    if (!/text\/html/i.test(response.headers.get('content-type') || '')) return;
    const text = await response.clone().text();
    if (text.slice(0, 4096).indexOf(MARK) < 0) return;
    await (await caches.open(CACHE)).put(INDEX, response);
  } catch (e) { /* the stored copy stays as it was */ }
}

// The app page: ask the network first (cheap 304 when nothing changed). When the network is silent for 4 s, unreachable, or
// answers with an error (a hiccup at the host must not replace the app with an error page), the stored copy is used.
async function page(request, event) {
  let answer = null;
  const fresh = fetch(request, { cache: 'no-cache' }).then(res => {
    answer = res;
    event.waitUntil(remember(res.clone()));
    if (!res.ok) throw new Error('status ' + res.status);
    return res;
  });
  fresh.catch(() => { /* handled below */ });
  try {
    return await Promise.race([fresh, new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), 4000))]);
  } catch (e) {
    event.waitUntil(fresh.catch(() => null));
    const stored = await (await caches.open(CACHE)).match(INDEX);
    return stored || answer || Response.error();
  }
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    const here = url.origin + url.pathname;
    if (here === ROOT || here === INDEX) event.respondWith(page(req, event));      // other pages in the scope: plain network
    return;
  }
  event.respondWith(caches.open(CACHE).then(c => c.match(req)).then(hit => hit || fetch(req)));
});
