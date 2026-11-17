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

/**
 * 2: i brani hanno anche il numero di traccia. 3: un indice salvato prima poteva aver perso modifiche
 * fatte mentre si rileggeva la libreria. Un indice di una versione precedente si mostra e si rilegge subito.
 */
const CACHE_VERSION = 3

interface StoredLibrary {
  version: 1 | 2 | 3
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

/** Il numero di traccia scritto nel nome del file: "01 Albachiara", "Track-06", "3. Sally". */
export function numberInName(fileName: string): number | undefined {
  const match = /^(?:track|traccia|pista)?[\s._-]*(\d{1,3})(?!\d)/i.exec(stripExtension(fileName))
  const number = match ? Number(match[1]) : 0
  return number > 0 ? number : undefined
}

/** Numero di traccia dal tag o, se manca, dal nome del file. */
export function trackNumber(track: Track): number | undefined {
  const tagged = Number.parseInt(track.track ?? '', 10)
  return tagged > 0 ? tagged : numberInName(track.name)
}

/**
 * L'ordine dei brani in una cartella: il numero di traccia, come nel disco (se manca nel tag, quello
 * nel nome del file), poi il nome del file. Se nella cartella ci sono più album il numero vale solo
 * se ce l'hanno tutti e sono tutti diversi (un ordine scelto apposta, per esempio trascinando i
 * brani); altrimenti due dischi si mescolerebbero (1, 1, 2, 2…) e resta l'ordine per nome.
 */
export function sortFolderTracks(ids: number[], tracks: Map<number, Track>): number[] {
  const list = ids.flatMap((id) => tracks.get(id) ?? [])
  const albums = new Set(list.flatMap((track) => (track.album ? [track.album.toLocaleLowerCase('it')] : [])))
  const byName = (a: Track, b: Track) => collator.compare(a.name, b.name)
  const byNumber = (a: Track, b: Track) => (trackNumber(a) ?? Infinity) - (trackNumber(b) ?? Infinity) || byName(a, b)
  let numbered = albums.size <= 1
  if (!numbered) {
    const tagged = list.map((track) => Number.parseInt(track.track ?? '', 10))
    numbered = tagged.every((number) => number > 0) && new Set(tagged).size === tagged.length
  }
  return list.sort(numbered ? byNumber : byName).map((track) => track.id)
}

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
    folder.tracks = sortFolderTracks(folder.tracks, tracks)
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
    if (!stored || stored.version > CACHE_VERSION || stored.root !== MUSIC_ROOT) return null
    const tracks = new Map(stored.tracks.map((track) => [track.id, track]))
    const library: Library = {
      rootId: stored.rootId,
      // Si riordina ogni volta: un indice salvato da una versione precedente può avere l'ordine di allora.
      folders: new Map(stored.folders.map((folder) => [folder.id, { ...folder, tracks: sortFolderTracks(folder.tracks, tracks) }])),
      tracks,
      // Un indice vecchio vale come scaduto: si vede subito e intanto si rilegge.
      builtAt: stored.version < CACHE_VERSION ? 0 : stored.builtAt,
    }
    return withChanges(library, readEdits())
  } catch {
    return null
  }
}

async function writeCache(library: Library) {
  const edits = editsSnapshot()
  const stored: StoredLibrary = {
    version: CACHE_VERSION,
    root: MUSIC_ROOT,
    rootId: library.rootId,
    folders: [...library.folders.values()],
    tracks: [...library.tracks.values()],
    builtAt: library.builtAt,
  }
  // Senza cache l'app funziona lo stesso: rilegge la libreria al prossimo avvio.
  await idbSet(cacheKey(), stored).then(
    () => forgetEdits(edits),
    () => {},
  )
}

const describe = (error: unknown) => {
  if (error instanceof PCloudError && (error.code === 2005 || error.code === 2010)) {
    return `La cartella ${MUSIC_ROOT} non esiste su questo account pCloud.`
  }
  return error instanceof Error ? error.message : 'Errore sconosciuto.'
}

let refreshInFlight: Promise<void> | null = null

/**
 * Le modifiche fatte mentre si rilegge la libreria. L'elenco di pCloud può essere stato letto
 * prima: senza rimetterle, l'indice nuovo le cancellerebbe (e verrebbe pure salvato così).
 */
let changedDuringRefresh: Edits | null = null

