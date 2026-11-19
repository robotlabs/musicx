// Preferiti (★). Sono una playlist di pCloud tutta loro, "★ Preferiti", che la pagina Playlist non
// mostra: così valgono su ogni dispositivo (e si sentono anche dall'app di pCloud). La stella cambia
// subito a schermo; pCloud si aggiorna dietro, una modifica alla volta, e se non riesce si torna indietro.

import { storageKey } from './env'
import { collections, type RawCollection, type RawMeta } from './pcloud'
import type { QItem } from './queue'
import { createStore } from './store'
import { stripExtension } from './library'

export const STARRED_NAME = '★ Preferiti'

interface StarredState {
  /** La playlist di pCloud, se c'è già. */
  id: number | null
  /** In ordine di stella, dal più vecchio. */
  items: QItem[]
  ids: Set<number>
}

export const starredStore = createStore<StarredState>({ id: null, items: [], ids: new Set() })

const cacheKey = () => storageKey('starred')

function set(id: number | null, items: QItem[]) {
  starredStore.set({ id, items, ids: new Set(items.map((item) => item.id)) })
  try {
    localStorage.setItem(cacheKey(), JSON.stringify({ id, items }))
  } catch {
    // Spazio esaurito: senza rete si vedranno quelli di pCloud alla prossima apertura.
  }
}

/** All'avvio: i preferiti salvati sul dispositivo (servono senza rete), poi pCloud li riconferma. */
export function restoreStarred() {
  try {
    const saved = JSON.parse(localStorage.getItem(cacheKey()) ?? 'null') as { id: number | null; items: QItem[] } | null
    if (saved && Array.isArray(saved.items)) {
      starredStore.set({ id: saved.id ?? null, items: saved.items, ids: new Set(saved.items.map((item) => item.id)) })
    }
  } catch {
    // Copia illeggibile: si aspetta pCloud.
  }
}

export function resetStarred() {
  starredStore.set({ id: null, items: [], ids: new Set() })
  try {
    localStorage.removeItem(cacheKey())
  } catch {
    // Niente da togliere.
  }
}

const toItem = (raw: RawMeta): QItem => ({
  id: raw.fileid!,
  file: raw.name,
  title: raw.title?.trim() || stripExtension(raw.name),
  sub: raw.artist?.trim() || '',
})

// Le modifiche vanno a pCloud una dopo l'altra, nell'ordine dei clic.
let chain: Promise<unknown> = Promise.resolve()
let pending = 0
const serial = <T>(task: () => Promise<T>): Promise<T> => {
  pending += 1
  const run = chain.then(task, task)
  chain = run.catch(() => {})
  return run.finally(() => {
    pending -= 1
  })
}

/**
 * Dalla lista delle playlist di pCloud (refreshPlaylists): trova quella dei preferiti e ne rilegge i
 * brani. Se mentre si legge si è cliccata una stella, vince lo schermo.
 */
export async function syncStarred(all: RawCollection[]) {
  const found = all.find((collection) => collection.name === STARRED_NAME)
  if (!found) {
    // Cancellata altrove (o mai creata): nessun preferito.
    if (!pending) set(null, [])
    return
  }
  const raw = await collections.details(found.id)
  if (pending) return
  const items = (raw.contents ?? [])
    .filter((entry) => entry.fileid !== undefined)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map(toItem)
  set(found.id, items)
}

/** Mette o toglie la stella. Restituisce se adesso il brano è tra i preferiti. */
export async function toggleStar(item: QItem): Promise<boolean> {
  const before = starredStore.get()
  const on = !before.ids.has(item.id)
  const plain: QItem = { id: item.id, file: item.file, title: item.title, sub: item.sub }
  set(before.id, on ? [...before.items, plain] : before.items.filter((entry) => entry.id !== item.id))
  try {
    await serial(async () => {
      let id = starredStore.get().id
      if (id === null) {
        if (!on) return
        id = (await collections.create(STARRED_NAME)).id
        set(id, starredStore.get().items)
      }
      if (on) await collections.link(id, [item.id])
      else await collections.unlink(id, item.id)
    })
  } catch (error) {
    const now = starredStore.get()
    set(now.id, on ? now.items.filter((entry) => entry.id !== item.id) : [...now.items, plain])
    throw error
  }
  return on
}
