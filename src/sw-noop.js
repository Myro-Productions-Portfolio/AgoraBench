// No-op service worker — clears all caches from previous SW versions
// Required placeholder for vite-plugin-pwa injectManifest strategy
self.__WB_MANIFEST;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});
