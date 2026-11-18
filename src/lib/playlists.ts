// Le playlist sono le "collection" native di pCloud: nessun file da sincronizzare,
// e quelle create qui compaiono anche nell'app ufficiale di pCloud.
//
// I gruppi di playlist stanno nel nome stesso: "CCCP ▸ Epica etica" è la playlist "Epica etica"
// nel gruppo "CCCP". pCloud non ha cartelle di playlist, e un file a parte non si può leggere da
// una web app (gettextfile è riservato a pcloud.com); così invece i gruppi sono gli stessi su ogni
// dispositivo e si vedono anche nell'app di pCloud.

import { storageKey } from './env'
import { libraryStore, stripExtension, trackNumber } from './library'
import { collections, type RawCollection, type RawMeta } from './pcloud'
import type { QItem } from './queue'
import { createStore } from './store'

export interface Playlist {
  id: number
  /** Nome completo su pCloud, gruppo compreso. */
  name: string
  /** Nome da mostrare, senza gruppo. */
  title: string
  group: string | null
  count: number
}

export interface PlaylistGroup {
  name: string
  lists: Playlist[]
}

const MARK = '▸'
export const GROUP_SEPARATOR = ` ${MARK} `

/** Il segno del gruppo non può stare dentro un nome, altrimenti verrebbe letto come separatore. */
export const tidyName = (text: string) => text.replaceAll(MARK, '-').replace(/\s+/g, ' ').trim()

export function splitName(name: string): { group: string | null; title: string } {
  const at = name.indexOf(MARK)
  const group = at > 0 ? name.slice(0, at).trim() : ''
  const title = at > 0 ? name.slice(at + MARK.length).trim() : ''
  return group && title ? { group, title } : { group: null, title: name }
}

export const joinName = (group: string | null, title: string) =>
  group ? `${tidyName(group)}${GROUP_SEPARATOR}${tidyName(title)}` : tidyName(title)

/** Gruppi in ordine alfabetico (ognuno con le sue playlist) e playlist fuori dai gruppi. */
export function groupPlaylists(lists: Playlist[]): { groups: PlaylistGroup[]; loose: Playlist[] } {
  const groups = new Map<string, Playlist[]>()
  const loose: Playlist[] = []
  for (const list of lists) {
    if (list.group === null) loose.push(list)
    else groups.set(list.group, [...(groups.get(list.group) ?? []), list])
  }
  return {
    groups: [...groups].map(([name, lists]) => ({ name, lists })).sort((a, b) => collator.compare(a.name, b.name)),
    loose,
  }
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

const named = (id: number, name: string, count: number): Playlist => ({ id, name, count, ...splitName(name) })

const toPlaylist = (raw: RawCollection): Playlist => named(raw.id, raw.name, raw.items)

const byTitle = (lists: Playlist[]) => [...lists].sort((a, b) => collator.compare(a.title, b.title))

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
    const lists = byTitle(raw.filter((collection) => !collection.system).map(toPlaylist))
    playlistsStore.set((state) => ({ ...state, lists, loaded: true, error: null }))
  } catch (error) {
    // Senza rete restano quelle salvate sul dispositivo.
    playlistsStore.set((state) => ({ ...state, loaded: true, error: state.lists.length ? null : message(error) }))
  }
}

// Copia sul dispositivo di playlist e brani delle playlist aperte: servono senza rete.
const cacheKey = () => storageKey('playlists')
let persisting = false

function savePlaylists() {
  const { lists, tracks, loaded } = playlistsStore.get()
  if (!loaded) return
  try {
    localStorage.setItem(cacheKey(), JSON.stringify({ lists, tracks }))
  } catch {
    // Spazio esaurito: senza rete si vedranno meno playlist.
  }
}

/** All'avvio: mostra subito le playlist salvate, poi refreshPlaylists le rilegge da pCloud. */
export function restorePlaylists() {
  try {
    const saved = JSON.parse(localStorage.getItem(cacheKey()) ?? 'null') as Pick<PlaylistsState, 'lists' | 'tracks'> | null
    if (saved && Array.isArray(saved.lists)) {
      playlistsStore.set((state) => (state.loaded ? state : { ...state, lists: saved.lists, tracks: saved.tracks ?? {}, loaded: true }))
    }
  } catch {
    // Copia illeggibile: si aspetta pCloud.
  }
  if (persisting) return
  persisting = true
  let timer = 0
  playlistsStore.subscribe(() => {
    clearTimeout(timer)
    timer = window.setTimeout(savePlaylists, 500)
  })
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
    lists: state.lists.map((list) => (list.id === id ? named(id, raw.name, tracks.length) : list)),
  }))
}

