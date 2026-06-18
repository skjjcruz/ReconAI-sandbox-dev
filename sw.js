const CACHE_NAME = 'reconai-scout-mobile-shell-v20260618';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // API calls: network only
  if (url.hostname.includes('sleeper') || url.hostname.includes('supabase') || url.hostname.includes('fantasycalc')) return;

  // Everything else: network first, cache fallback.
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
