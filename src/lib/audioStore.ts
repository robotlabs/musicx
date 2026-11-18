// Brani salvati su questo dispositivo: scaricati per l'ascolto offline ("download") o precaricati
// mentre suona il brano prima ("cache", con un limite di spazio: i meno usati escono per primi).
//
// Nell'app Android i file stanno nella memoria privata dell'app e li scarica il lato nativo: i server
// di pCloud non lasciano leggere i brani a una pagina (CORS solo per www.pcloud.com), e il link vale
// solo per il telefono che l'ha chiesto. Sul Mac arrivano da rclone e stanno nello spazio di Chrome
// (Origin Private File System). Si suonano da un URL blob: così l'avanti e indietro funziona sempre.

import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { FileTransfer } from '@capacitor/file-transfer'
import { storageKey } from './env'
import { extensionOf } from './library'
import { localSourceEnabled, localUrl } from './localSource'
import { isNativeApp } from './native'
import { fileLink } from './pcloud'
import { createStore } from './store'

export type Kind = 'download' | 'cache'

export interface Saved {
  /** Nome del file sul dispositivo: `<fileid>.<estensione>`. */
  name: string
  size: number
  /** Ultima volta che è servito (per svuotare la cache partendo dai meno usati). */
  used: number
  kind: Kind
}

interface Backend {
  /** Scarica `source` nel file `name` e ne restituisce la dimensione. Finché non è finito si chiama `<name>.part`. */
  save(name: string, source: string): Promise<number>
  open(name: string): Promise<Blob>
  remove(name: string): Promise<void>
  /** Tutti i file della cartella, compresi i .part e i .json. */
  list(): Promise<{ name: string; size: number; time: number }[]>
  readJson(name: string): Promise<unknown>
  writeJson(name: string, data: unknown): Promise<void>
  clear(): Promise<void>
}

// Elenco dei brani e scelte dei download stanno in file accanto ai brani, non in localStorage: nell'app
// Android il WebView può perdere le ultime scritture se l'app viene chiusa di forza, e un elenco perso
// non deve mai far sparire dei brani. Per questo comandano i file: un .part è un download a metà,
// tutto il resto è un brano completo.
const folderName = () => storageKey('audio')
const PART = '.part'

function nativeBackend(): Backend {
  const directory = Directory.Data
  const pathOf = (name: string) => `${folderName()}/${name}`
  const uriOf = async (name: string) => (await Filesystem.getUri({ directory, path: pathOf(name) })).uri
  return {
    async save(name, source) {
      await Filesystem.mkdir({ directory, path: folderName(), recursive: true }).catch(() => {})
      await FileTransfer.downloadFile({ url: source, path: await uriOf(name + PART), connectTimeout: 30_000, readTimeout: 60_000 })
      await Filesystem.rename({ directory, toDirectory: directory, from: pathOf(name + PART), to: pathOf(name) })
      return (await Filesystem.stat({ directory, path: pathOf(name) })).size
    },
    async open(name) {
      // Il guscio serve i file dell'app da _capacitor_file_ (stessa origine della pagina). Le richieste
      // con Range lì non funzionano bene, quindi si legge tutto il file e si suona da un blob.
      const response = await fetch(Capacitor.convertFileSrc(await uriOf(name)))
      if (!response.ok) throw new Error(`File non leggibile (${response.status}).`)
      return response.blob()
    },
    remove: (name) => Filesystem.deleteFile({ directory, path: pathOf(name) }),
    async list() {
      try {
        const { files } = await Filesystem.readdir({ directory, path: folderName() })
        return files.filter((file) => file.type === 'file').map((file) => ({ name: file.name, size: file.size, time: file.mtime }))
      } catch {
        return []
      }
    },
    async readJson(name) {
      try {
        const { data } = await Filesystem.readFile({ directory, path: pathOf(name), encoding: Encoding.UTF8 })
        return JSON.parse(typeof data === 'string' ? data : await data.text())
      } catch {
        return null
      }
    },
    async writeJson(name, data) {
      await Filesystem.writeFile({ directory, path: pathOf(name), data: JSON.stringify(data), encoding: Encoding.UTF8, recursive: true })
    },
    clear: () => Filesystem.rmdir({ directory, path: folderName(), recursive: true }).catch(() => {}),
  }
}

interface FolderHandle {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>
  values(): AsyncIterable<FileSystemHandle>
}

