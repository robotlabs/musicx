// Service worker minimo: tiene in cache l'app (non la musica), così si apre anche con rete lenta.
// Pagina: prima la rete, poi la cache. File in assets/ (nomi con hash, non cambiano mai): prima la cache.
// Le richieste a pCloud non passano mai di qui.

const CACHE = 'musicx-shell-v2'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(
      // GitHub Pages dice al browser di tenere la pagina 10 minuti: "no-cache" la fa sempre
      // ricontrollare (costa una risposta 304), altrimenti dopo un aggiornamento si vede la vecchia.
      fetch(request.url, { cache: 'no-cache', credentials: 'same-origin' })
        .then((response) => {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put('./', copy))
          return response
        })
        .catch(() => caches.match('./').then((cached) => cached || Response.error())),
    )
    return
  }

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response.ok && url.pathname.includes('/assets/')) {
            const copy = response.clone()
            caches.open(CACHE).then((cache) => cache.put(request, copy))
          }
          return response
        }),
    ),
  )
})
