// L'indice della libreria: tutto l'albero di MUSIC_ROOT letto una volta da pCloud,
// tenuto in memoria e salvato in IndexedDB. Navigazione e ricerca lavorano solo su questo.

import { AUDIO_EXT, LIBRARY_MAX_AGE_MS, MUSIC_ROOT } from '../config'
import { storageKey } from './env'
import { idbDel, idbGet, idbSet } from './idb'
import { listTree, PCloudError, type RawMeta } from './pcloud'
import type { QItem } from './queue'
import { createStore } from './store'

export interface Folder {
  id: number
  /** -1 per la cartella radice. */
  parent: number
  name: string
  folders: number[]
  tracks: number[]
  /** Brani contenuti, sottocartelle comprese. */
  total: number
}

export interface Track {
  id: number
  parent: number
  /** Nome del file. */
  name: string
  title?: string
  artist?: string
  album?: string
  /** Numero di traccia dal tag ("3" o "3/12"). */
  track?: string
}

export interface Library {
  rootId: number
  folders: Map<number, Folder>
  tracks: Map<number, Track>
  builtAt: number
}

interface StoredLibrary {
  version: 1
  root: string
  rootId: number
  folders: Folder[]
  tracks: Track[]
  builtAt: number
}

const collator = new Intl.Collator('it', { numeric: true, sensitivity: 'base' })

export const extensionOf = (file: string) => file.slice(file.lastIndexOf('.') + 1).toLowerCase()
export const stripExtension = (file: string) => file.replace(/\.[^.]+$/, '')

const clean = (value: string | undefined) => value?.trim() || undefined

/** I campi del tag come li legge pCloud. */
export const trackTags = (raw: RawMeta): Pick<Track, 'title' | 'artist' | 'album' | 'track'> => ({
  title: clean(raw.title),
  artist: clean(raw.artist),
  album: clean(raw.album),
  track: clean(raw.trackno === undefined || raw.trackno === 0 ? undefined : String(raw.trackno)),
})

/** Trasforma la risposta ricorsiva di `listfolder` nell'indice. Le cartelle senza musica spariscono. */
export function buildLibrary(root: RawMeta, builtAt = Date.now()): Library {
  const folders = new Map<number, Folder>()
  const tracks = new Map<number, Track>()

  const walk = (raw: RawMeta, parent: number): number => {
    const id = raw.folderid!
    const folder: Folder = { id, parent, name: raw.name, folders: [], tracks: [], total: 0 }
    for (const child of raw.contents ?? []) {
      // File nascosti e doppioni "._nome" creati da macOS.
      if (child.name.startsWith('.')) continue
      if (child.isfolder) {
        const inside = walk(child, id)
        if (inside > 0) {
          folder.folders.push(child.folderid!)
          folder.total += inside
        }
      } else if (child.fileid !== undefined && AUDIO_EXT.has(extensionOf(child.name))) {
        tracks.set(child.fileid, {
          id: child.fileid,
          parent: id,
          name: child.name,
          ...trackTags(child),
        })
        folder.tracks.push(child.fileid)
      }
    }
    folder.total += folder.tracks.length
    folder.folders.sort((a, b) => collator.compare(folders.get(a)!.name, folders.get(b)!.name))
    folder.tracks.sort((a, b) => collator.compare(tracks.get(a)!.name, tracks.get(b)!.name))
    if (folder.total > 0 || parent === -1) folders.set(id, folder)
    return folder.total
  }

  walk(root, -1)
  return { rootId: root.folderid!, folders, tracks, builtAt }
}

export const trackTitle = (track: Track) => track.title ?? stripExtension(track.name)

export const trackSubtitle = (library: Library, track: Track) =>
  track.artist ?? library.folders.get(track.parent)?.name ?? ''

export const toQueueItem = (library: Library, track: Track): QItem => ({
  id: track.id,
  file: track.name,
  title: trackTitle(track),
  sub: trackSubtitle(library, track),
})

export function queueItems(library: Library, trackIds: number[]): QItem[] {
  const items: QItem[] = []
  for (const id of trackIds) {
    const track = library.tracks.get(id)
    if (track) items.push(toQueueItem(library, track))
  }
  return items
}

/** Le cartelle dalla radice fino a `folderId` compresa. */
export function folderTrail(library: Library, folderId: number): Folder[] {
  const trail: Folder[] = []
  for (let folder = library.folders.get(folderId); folder; folder = library.folders.get(folder.parent)) {
    trail.unshift(folder)
  }
  return trail
}

/** Tutti i brani sotto una cartella, nell'ordine in cui si vedono navigando. */
export function tracksUnder(library: Library, folderId: number): number[] {
  const result: number[] = []
  const visit = (id: number) => {
    const folder = library.folders.get(id)
    if (!folder) return
    result.push(...folder.tracks)
    folder.folders.forEach(visit)
  }
  visit(folderId)
  return result
}

/** Minuscole, senza accenti, con trattini e underscore trattati come spazi. */
export const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[_\-.]+/g, ' ')

interface SearchIndex {
  folders: [id: number, text: string][]
  tracks: [id: number, text: string][]
}

const searchIndexes = new WeakMap<Library, SearchIndex>()

function searchIndexOf(library: Library): SearchIndex {
  let index = searchIndexes.get(library)
  if (!index) {
    index = { folders: [], tracks: [] }
    for (const folder of library.folders.values()) {
      if (folder.id !== library.rootId) index.folders.push([folder.id, normalize(folder.name)])
    }
    for (const track of library.tracks.values()) {
      const folder = library.folders.get(track.parent)?.name ?? ''
      const text = [track.name, track.title, track.artist, track.album, folder].filter(Boolean).join(' ')
      index.tracks.push([track.id, normalize(text)])
    }
    searchIndexes.set(library, index)
  }
  return index
}