function webBackend(): Backend {
  const root = async () => (await navigator.storage.getDirectory()) as unknown as FolderHandle & {
    getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FolderHandle>
  }
  const folder = async () => (await root()).getDirectoryHandle(folderName(), { create: true })
  const write = async (handle: FileSystemFileHandle, data: ReadableStream<Uint8Array> | string) => {
    const writable = await handle.createWritable()
    if (typeof data === 'string') {
      await writable.write(data)
      await writable.close()
    } else {
      await data.pipeTo(writable)
    }
  }
  return {
    async save(name, source) {
      const response = await fetch(source)
      if (!response.ok || !response.body) throw new Error(`Download non riuscito (${response.status}).`)
      const dir = await folder()
      const part = await dir.getFileHandle(name + PART, { create: true })
      await write(part, response.body)
      // Chrome rinomina i file del suo spazio privato con move(); senza, si copia.
      const movable = part as FileSystemFileHandle & { move?: (name: string) => Promise<void> }
      if (movable.move) {
        await movable.move(name)
        return (await (await dir.getFileHandle(name)).getFile()).size
      }
      const file = await part.getFile()
      await write(await dir.getFileHandle(name, { create: true }), file.stream())
      await dir.removeEntry(name + PART)
      return file.size
    },
    async open(name) {
      return (await (await folder()).getFileHandle(name)).getFile()
    },
    async remove(name) {
      await (await folder()).removeEntry(name)
    },
    async list() {
      const files: { name: string; size: number; time: number }[] = []
      for await (const handle of (await folder()).values()) {
        if (handle.kind !== 'file') continue
        const file = await (handle as FileSystemFileHandle).getFile()
        files.push({ name: handle.name, size: file.size, time: file.lastModified })
      }
      return files
    },
    async readJson(name) {
      try {
        return JSON.parse(await (await (await folder()).getFileHandle(name)).getFile().then((file) => file.text()))
      } catch {
        return null
      }
    },
    async writeJson(name, data) {
      await write(await (await folder()).getFileHandle(name, { create: true }), JSON.stringify(data))
    },
    async clear() {
      await (await root()).removeEntry(folderName(), { recursive: true }).catch(() => {})
    },
  }
}

/** Nella modalità finta i link dei brani sono blob leggibili: si salvano direttamente. */
let directLinks = false
export function setDirectLinks(next: boolean) {
  directLinks = next
}

/** Da dove si scarica il brano su questo dispositivo. */
async function sourceOf(id: number): Promise<string> {
  if (isNativeApp || directLinks) return fileLink(id)
  const url = await localUrl(id)
  if (!url) throw new Error('rclone non risponde.')
  return url
}

const nativeReady = () =>
  isNativeApp && Capacitor.isPluginAvailable('FileTransfer') && Capacitor.isPluginAvailable('Filesystem')
const webReady = () =>
  !isNativeApp && typeof navigator !== 'undefined' && 'storage' in navigator && 'getDirectory' in navigator.storage &&
  (localSourceEnabled() || directLinks)

/** Se su questo dispositivo si possono salvare brani. */
export const canSave = () => nativeReady() || webReady()

/** Nell'app Android con l'APK vecchio (senza i pezzi nativi per i file) serve aggiornare l'app. */
export const needsNewApp = () => isNativeApp && !nativeReady()

let backendCache: Backend | null = null
const backend = () => (backendCache ??= nativeReady() ? nativeBackend() : webBackend())

// --- Indice dei file salvati ---

export const DEFAULT_CACHE_LIMIT = 1024 ** 3

interface AudioState {
  files: Record<number, Saved>
  /** Spazio massimo per i brani precaricati, in byte. */
  limit: number
}

export const audioStore = createStore<AudioState>({ files: {}, limit: DEFAULT_CACHE_LIMIT })

const INDEX_FILE = 'index.json'

/** Si scrive l'elenco solo dopo l'avvio: prima sarebbe vuoto e cancellerebbe quello buono. */
let indexReady = false
let saveTimer = 0
audioStore.subscribe(() => {
  if (!indexReady) return
  clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    const { files, limit } = audioStore.get()
    void backend().writeJson(INDEX_FILE, { files, limit }).catch(() => {})
  }, 300)
})

/** File di appoggio nella cartella dei brani (es. le scelte dei download). */
export const readMeta = (name: string) => (canSave() ? backend().readJson(name) : Promise.resolve(null))
export const writeMeta = (name: string, data: unknown) => (canSave() ? backend().writeJson(name, data).catch(() => {}) : Promise.resolve())

export const savedOf = (id: number): Saved | undefined => audioStore.get().files[id]

function put(id: number, saved: Saved | null) {
  audioStore.set((state) => {
    const files = { ...state.files }
    if (saved) files[id] = saved
    else delete files[id]
    return { ...state, files }
  })
}

/** Cambia ogni volta che si svuota tutto: un download finito dopo non deve rimettere il file in elenco. */
let epoch = 0
let started = false

/**
 * All'avvio: l'elenco dei brani salvati si ricostruisce dai file che ci sono davvero; dal file
 * dell'elenco vengono solo il tipo (scaricato o precaricato) e l'ultimo ascolto. Un brano che manca
 * dall'elenco resta, come precaricato: se fa parte dei download, l'allineamento lo riconosce.
 */
export async function initAudioStore() {
  if (started || !canSave()) return
  started = true
  const index = (await backend().readJson(INDEX_FILE)) as { files?: Record<number, Saved>; limit?: number } | null
  const known = index?.files ?? {}
  const files: Record<number, Saved> = {}
  for (const entry of await backend().list()) {
    if (entry.name.endsWith(PART)) {
      // Download interrotto a metà.
      void backend().remove(entry.name).catch(() => {})
      continue
    }
    const id = Number.parseInt(entry.name, 10)
    if (!Number.isFinite(id) || entry.name.endsWith('.json') || entry.size === 0) continue
    const saved = known[id]
    files[id] = { name: entry.name, size: entry.size, used: saved?.used ?? entry.time ?? 0, kind: saved?.kind ?? 'cache' }
  }
  audioStore.set((state) => ({ files: { ...files, ...state.files }, limit: Number(index?.limit) || DEFAULT_CACHE_LIMIT }))
  indexReady = true
  audioStore.set((state) => ({ ...state }))
}

