// Le playlist sono le "collection" native di pCloud: nessun file da sincronizzare,
// e quelle create qui compaiono anche nell'app ufficiale di pCloud.

import { libraryStore, stripExtension } from './library'
import { collections, type RawCollection, type RawMeta } from './pcloud'
import type { QItem } from './queue'
import { createStore } from './store'

export interface Playlist {
  id: number
  name: string
  count: number
}

export interface PlaylistTrack extends QItem {
  /** Posizione dentro la playlist secondo pCloud (da 1). */
  position: number
  /** Cartella che contiene il file, se nota. */
  parent: number | null
}

interface PlaylistsState {
  lists: Playlist[]
  loaded: boolean
  error: string | null
  /** Brani delle playlist aperte, per id. */
  tracks: Record<number, PlaylistTrack[] | undefined>
}

export const playlistsStore = createStore<PlaylistsState>({ lists: [], loaded: false, error: null, tracks: {} })

const collator = new Intl.Collator('it', { numeric: true, sensitivity: 'base' })

const toPlaylist = (raw: RawCollection): Playlist => ({ id: raw.id, name: raw.name, count: raw.items })

function toTrack(raw: RawMeta, index: number): PlaylistTrack {
  const parent = raw.parentfolderid ?? null
  const folder = parent === null ? undefined : libraryStore.get().library?.folders.get(parent)
  return {
    id: raw.fileid!,
    file: raw.name,
    title: raw.title?.trim() || stripExtension(raw.name),
    sub: raw.artist?.trim() || folder?.name || '',
    position: raw.position ?? index + 1,
    parent,
  }
}

const message = (error: unknown) => (error instanceof Error ? error.message : 'Errore sconosciuto.')

export async function refreshPlaylists() {
  try {
    const raw = await collections.list()
    const lists = raw
      .filter((collection) => !collection.system)
      .map(toPlaylist)
      .sort((a, b) => collator.compare(a.name, b.name))
    playlistsStore.set((state) => ({ ...state, lists, loaded: true, error: null }))
  } catch (error) {
    playlistsStore.set((state) => ({ ...state, loaded: true, error: message(error) }))
  }
}

/** Rilegge i brani di una playlist da pCloud (che resta la fonte di verità). */
export async function loadPlaylist(id: number) {
  const raw = await collections.details(id)
  const tracks = (raw.contents ?? [])
    .filter((item) => item.fileid !== undefined)
    .map(toTrack)
    .sort((a, b) => a.position - b.position)
  playlistsStore.set((state) => ({
    ...state,
    tracks: { ...state.tracks, [id]: tracks },
    lists: state.lists.map((list) => (list.id === id ? { ...list, name: raw.name, count: tracks.length } : list)),
  }))
}

export async function createPlaylist(name: string): Promise<number> {
  const created = await collections.create(name)
  await refreshPlaylists()
  return created.id
}

export async function renamePlaylist(id: number, name: string) {
  await collections.rename(id, name)
  await refreshPlaylists()
}

export async function deletePlaylist(id: number) {
  await collections.remove(id)
  playlistsStore.set((state) => ({
    ...state,
    lists: state.lists.filter((list) => list.id !== id),
    tracks: { ...state.tracks, [id]: undefined },
  }))
}

// Le modifiche alle playlist vanno a pCloud una alla volta, nell'ordine in cui le fa l'utente.
// A schermo invece si vedono subito; la lista vera si rilegge quando la fila è vuota.

let chain: Promise<unknown> = Promise.resolve()
let pending = 0

function serial<T>(task: () => Promise<T>): Promise<T> {
  pending += 1
  const run = chain.then(task, task)
  chain = run.then(
    () => {},
    () => {},
  )
  return run.finally(() => {
    pending -= 1
  })
}

/** Rilegge da pCloud, ma solo quando non ci sono altre modifiche in fila (eviterebbe salti a schermo). */
async function settle(id: number) {
  if (pending > 0) return
  await Promise.all([loadPlaylist(id), refreshPlaylists()]).catch(() => {})
}

const setTracks = (id: number, change: (tracks: PlaylistTrack[]) => PlaylistTrack[]) =>
  playlistsStore.set((state) => {
    const tracks = state.tracks[id]
    return tracks ? { ...state, tracks: { ...state.tracks, [id]: change(tracks) } } : state
  })

/** Aggiunge brani in fondo. Restituisce quanti sono entrati (i doppioni vengono scartati da pCloud). */
export async function addToPlaylist(id: number, fileIds: number[]): Promise<number> {
  try {
    return await serial(async () => {
      let added = 0
      // A blocchi, per non superare la lunghezza massima dell'URL.
      for (let start = 0; start < fileIds.length; start += 150) {
        const results = await collections.link(id, fileIds.slice(start, start + 150))
        added += results.filter((result) => result.result === 0).length
      }
      return added
    })
  } finally {
    await settle(id)
  }
}

export async function removeFromPlaylist(id: number, fileId: number) {
  setTracks(id, (tracks) => tracks.filter((track) => track.id !== fileId))
  try {
    await serial(() => collections.unlink(id, fileId))
  } finally {
    await settle(id)
  }
}

/** Sposta un brano da un indice all'altro (indici della lista mostrata, da 0). */
export async function movePlaylistTrack(id: number, from: number, to: number) {
  const tracks = playlistsStore.get().tracks[id]
  if (!tracks || from === to || !tracks[from] || !tracks[to]) return
  const movedId = tracks[from].id
  const targetId = tracks[to].id
  // Subito a schermo, poi pCloud.
  setTracks(id, (current) => {
    const moved = current.find((track) => track.id === movedId)
    if (!moved) return current
    const reordered = current.filter((track) => track !== moved)
    reordered.splice(to, 0, moved)
    return reordered
  })
  try {
    await serial(async () => {
      // Le posizioni si leggono dallo stato reale, che comprende le modifiche precedenti in fila.
      const fresh = (await collections.details(id)).contents ?? []
      const positionOf = (fileId: number) => fresh.find((item) => item.fileid === fileId)?.position
      const item = positionOf(movedId)
      const position = positionOf(targetId)
      if (item !== undefined && position !== undefined && item !== position) {
        await collections.move(id, movedId, item, position)
      }
    })
  } finally {
    await settle(id)
  }
}

export function resetPlaylists() {
  playlistsStore.set({ lists: [], loaded: false, error: null, tracks: {} })
}