export interface SearchResult {
  folders: Folder[]
  tracks: Track[]
  /** true se c'erano più risultati di quelli restituiti. */
  truncated: boolean
}

/** Trova cartelle e brani che contengono tutte le parole cercate. */
export function searchLibrary(library: Library, query: string, limit = 300): SearchResult {
  const words = normalize(query).split(/\s+/).filter(Boolean)
  const result: SearchResult = { folders: [], tracks: [], truncated: false }
  if (!words.length) return result
  const matches = (text: string) => words.every((word) => text.includes(word))
  const index = searchIndexOf(library)

  for (const [id, text] of index.folders) {
    if (!matches(text)) continue
    if (result.folders.length >= 50) {
      result.truncated = true
      break
    }
    result.folders.push(library.folders.get(id)!)
  }
  for (const [id, text] of index.tracks) {
    if (!matches(text)) continue
    if (result.tracks.length >= limit) {
      result.truncated = true
      break
    }
    result.tracks.push(library.tracks.get(id)!)
  }
  result.folders.sort((a, b) => collator.compare(a.name, b.name))
  return result
}

// --- Caricamento e cache ---

export interface LibraryState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  library: Library | null
  error: string | null
  /** Aggiornamento in corso con un indice già mostrato. */
  refreshing: boolean
}

export const libraryStore = createStore<LibraryState>({
  status: 'idle',
  library: null,
  error: null,
  refreshing: false,
})

const cacheKey = () => storageKey('library')

async function readCache(): Promise<Library | null> {
  try {
    const stored = await idbGet<StoredLibrary>(cacheKey())
    if (!stored || stored.version !== 1 || stored.root !== MUSIC_ROOT) return null
    return {
      rootId: stored.rootId,
      folders: new Map(stored.folders.map((folder) => [folder.id, folder])),
      tracks: new Map(stored.tracks.map((track) => [track.id, track])),
      builtAt: stored.builtAt,
    }
  } catch {
    return null
  }
}

async function writeCache(library: Library) {
  const stored: StoredLibrary = {
    version: 1,
    root: MUSIC_ROOT,
    rootId: library.rootId,
    folders: [...library.folders.values()],
    tracks: [...library.tracks.values()],
    builtAt: library.builtAt,
  }
  // Senza cache l'app funziona lo stesso: rilegge la libreria al prossimo avvio.
  await idbSet(cacheKey(), stored).catch(() => {})
}

const describe = (error: unknown) => {
  if (error instanceof PCloudError && (error.code === 2005 || error.code === 2010)) {
    return `La cartella ${MUSIC_ROOT} non esiste su questo account pCloud.`
  }
  return error instanceof Error ? error.message : 'Errore sconosciuto.'
}

let refreshInFlight: Promise<void> | null = null

/** Rilegge tutta la libreria da pCloud. */
export function refreshLibrary(): Promise<void> {
  refreshInFlight ??= (async () => {
    const hadLibrary = libraryStore.get().library !== null
    libraryStore.set((state) => ({ ...state, status: hadLibrary ? 'ready' : 'loading', refreshing: hadLibrary, error: null }))
    try {
      const library = buildLibrary(await listTree(MUSIC_ROOT))
      libraryStore.set({ status: 'ready', library, error: null, refreshing: false })
      await writeCache(library)
    } catch (error) {
      libraryStore.set((state) => ({
        ...state,
        status: state.library ? 'ready' : 'error',
        error: describe(error),
        refreshing: false,
      }))
    } finally {
      refreshInFlight = null
    }
  })()
  return refreshInFlight
}

/** All'avvio: mostra subito l'indice salvato e lo riaggiorna in sottofondo se è vecchio. */
export async function initLibrary() {
  if (libraryStore.get().status !== 'idle') return
  libraryStore.set((state) => ({ ...state, status: 'loading' }))
  const cached = await readCache()
  if (!cached) return refreshLibrary()
  libraryStore.set({ status: 'ready', library: cached, error: null, refreshing: false })
  if (Date.now() - cached.builtAt > LIBRARY_MAX_AGE_MS) void refreshLibrary()
}

/**
 * Aggiorna dei brani nell'indice (dopo averne cambiato tag o nome) senza rileggere tutta la libreria.
 * La libreria diventa un oggetto nuovo, così liste e ricerca si ricalcolano.
 */
export function updateTracks(changes: Map<number, Partial<Omit<Track, 'id' | 'parent'>>>) {
  const library = libraryStore.get().library
  if (!library || !changes.size) return
  const tracks = new Map(library.tracks)
  const folders = new Map(library.folders)
  for (const [id, change] of changes) {
    const track = tracks.get(id)
    if (!track) continue
    tracks.set(id, { ...track, ...change })
    if (change.name !== undefined && change.name !== track.name) {
      const folder = folders.get(track.parent)
      if (folder) {
        const sorted = [...folder.tracks].sort((a, b) => collator.compare(tracks.get(a)!.name, tracks.get(b)!.name))
        folders.set(folder.id, { ...folder, tracks: sorted })
      }
    }
  }
  const next = { ...library, tracks, folders }
  libraryStore.set((state) => ({ ...state, library: next }))
  // Con tante modifiche di fila l'indice (decine di migliaia di brani) si salva una volta sola alla fine.
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const current = libraryStore.get().library
    if (current) void writeCache(current)
  }, 1500)
}

let saveTimer: ReturnType<typeof setTimeout> | undefined

export async function clearLibrary() {
  libraryStore.set({ status: 'idle', library: null, error: null, refreshing: false })
  await idbDel(cacheKey()).catch(() => {})
}