const inFlight = new Map<number, Promise<boolean>>()

/**
 * Salva il brano sul dispositivo (se non c'è già). Con `download` un brano già precaricato
 * diventa scaricato. Restituisce false se non è riuscito.
 */
export function saveTrack(id: number, file: string, kind: Kind): Promise<boolean> {
  const promote = (ok: boolean) => {
    const saved = savedOf(id)
    if (ok && saved && kind === 'download' && saved.kind !== 'download') put(id, { ...saved, kind })
    return ok
  }
  if (savedOf(id)) return Promise.resolve(promote(true))
  const running = inFlight.get(id)
  if (running) return running.then(promote)

  const name = `${id}.${extensionOf(file) || 'audio'}`
  const startedAt = epoch
  const job = (async () => {
    try {
      const size = await backend().save(name, await sourceOf(id))
      if (startedAt !== epoch || size === 0) throw new Error('scartato')
      put(id, { name, size, used: Date.now(), kind })
      return true
    } catch {
      await backend().remove(name).catch(() => {})
      return false
    } finally {
      inFlight.delete(id)
    }
  })()
  inFlight.set(id, job)
  return job.then(promote)
}

/** Cambia il tipo di un brano già salvato (es. da scaricato a semplice cache). */
export function setKind(id: number, kind: Kind) {
  const saved = savedOf(id)
  if (saved && saved.kind !== kind) put(id, { ...saved, kind })
}

/** Toglie il brano dal dispositivo. */
export async function forget(id: number) {
  const saved = savedOf(id)
  if (!saved) return
  put(id, null)
  await backend().remove(saved.name).catch(() => {})
}

// URL blob dei brani in riproduzione: si tengono gli ultimi due, perché l'elemento audio passa
// dall'uno all'altro e non deve trovarsi in mano un URL già revocato.
const blobs: { id: number; url: string }[] = []

/** URL da suonare per un brano salvato, o null se non c'è (o il file è sparito). */
export async function playableUrl(id: number): Promise<string | null> {
  const saved = savedOf(id)
  if (!saved || !canSave()) return null
  const ready = blobs.find((blob) => blob.id === id)
  if (ready) return ready.url
  try {
    const url = URL.createObjectURL(await backend().open(saved.name))
    blobs.push({ id, url })
    while (blobs.length > 2) URL.revokeObjectURL(blobs.shift()!.url)
    if (savedOf(id)) put(id, { ...savedOf(id)!, used: Date.now() })
    return url
  } catch {
    await forget(id)
    return null
  }
}

/** Il file salvato non suona (rovinato): si butta, così la prossima volta si riprende da pCloud. */
export function discardBroken(id: number) {
  const index = blobs.findIndex((blob) => blob.id === id)
  if (index >= 0) URL.revokeObjectURL(blobs.splice(index, 1)[0].url)
  void forget(id)
}

/** Porta la cache sotto il limite togliendo i brani meno usati, tranne quelli in `keep`. */
export async function trimCache(keep: Set<number> = new Set()) {
  const { files, limit } = audioStore.get()
  const cached = Object.entries(files)
    .filter(([, saved]) => saved.kind === 'cache')
    .map(([id, saved]) => ({ id: Number(id), ...saved }))
    .sort((a, b) => a.used - b.used)
  let total = cached.reduce((sum, saved) => sum + saved.size, 0)
  for (const saved of cached) {
    if (total <= limit) break
    if (keep.has(saved.id)) continue
    total -= saved.size
    await forget(saved.id)
  }
}

export function setCacheLimit(limit: number) {
  audioStore.set((state) => ({ ...state, limit }))
  void trimCache()
}

/** Toglie dal dispositivo tutti i brani precaricati (non quelli scaricati). */
export async function clearCache() {
  const ids = Object.entries(audioStore.get().files)
    .filter(([, saved]) => saved.kind === 'cache')
    .map(([id]) => Number(id))
  for (const id of ids) await forget(id)
}

/** Toglie dal dispositivo tutti i brani, scaricati e precaricati. */
export async function clearAllAudio() {
  epoch += 1
  audioStore.set((state) => ({ ...state, files: {} }))
  if (canSave()) await backend().clear()
}

export interface Usage {
  count: number
  bytes: number
}

export function usageOf(files: Record<number, Saved>): Record<Kind, Usage> {
  const usage: Record<Kind, Usage> = { download: { count: 0, bytes: 0 }, cache: { count: 0, bytes: 0 } }
  for (const saved of Object.values(files)) {
    usage[saved.kind].count += 1
    usage[saved.kind].bytes += saved.size
  }
  return usage
}
