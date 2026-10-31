// Service Worker für die Homescreen-App: hält nur die Offline-Seite vor, alles andere geht ungecacht ans Netz.
const CACHE = 'nerdpool-offline-v1';

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.add('/offline.html')).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.mode !== 'navigate') {
    return;
  }
  event.respondWith(fetch(event.request).catch(() => caches.match('/offline.html')));
});
