// La libreria si aggiorna da sola: quello che cambia su pCloud (dall'app di pCloud, dal Finder via
// rclone, da un altro dispositivo, da musicx stesso) arriva in pochi secondi, senza rileggere tutto.
//
// pCloud racconta ogni cambiamento dell'account con `diff`: una richiesta resta aperta finché ne
// succede uno, e ogni evento porta i metadati completi del file (tag compresi). L'indice ricorda
// l'ultimo cambiamento che contiene (`diffid`), così all'avvio recupera quelli persi mentre l'app era
// chiusa. Applicare due volte lo stesso evento non cambia niente: per questo non importa se un
// cambiamento fatto da musicx arriva anche da pCloud.

import { AUDIO_EXT } from '../config'
import {
  commitLibrary,
  extensionOf,
  libraryStore,
  refreshingLibrary,
  refreshLibrary,
  sortFolderTracks,
  trackFrom,
  type Folder,
  type FolderPlace,
  type Library,
} from './library'
import { onlineStore } from './network'
import { diffSince, type DiffEntry, type RawMeta } from './pcloud'

const collator = new Intl.Collator('it', { numeric: true, sensitivity: 'base' })

/**
 * L'indice con i cambiamenti applicati. `refresh` dice che non bastano (una cartella arrivata da fuori
 * della libreria, di cui non si conosce il contenuto, o un "reset" di pCloud): va riletta tutta.
 */
export function applyEvents(library: Library, entries: DiffEntry[]): { library: Library; refresh: boolean } {
  const tree = new Map<number, FolderPlace>(library.tree ?? [])
  const tracks = new Map(library.tracks)
  const folders = new Map(library.folders)
  const copied = new Set<number>()
  const touched = new Set<number>()
  let refresh = false
  let changed = false

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
  const sortChildren = (folder: Folder) => folder.folders.sort((a, b) => collator.compare(folders.get(a)!.name, folders.get(b)!.name))

  /** Porta nella lista delle cartelle una che finora non aveva musica (e quelle sopra, se serve). */
  const ensureFolder = (id: number, depth = 0): boolean => {
    if (folders.has(id)) return true
    const place = tree.get(id)
    if (!place || depth > 200 || !ensureFolder(place.parent, depth + 1)) return false
    folders.set(id, { id, parent: place.parent, name: place.name, folders: [], tracks: [], total: 0 })
    copied.add(id)
    const parent = own(place.parent)!
    parent.folders.push(id)
    sortChildren(parent)
    return true
  }

  const removeTrack = (id: number) => {
    const track = tracks.get(id)
    if (!track) return
    tracks.delete(id)
    const folder = own(track.parent)
    if (folder) folder.tracks = folder.tracks.filter((other) => other !== id)
    addToTotals(track.parent, -1)
    changed = true
  }

  const putTrack = (meta: RawMeta) => {
    const id = meta.fileid!
    const parent = meta.parentfolderid
    const music = !meta.name.startsWith('.') && AUDIO_EXT.has(extensionOf(meta.name))
    if (!music || parent === undefined || !tree.has(parent)) return removeTrack(id)
    if (!ensureFolder(parent)) {
      refresh = true
      return
    }
    const old = tracks.get(id)
    if (old && old.parent !== parent) removeTrack(id)
    if (!tracks.has(id)) {
      own(parent)!.tracks.push(id)
      addToTotals(parent, 1)
    }
    tracks.set(id, trackFrom(meta, parent))
    touched.add(parent)
    changed = true
  }

  /** Toglie una cartella con tutto quello che c'è dentro. */
  const removeFolder = (id: number) => {
    const doomed = new Set([id])
    for (let grew = true; grew; ) {
      grew = false
      for (const [child, place] of tree) {
        if (!doomed.has(child) && doomed.has(place.parent)) {
          doomed.add(child)
          grew = true
        }
      }
    }
    const folder = folders.get(id)
    if (folder) {
      const parent = own(folder.parent)
      if (parent) parent.folders = parent.folders.filter((child) => child !== id)
      addToTotals(folder.parent, -folder.total)
    }
    for (const gone of doomed) {
      tree.delete(gone)
      for (const track of folders.get(gone)?.tracks ?? []) tracks.delete(track)
      folders.delete(gone)
    }
    changed = true
  }

  const putFolder = (meta: RawMeta, event: string) => {
    const id = meta.folderid!
    const parent = meta.parentfolderid
    const known = tree.has(id)
    if (parent === undefined || !tree.has(parent) || meta.name.startsWith('.')) {
      if (known) removeFolder(id)
      return
    }
    // Arrivata da fuori della libreria: cosa contiene si sa solo rileggendo.
    if (!known && event === 'modifyfolder') refresh = true
    const place = tree.get(id)
    if (place && place.parent === parent && place.name === meta.name) return
    tree.set(id, { parent, name: meta.name })
    changed = true
    const folder = folders.get(id)
    if (!folder) return
    const moved = own(id)!
    if (moved.parent !== parent) {
      const old = own(moved.parent)
      if (old) old.folders = old.folders.filter((child) => child !== id)
      addToTotals(moved.parent, -moved.total)
      if (!ensureFolder(parent)) {
        refresh = true
        return
      }
      moved.parent = parent
      own(parent)!.folders.push(id)
      addToTotals(parent, moved.total)
    }
    moved.name = meta.name
    sortChildren(own(parent)!)
  }

  for (const entry of entries) {
    const meta = entry.metadata
    switch (entry.event) {
      case 'reset':
        refresh = true
        break
      case 'createfile':
      case 'modifyfile':
        if (meta?.fileid !== undefined) putTrack(meta)
        break
      case 'deletefile':
        if (meta?.fileid !== undefined) removeTrack(meta.fileid)
        break
      case 'createfolder':
      case 'modifyfolder':
        if (meta?.folderid !== undefined) putFolder(meta, entry.event)
        break
      case 'deletefolder':
        if (meta?.folderid !== undefined && tree.has(meta.folderid)) removeFolder(meta.folderid)
        break
    }
  }
  for (const id of touched) {
    const folder = own(id)
    if (folder) folder.tracks = sortFolderTracks(folder.tracks, tracks)
  }
  return { library: changed ? { ...library, tracks, folders, tree } : library, refresh }
}

