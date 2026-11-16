// Riordinare i brani di una cartella trascinandoli. Il nuovo ordine diventa il numero di traccia
// scritto nei file (1, 2, 3…): vale su ogni dispositivo e in ogni lettore, ed è lo stesso numero
// che si vede in "Modifica info". L'indice cambia subito; i file si riscrivono in sottofondo, uno
// alla volta e solo quelli il cui numero cambia.

import { libraryStore, updateTracks } from './library'
import { createStore } from './store'
import { canWriteTags, saveTrackInfo } from './trackInfo'

export interface OrderProgress {
  folder: number
  done: number
  total: number
}

/** A che punto è il salvataggio dell'ordine, se ce n'è uno in corso. */
export const orderStore = createStore<OrderProgress | null>(null)

/** Si può riordinare una cartella con almeno due brani, tutti mp3: negli altri file il numero non si scrive. */
export function canReorder(folderId: number): boolean {
  const library = libraryStore.get().library
  const folder = library?.folders.get(folderId)
  if (!library || !folder || folder.tracks.length < 2) return false
  return folder.tracks.every((id) => canWriteTags(library.tracks.get(id)?.name ?? ''))
}

interface Pending {
  folder: number
  number: string
  /** Il numero di prima, per rimetterlo nell'indice se il salvataggio non riesce. */
  before: string | undefined
}

/** Numeri ancora da scrivere nei file, per brano. */
const pending = new Map<number, Pending>()
let running = false
let reportError: (error: unknown) => void = () => {}

/** Oltre questo numero di file da riscrivere si chiede prima: ognuno va scaricato e ricaricato. */
const ASK_ABOVE = 20

/**
 * Sposta il brano in posizione `from` alla posizione `to` e numera di conseguenza tutta la cartella.
 * `confirm` viene chiamata se ci sono tanti file da riscrivere; `onError` se il salvataggio si ferma.
 */
export async function moveFolderTrack(
  folderId: number,
  from: number,
  to: number,
  confirm: (files: number) => Promise<boolean>,
  onError: (error: unknown) => void,
) {
  const library = libraryStore.get().library
  const folder = library?.folders.get(folderId)
  if (!library || !folder || from === to) return
  const order = [...folder.tracks]
  const [moved] = order.splice(from, 1)
  order.splice(to, 0, moved)

  const changes = new Map<number, { track: string }>()
  order.forEach((id, index) => {
    const number = String(index + 1)
    if (library.tracks.get(id)?.track !== number) changes.set(id, { track: number })
  })
  if (changes.size > ASK_ABOVE && !(await confirm(changes.size))) return
  // Durante la domanda l'indice può essere cambiato: si parte dai numeri di adesso.
  const now = libraryStore.get().library ?? library
  for (const [id, change] of changes) {
    pending.set(id, { folder: folderId, number: change.track, before: pending.get(id)?.before ?? now.tracks.get(id)?.track })
  }
  reportError = onError
  updateTracks(changes)
  void work()
}

async function work() {
  if (running) return
  running = true
  let done = 0
  try {
    for (let next = first(); next; next = first()) {
      const [id, target] = next
      orderStore.set({ folder: target.folder, done, total: done + pending.size })
      pending.delete(id)
      try {
        await saveTrackInfo(id, { track: target.number })
      } catch (error) {
        // L'indice torna come sono davvero i file: questo brano e quelli che restavano da scrivere.
        const unsaved: [number, Pending][] = [[id, target], ...pending]
        const revert = new Map(unsaved.map(([trackId, item]) => [trackId, { track: item.before }]))
        pending.clear()
        updateTracks(revert)
        reportError(error)
        return
      }
      done++
      // Il brano appena salvato mostra il numero letto da pCloud; se nel frattempo è stato trascinato
      // di nuovo, nell'indice deve restare il numero più recente.
      const newer = pending.get(id)
      if (newer) updateTracks(new Map([[id, { track: newer.number }]]))
    }
  } finally {
    running = false
    orderStore.set(null)
  }
}

const first = () => pending.entries().next().value