/** Rilegge tutta la libreria da pCloud. */
export function refreshLibrary(): Promise<void> {
  refreshInFlight ??= (async () => {
    const hadLibrary = libraryStore.get().library !== null
    libraryStore.set((state) => ({ ...state, status: hadLibrary ? 'ready' : 'loading', refreshing: hadLibrary, error: null }))
    const during: Edits = { tracks: new Map(), folders: new Map() }
    changedDuringRefresh = during
    try {
      const library = withChanges(buildLibrary(await listTree(MUSIC_ROOT)), during)
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
      changedDuringRefresh = null
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

/** Cosa cambia in un brano. Con `parent` il brano passa in un'altra cartella. */
export type TrackChange = Partial<Omit<Track, 'id'>>

/** Dove sta una cartella: se non è nell'indice (vuota o appena creata) la si aggiunge, se sta altrove la si sposta. */
export interface FolderPlace {
  parent: number
  name: string
}

interface Edits {
  tracks: Map<number, TrackChange>
  folders: Map<number, FolderPlace>
}

/**
 * La libreria con le modifiche: prima le cartelle (create o spostate), poi i brani. Le cartelle
 * toccate si riordinano (nome, album o numero spostano un brano) e i conteggi si aggiornano.
 * L'indice di partenza resta com'era: le cartelle cambiate sono copie.
 */
function withChanges(library: Library, { tracks: changes, folders: places }: Edits): Library {
  if (!changes.size && !places.size) return library
  const tracks = new Map(library.tracks)
  const folders = new Map(library.folders)
  const copied = new Set<number>()
  const own = (id: number): Folder | undefined => {
    const folder = folders.get(id)
    if (!folder || copied.has(id)) return folder
    const copy = { ...folder, folders: [...folder.folders], tracks: [...folder.tracks] }
    folders.set(id, copy)
    copied.add(id)
    return copy
  }
  const addToTotals = (from: number, amount: number) => {
    for (let folder = own(from), steps = 0; folder && steps < 200; folder = own(folder.parent), steps++) folder.total += amount
  }
  /** `id` è `ancestor` o sta dentro (una cartella non può finire dentro sé stessa). */
  const isWithin = (id: number, ancestor: number) => {
    for (let at = folders.get(id), steps = 0; at && steps < 200; at = folders.get(at.parent), steps++) {
      if (at.id === ancestor) return true
    }
    return false
  }
  const sortChildren = (folder: Folder) => folder.folders.sort((a, b) => collator.compare(folders.get(a)!.name, folders.get(b)!.name))

  const place = (id: number, wanted: FolderPlace, depth = 0): boolean => {
    if (depth > 200) return false
    const above = places.get(wanted.parent)
    const parentKnown = folders.has(wanted.parent) || (above !== undefined && place(wanted.parent, above, depth + 1))
    if (!parentKnown || isWithin(wanted.parent, id)) return false
    const current = folders.get(id)
    if (current && current.parent === wanted.parent && current.name === wanted.name) return true
    if (!current) {
      folders.set(id, { id, parent: wanted.parent, name: wanted.name, folders: [], tracks: [], total: 0 })
      copied.add(id)
      const parent = own(wanted.parent)!
      parent.folders.push(id)
      sortChildren(parent)
      return true
    }
    const folder = own(id)!
    if (folder.parent !== wanted.parent) {
      const old = own(folder.parent)
      if (old) old.folders = old.folders.filter((child) => child !== id)
      addToTotals(folder.parent, -folder.total)
      folder.parent = wanted.parent
      own(wanted.parent)!.folders.push(id)
      addToTotals(wanted.parent, folder.total)
    }
    folder.name = wanted.name
    sortChildren(own(wanted.parent)!)
    return true
  }
  for (const [id, wanted] of places) place(id, wanted)

  const touched = new Set<number>()
  for (const [id, change] of changes) {
    const track = tracks.get(id)
    if (!track) continue
    const next = { ...track, ...change }
    // Una cartella che l'indice non conosce: il brano resta dov'era fino alla prossima lettura.
    if (next.parent === undefined || !folders.has(next.parent)) next.parent = track.parent
    if (next.parent !== track.parent) {
      const old = own(track.parent)
      if (old) old.tracks = old.tracks.filter((other) => other !== id)
      addToTotals(track.parent, -1)
      own(next.parent)!.tracks.push(id)
      addToTotals(next.parent, 1)
    }
    tracks.set(id, next)
    touched.add(next.parent)
  }
  for (const id of touched) {
    const folder = own(id)
    if (folder) folder.tracks = sortFolderTracks(folder.tracks, tracks)
  }
  return { ...library, tracks, folders }
}

/**
 * Aggiorna dei brani nell'indice (dopo averne cambiato tag, nome o cartella) senza rileggere tutta
 * la libreria; `folders` mette a posto prima le cartelle (una nuova, una spostata).
 * La libreria diventa un oggetto nuovo, così liste e ricerca si ricalcolano.
 */
export function updateTracks(changes: Map<number, TrackChange>, folders: Map<number, FolderPlace> = new Map()) {
  const library = libraryStore.get().library
  if (!library || (!changes.size && !folders.size)) return
  if (changedDuringRefresh) {
    for (const [id, change] of changes) changedDuringRefresh.tracks.set(id, { ...changedDuringRefresh.tracks.get(id), ...change })
    for (const [id, place] of folders) changedDuringRefresh.folders.set(id, place)
  }
  rememberEdits(changes, folders)
  const next = withChanges(library, { tracks: changes, folders })
  libraryStore.set((state) => ({ ...state, library: next }))
  // Con tante modifiche di fila l'indice (decine di migliaia di brani) si salva una volta sola alla fine.
  clearTimeout(saveTimer)
  saveTimer = setTimeout(saveNow, 1500)
}

let saveTimer: ReturnType<typeof setTimeout> | undefined

function saveNow() {
  clearTimeout(saveTimer)
  saveTimer = undefined
  const current = libraryStore.get().library
  if (current) void writeCache(current)
}

// L'indice intero si salva con calma (vedi sopra), ma chiudendo l'app subito dopo una modifica il
// salvataggio non farebbe in tempo: le modifiche si annotano anche qui, subito, e all'avvio si
// rimettono sopra l'indice salvato. Si cancellano quando l'indice salvato le contiene.
const editsKey = () => storageKey('library-edits')
const placesKey = () => storageKey('library-folders')

function readEdits(): Edits {
  const edits: Edits = { tracks: new Map(), folders: new Map() }
  try {
    const saved = JSON.parse(localStorage.getItem(editsKey()) ?? '{}') as Record<string, Record<string, string | number | null>>
    for (const [id, change] of Object.entries(saved)) {
      edits.tracks.set(Number(id), Object.fromEntries(Object.entries(change).map(([key, value]) => [key, value ?? undefined])) as TrackChange)
    }
    const places = JSON.parse(localStorage.getItem(placesKey()) ?? '{}') as Record<string, FolderPlace>
    for (const [id, place] of Object.entries(places)) edits.folders.set(Number(id), place)
  } catch {
    // Annotazioni illeggibili: vale l'indice salvato.
  }
  return edits
}

function rememberEdits(changes: Map<number, TrackChange>, folders: Map<number, FolderPlace>) {
  try {
    if (changes.size) {
      const saved = JSON.parse(localStorage.getItem(editsKey()) ?? '{}') as Record<string, Record<string, unknown>>
      for (const [id, change] of changes) {
        // null al posto di undefined, che in JSON sparirebbe (un campo tolto deve restare tolto).
        const plain = Object.fromEntries(Object.entries(change).map(([key, value]) => [key, value ?? null]))
        saved[id] = { ...saved[id], ...plain }
      }
      localStorage.setItem(editsKey(), JSON.stringify(saved))
    }
    if (folders.size) {
      const saved = JSON.parse(localStorage.getItem(placesKey()) ?? '{}') as Record<string, FolderPlace>
      for (const [id, place] of folders) saved[id] = place
      localStorage.setItem(placesKey(), JSON.stringify(saved))
    }
  } catch {
    // Senza localStorage resta il salvataggio dell'indice.
  }
}

/** Le modifiche annotate finora, da cancellare quando l'indice che le contiene è salvato. */
function editsSnapshot(): string | null {
  try {
    return JSON.stringify([localStorage.getItem(editsKey()), localStorage.getItem(placesKey())])
  } catch {
    return null
  }
}

function forgetEdits(snapshot: string | null) {
  try {
    // Se nel frattempo ne sono arrivate altre, restano: l'indice salvato non le contiene ancora.
    if (snapshot !== null && editsSnapshot() === snapshot) {
      localStorage.removeItem(editsKey())
      localStorage.removeItem(placesKey())
    }
  } catch {
    // Niente da fare.
  }
}

export async function clearLibrary() {
  libraryStore.set({ status: 'idle', library: null, error: null, refreshing: false })
  clearTimeout(saveTimer)
  forgetEdits(editsSnapshot())
  await idbDel(cacheKey()).catch(() => {})
}