/**
 * Applica subito dei cambiamenti noti (un file appena caricato o cancellato da musicx), senza
 * aspettare che arrivino da pCloud.
 */
export function applyLocalEvents(entries: DiffEntry[]) {
  const library = libraryStore.get().library
  if (!library) return
  const result = applyEvents(library, entries)
  if (result.library !== library) commitLibrary(result.library)
}

// --- In ascolto ---

/** Quanto resta aperta una richiesta che aspetta cambiamenti, prima di riaprirne un'altra. */
const WAIT_MS = 5 * 60_000
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
/** Ogni avvio dell'ascolto ha il suo numero: dopo un'uscita dall'account quello vecchio si ferma. */
let generation = 0
let listening = false

/** Da chiamare una volta dopo l'accesso: da lì la libreria segue pCloud finché l'app è aperta. */
export function startLiveLibrary() {
  if (listening) return
  listening = true
  void listen(++generation)
}

export function stopLiveLibrary() {
  listening = false
  generation += 1
}

async function listen(mine: number) {
  let pause = 2000
  while (mine === generation) {
    const library = libraryStore.get().library
    if (!library || library.diffid === undefined || !library.tree || refreshingLibrary() || !onlineStore.get()) {
      await wait(3000)
      continue
    }
    try {
      const { diffid, entries } = await diffSince(library.diffid, true, WAIT_MS)
      pause = 2000
      const current = libraryStore.get().library
      // Nel frattempo l'indice è stato riletto da capo: si riparte dal suo diffid.
      if (!current || current.diffid !== library.diffid) continue
      const { library: next, refresh } = applyEvents(current, entries)
      commitLibrary(next === current ? { ...current, diffid } : { ...next, diffid })
      if (refresh) void refreshLibrary()
    } catch {
      // Rete caduta o richiesta scaduta: si riprova, sempre più piano. (Un indice vecchio di mesi, i cui
      // cambiamenti pCloud potrebbe aver compattato, non arriva qui: si rilegge prima, dopo 12 ore.)
      await wait(pause)
      pause = Math.min(pause * 2, 60_000)
    }
  }
}