/** Crea una playlist, dentro `group` se indicato. */
export async function createPlaylist(title: string, group: string | null = null): Promise<number> {
  const created = await collections.create(joinName(group, title))
  await refreshPlaylists()
  return created.id
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
async function settle(id?: number) {
  if (pending > 0) return
  await Promise.all([id === undefined ? undefined : loadPlaylist(id), refreshPlaylists()]).catch(() => {})
}

/** Rinomina più playlist: subito a schermo, poi su pCloud una alla volta. */
async function renameMany(changes: { id: number; name: string }[]) {
  const current = new Map(playlistsStore.get().lists.map((list) => [list.id, list]))
  const real = changes.filter((change) => current.has(change.id) && current.get(change.id)!.name !== change.name)
  if (!real.length) return
  const names = new Map(real.map((change) => [change.id, change.name]))
  playlistsStore.set((state) => ({
    ...state,
    lists: byTitle(state.lists.map((list) => (names.has(list.id) ? named(list.id, names.get(list.id)!, list.count) : list))),
  }))
  try {
    await serial(async () => {
      for (const change of real) await collections.rename(change.id, change.name)
    })
  } finally {
    await settle()
  }
}

const listsWhere = (keep: (list: Playlist) => boolean) => playlistsStore.get().lists.filter(keep)

/** Cambia il nome della playlist lasciandola nel suo gruppo. */
export function renamePlaylist(id: number, title: string) {
  const list = listsWhere((item) => item.id === id)[0]
  return renameMany(list ? [{ id, name: joinName(list.group, title) }] : [])
}

/** Sposta le playlist in `group` (null = fuori dai gruppi). */
export function movePlaylistsToGroup(ids: number[], group: string | null) {
  const chosen = new Set(ids)
  return renameMany(listsWhere((list) => chosen.has(list.id)).map((list) => ({ id: list.id, name: joinName(group, list.title) })))
}

/** Rinomina un gruppo, cioè tutte le sue playlist. Con il nome di un gruppo esistente, li unisce. */
export function renameGroup(from: string, to: string) {
  return renameMany(listsWhere((list) => list.group === from).map((list) => ({ id: list.id, name: joinName(to, list.title) })))
}

/** Toglie il gruppo: le playlist restano, fuori dai gruppi. */
export function ungroup(group: string) {
  return renameMany(listsWhere((list) => list.group === group).map((list) => ({ id: list.id, name: joinName(null, list.title) })))
}

/** Cambia come si vedono dei brani nelle playlist già caricate. */
export function updatePlaylistTracks(update: (track: PlaylistTrack) => PlaylistTrack) {
  playlistsStore.set((state) => ({
    ...state,
    tracks: Object.fromEntries(Object.entries(state.tracks).map(([id, tracks]) => [id, tracks?.map(update)])),
  }))
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

/**
 * L'ordine "come nei dischi": gli album nell'ordine in cui compaiono nella playlist, dentro ogni album
 * il numero di traccia (dal tag o dal nome del file). I brani fuori dalla libreria restano in fondo.
 */
export function trackNumberOrder(tracks: PlaylistTrack[]): PlaylistTrack[] {
  const library = libraryStore.get().library
  const albums = new Map<string, number>()
  const keyed = tracks.map((item, index) => {
    const track = library?.tracks.get(item.id)
    const album = track ? (track.album ?? '').toLocaleLowerCase('it') : null
    if (album !== null && !albums.has(album)) albums.set(album, albums.size)
    return { item, index, album: album === null ? Infinity : albums.get(album)!, number: (track && trackNumber(track)) ?? Infinity }
  })
  keyed.sort((a, b) => a.album - b.album || a.number - b.number || a.index - b.index)
  return keyed.map((entry) => entry.item)
}

/** Riordina la playlist per numero di traccia: subito a schermo, poi su pCloud un brano alla volta. */
export async function sortPlaylistByTrackNumber(id: number) {
  const tracks = playlistsStore.get().tracks[id]
  if (!tracks) return
  const wanted = trackNumberOrder(tracks).map((track) => track.id)
  if (wanted.every((fileId, index) => tracks[index].id === fileId)) return
  setTracks(id, (current) => trackNumberOrder(current))
  try {
    await serial(async () => {
      // A ogni spostamento si rilegge l'ordine vero, senza fare ipotesi su come pCloud sposta gli altri.
      let fresh = (await collections.details(id)).contents ?? []
      for (const [index, fileId] of wanted.entries()) {
        const order = [...fresh].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        const at = order.findIndex((item) => item.fileid === fileId)
        if (at < 0 || at === index) continue
        await collections.move(id, fileId, order[at].position ?? at + 1, order[index].position ?? index + 1)
        fresh = (await collections.details(id)).contents ?? []
      }
    })
  } finally {
    await settle(id)
  }
}

export function resetPlaylists() {
  playlistsStore.set({ lists: [], loaded: false, error: null, tracks: {} })
  localStorage.removeItem(cacheKey())
}
