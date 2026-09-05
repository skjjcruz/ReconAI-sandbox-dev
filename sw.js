const CACHE_NAME = 'reconai-scout-mobile-shell-v20260905';

// App-shell navigation docs to precache on install so repeat visits paint
// without waiting on the network. Resolved against the SW scope (/ReconAI/).
// Content-hashed build assets (JS/CSS/icons) are NOT listed here — their names
// aren't known at author time; they're immutable and get cached on first hit
// via the cache-first branch below.
const SHELL_URLS = ['./', './index.html'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(SHELL_URLS).catch(() => {})) // tolerate a missing entry
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Vite emits content-hashed, immutable assets: '<name>-<hash>.<ext>'. The hash
// changes whenever the bytes change, so these can be cached forever.
const HASHED_ASSET = /-[A-Za-z0-9_]{6,}\.(?:js|css|woff2?|ttf|png|jpg|jpeg|gif|svg|webp|json)$/i;

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // API calls: network only (freshness; large payloads are cached app-side).
  if (url.hostname.includes('sleeper') || url.hostname.includes('supabase') || url.hostname.includes('fantasycalc')) return;

  // Navigations: stale-while-revalidate the app shell — serve the cached
  // document instantly and refresh it in the background for next time, instead
  // of blocking first paint on a network round-trip every visit.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(event.request).then(cached => {
          const network = fetch(event.request).then(resp => {
            if (resp && resp.ok) cache.put(event.request, resp.clone());
            return resp;
          }).catch(() => cached || cache.match('./index.html') || cache.match('./'));
          return cached || network;
        })
      )
    );
    return;
  }

  // Immutable hashed build assets: cache-first — no network on repeat visits.
  if (url.origin === self.location.origin && HASHED_ASSET.test(url.pathname)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(event.request).then(cached => cached || fetch(event.request).then(resp => {
          if (resp && resp.ok) cache.put(event.request, resp.clone());
          return resp;
        }))
      )
    );
    return;
  }

  // Everything else: network-first, cache fallback.
  // `cache: 'no-cache'` forces a revalidation with the server on every request
  // (it sends an If-None-Match/If-Modified-Since and reuses the saved copy only
  // on a 304), so an ONLINE user is never handed a stale file from the browser's
  // lower-level HTTP cache. The saved copy is used only when the network fails
  // (offline). This is what makes a freshly pushed update reach users on reload.
  event.respondWith(
    fetch(event.request, { cache: 'no-cache' }).then(response => {
      if (response.ok) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
      }
      return response;
    }).catch(() => caches.match(event.request))
  );
});
