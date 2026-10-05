const CACHE = 'watchline-v2-protected-library'
const SHELL = ['/', '/manifest.webmanifest', '/icon.svg']
self.addEventListener('install', (event) => event.waitUntil((async () => {
  const cache = await caches.open(CACHE)
  await cache.addAll(SHELL)
  const html = await (await cache.match('/')).text()
  const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((match) => new URL(match[1], self.location.origin)).filter((url) => url.origin === self.location.origin)
  await cache.addAll(assets.map((url) => url.href))
  await self.skipWaiting()
})()))
self.addEventListener('activate', (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('watchline-') && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim())))
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin || event.request.url.includes('/.netlify/functions/')) return
  event.respondWith(fetch(event.request).then((response) => {
    if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then((cache) => cache.put(event.request, copy))) }
    return response
  }).catch(async () => {
    const cache = await caches.open(CACHE)
    return await cache.match(event.request) || (event.request.mode === 'navigate' ? await cache.match('/') : undefined) || Response.error()
  }))
})
