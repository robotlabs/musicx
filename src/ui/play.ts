// Far partire la musica da una pagina: il lettore si ricorda quale (per tornarci dal lettore).

import { libraryStore } from '../lib/library'
import { playerStore, playItems as playQueue, playShuffled as playQueueShuffled, type PlayerState } from '../lib/player'
import { playlistsStore } from '../lib/playlists'
import type { QItem } from '../lib/queue'
import { navigate, routeHref, routeStore, type Route } from '../lib/router'

/** Suona i brani; la coda "viene da" `source`, di solito la pagina che si sta guardando. */
export function playItems(items: QItem[], start = 0, source: Route = routeStore.get()) {
  playQueue(items, start, source)
}

export function playShuffled(items: QItem[], source: Route = routeStore.get()) {
  playQueueShuffled(items, source)
}

/** Il nome della pagina da cui suona la coda. */
export function sourceLabel(source: Route): string {
  switch (source.name) {
    case 'playlist':
      return playlistsStore.get().lists.find((list) => list.id === source.id)?.title ?? 'la playlist'
    case 'folder': {
      if (source.id === null) return 'Libreria'
      return libraryStore.get().library?.folders.get(source.id)?.name ?? 'la cartella'
    }
    case 'starred':
      return 'Preferiti'
    case 'wishlist':
      return 'Da cercare'
    case 'search':
      return source.query ? `ricerca "${source.query}"` : 'Cerca'
    case 'queue':
      return 'Coda'
    case 'youtube':
      return 'Da YouTube'
    case 'duplicates':
      return 'Doppioni'
    case 'playlists':
      return 'Playlist'
    case 'storage':
      return 'Download e spazio'
  }
}

/**
 * Dove riporta il lettore: la pagina da cui è partita la coda; se non si sa (coda partita prima di
 * questa versione, o da un'altra parte) la cartella del brano che suona.
 */
export function sourceOf(state: PlayerState): Route | null {
  if (state.source) return state.source
  const item = state.items[state.index]
  const library = libraryStore.get().library
  const parent = item ? library?.tracks.get(item.id)?.parent : undefined
  if (parent === undefined || !library) return null
  return { name: 'folder', id: parent === library.rootId ? null : parent }
}

/** Va alla pagina da cui suona la coda e porta in vista il brano che suona. */
export function goToSource() {
  const source = sourceOf(playerStore.get())
  if (!source) return
  navigate(source)
  revealPlaying(routeHref(source))
}

/** Aspetta che la pagina sia quella giusta (e i brani caricati), poi centra la riga del brano che suona. */
function revealPlaying(href: string) {
  const until = Date.now() + 4000
  let settled = 0
  const tick = () => {
    if (routeHref(routeStore.get()) === href && ++settled > 2) {
      const row = document.querySelector('.content .row.active')
      if (row) {
        row.scrollIntoView({ block: 'center' })
        return
      }
    }
    if (Date.now() < until) setTimeout(tick, 50)
  }
  setTimeout(tick, 50)
}
