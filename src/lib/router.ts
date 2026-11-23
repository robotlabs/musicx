// Navigazione sull'hash dell'URL: così il tasto indietro (anche quello di Android) funziona da solo.

import { createStore } from './store'

export type Route =
  | { name: 'folder'; id: number | null }
  | { name: 'search'; query: string }
  | { name: 'playlists' }
  | { name: 'playlist'; id: number }
  | { name: 'queue' }
  | { name: 'storage' }
  | { name: 'duplicates' }
  | { name: 'youtube' }
  | { name: 'starred' }
  | { name: 'wishlist' }

export function parseRoute(hash: string): Route {
  const [head, ...rest] = hash.replace(/^#\/?/, '').split('/')
  const argument = rest.join('/')
  if (head === 'f' && /^\d+$/.test(argument)) return { name: 'folder', id: Number(argument) }
  if (head === 'search') {
    try {
      return { name: 'search', query: decodeURIComponent(argument) }
    } catch {
      return { name: 'search', query: '' }
    }
  }
  if (head === 'playlists') return { name: 'playlists' }
  if (head === 'p' && /^\d+$/.test(argument)) return { name: 'playlist', id: Number(argument) }
  if (head === 'queue') return { name: 'queue' }
  if (head === 'storage') return { name: 'storage' }
  if (head === 'duplicates') return { name: 'duplicates' }
  if (head === 'youtube') return { name: 'youtube' }
  if (head === 'starred') return { name: 'starred' }
  if (head === 'wishlist') return { name: 'wishlist' }
  return { name: 'folder', id: null }
}

export function routeHref(route: Route): string {
  switch (route.name) {
    case 'folder':
      return route.id === null ? '#/' : `#/f/${route.id}`
    case 'search':
      return `#/search/${encodeURIComponent(route.query)}`
    case 'playlists':
      return '#/playlists'
    case 'playlist':
      return `#/p/${route.id}`
    case 'queue':
      return '#/queue'
    case 'storage':
      return '#/storage'
    case 'duplicates':
      return '#/duplicates'
    case 'youtube':
      return '#/youtube'
    case 'starred':
      return '#/starred'
    case 'wishlist':
      return '#/wishlist'
  }
}

export const routeStore = createStore<Route>(parseRoute(location.hash))

window.addEventListener('hashchange', () => routeStore.set(parseRoute(location.hash)))

/** `replace` cambia pagina senza aggiungere una voce alla cronologia (es. mentre si digita una ricerca). */
export function navigate(route: Route, options: { replace?: boolean } = {}) {
  const href = routeHref(route)
  if (options.replace) {
    history.replaceState(null, '', href)
    routeStore.set(route)
  } else if (location.hash !== href) {
    location.hash = href
  }
}
