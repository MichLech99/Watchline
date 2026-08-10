const CACHE = 'watchline-v1'
const SHELL = ['/', '/manifest.webmanifest', '/icon.svg']
self.addEventListener('install', (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL))))
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || event.request.url.includes('/.netlify/functions/')) return
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request).then((cached) => cached || caches.match('/'))))
})
