const CACHE = 'aion-shell-2.5.4-20260805';
const SHELL = [
  '/', '/index.html', '/styles-base.css', '/styles-ui.css', '/brain-signal.css', '/config.js',
  '/app-core.js', '/app-brain-signal.js', '/app-render-a.js', '/app-render-b.js',
  '/app-chat-a.js', '/app-chat-b.js', '/app-tools.js', '/app-boot.js',
  '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || ['/healthz', '/readyz'].includes(url.pathname)) {
    event.respondWith(fetch(request));
    return;
  }
  if (request.mode === 'navigate' || /\.(?:js|css|html)$/.test(url.pathname) || url.pathname === '/config.js') {
    event.respondWith(fetch(request, { cache: 'no-store' }).then((response) => {
      if (response.ok) caches.open(CACHE).then((cache) => cache.put(request, response.clone()));
      return response;
    }).catch(() => caches.match(request).then((cached) => cached || caches.match('/index.html'))));
    return;
  }
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
    if (response.ok) caches.open(CACHE).then((cache) => cache.put(request, response.clone()));
    return response;
  })));
});
