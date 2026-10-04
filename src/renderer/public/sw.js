// Custom build (pwa): Orca+'s web client service worker. It makes the paired web client an
// installable app; it caches nothing, so the page always comes fresh from the paired Mac.
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})
