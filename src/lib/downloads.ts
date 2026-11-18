// Download per l'ascolto offline, come in Spotify: si scaricano brani, cartelle o playlist intere.
// Si ricorda cosa è stato scelto, non i singoli file: una playlist scaricata resta allineata (i brani
// aggiunti si scaricano, quelli tolti spariscono dal dispositivo), e così una cartella.

import { NATIVE_EXT } from '../config'
import { audioStore, canSave, forget, readMeta, saveTrack, setKind, writeMeta } from './audioStore'
import { extensionOf, libraryStore, tracksUnder } from './library'
import { onlineStore } from './network'
import { loadPlaylist, playlistsStore } from './playlists'
import { createStore } from './store'

export interface Pins {
  /** Brani scelti uno per uno: fileid → nome del file (serve anche se il brano non è nella libreria). */
  tracks: Record<number, string>
  folders: number[]
  playlists: number[]
}

interface DownloadsState {
  pins: Pins
  /** Brani ancora da scaricare in questo giro, e quanti sono fatti. */
  todo: number
  done: number
  failed: number
  /** Si è fermato perché manca la rete. */
  waiting: boolean
}

const noPins: Pins = { tracks: {}, folders: [], playlists: [] }

export const downloadsStore = createStore<DownloadsState>({ pins: noPins, todo: 0, done: 0, failed: 0, waiting: false })

/** Le scelte stanno in un file accanto ai brani (vedi audioStore.ts: localStorage nell'app può perderle). */
const PINS_FILE = 'pins.json'

const patch = (changes: Partial<DownloadsState>) => downloadsStore.set((state) => ({ ...state, ...changes }))

function setPins(pins: Pins) {
  patch({ pins })
  void writeMeta(PINS_FILE, pins)
  scheduleSync()
}

export const isFolderPinned = (id: number) => downloadsStore.get().pins.folders.includes(id)
export const isPlaylistPinned = (id: number) => downloadsStore.get().pins.playlists.includes(id)

export function pinFolder(id: number, on: boolean) {
  const { pins } = downloadsStore.get()
  const folders = pins.folders.filter((folder) => folder !== id)
  setPins({ ...pins, folders: on ? [...folders, id] : folders })
}

export function pinPlaylist(id: number, on: boolean) {
  const { pins } = downloadsStore.get()
  const playlists = pins.playlists.filter((list) => list !== id)
  setPins({ ...pins, playlists: on ? [...playlists, id] : playlists })
}

export function pinTracks(tracks: { id: number; file: string }[], on: boolean) {
  const { pins } = downloadsStore.get()
  const next = { ...pins.tracks }
  for (const track of tracks) {
    if (on) next[track.id] = track.file
    else delete next[track.id]
  }
  setPins({ ...pins, tracks: next })
}

export function forgetPins() {
  setPins(noPins)
}

interface Wanted {
  file: string
  sources: string[]
}

/** I brani da tenere scaricati, con la scelta da cui arrivano. */
function wantedBy(pins: Pins): Map<number, Wanted> {
  const wanted = new Map<number, Wanted>()
  const add = (id: number, file: string, source: string) => {
    // I formati che Chrome non suona passano dalla conversione di pCloud: non si scaricano.
    if (!NATIVE_EXT.has(extensionOf(file))) return
    const entry = wanted.get(id)
    if (entry) entry.sources.push(source)
    else wanted.set(id, { file, sources: [source] })
  }
  for (const [id, file] of Object.entries(pins.tracks)) add(Number(id), file, `track-${id}`)
  const library = libraryStore.get().library
  if (library) {
    for (const folder of pins.folders) {
      for (const id of library.folders.has(folder) ? tracksUnder(library, folder) : []) {
        add(id, library.tracks.get(id)!.name, `folder-${folder}`)
      }
    }
  }
  const { tracks } = playlistsStore.get()
  for (const list of pins.playlists) for (const track of tracks[list] ?? []) add(track.id, track.file, `playlist-${list}`)
  return wanted
}

/** true se tutte le scelte si possono risolvere (libreria letta, brani delle playlist noti). */
function allKnown(pins: Pins): boolean {
  if (pins.folders.length && !libraryStore.get().library) return false
  const { tracks } = playlistsStore.get()
  return pins.playlists.every((list) => tracks[list] !== undefined)
}

/** I brani scaricati e da quale scelta arrivano (per i segni nelle liste). */
export function wantedTracks(): Map<number, Wanted> {
  return wantedBy(downloadsStore.get().pins)
}

// --- Allineamento ---

let running = false
let again = false
/** Playlist scaricate già rilette da pCloud in questa sessione. */
const freshLists = new Set<number>()

async function sync() {
  if (running) {
    again = true
    return
  }
  running = true
  try {
    do {
      again = false
      if (!canSave()) return
      const { pins } = downloadsStore.get()
      const online = onlineStore.get()

      // Le playlist scaricate si rileggono da pCloud una volta per sessione: i brani aggiunti altrove arrivano.
      if (online) {
        for (const list of pins.playlists) {
          if (freshLists.has(list)) continue
          try {
            await loadPlaylist(list)
            freshLists.add(list)
          } catch {
            // Playlist sparita o rete instabile: si riprova al prossimo giro.
          }
        }
      }

      const wanted = wantedBy(pins)
      // Brani scaricati che nessuna scelta vuole più: si tolgono. Solo se ogni scelta è nota, altrimenti
      // (libreria ancora da leggere, playlist mai aperta offline) si rischierebbe di buttare tutto.
      if (allKnown(pins)) {
        for (const [id, saved] of Object.entries(audioStore.get().files)) {
          if (saved.kind === 'download' && !wanted.has(Number(id))) await forget(Number(id))
        }
      }

      const files = audioStore.get().files
      const missing = [...wanted].filter(([id]) => files[id]?.kind !== 'download')
      patch({ todo: missing.length, done: 0, failed: 0, waiting: false })
      for (const [id, { file }] of missing) {
        if (again) break
        if (!onlineStore.get()) {
          patch({ waiting: true })
          break
        }
        const ok = await saveTrack(id, file, 'download')
        downloadsStore.set((state) => (ok ? { ...state, done: state.done + 1 } : { ...state, failed: state.failed + 1 }))
      }
    } while (again)
  } finally {
    running = false
    const { done, failed, todo } = downloadsStore.get()
    if (done + failed >= todo) patch({ todo: 0, done: 0 })
  }
}

let syncTimer: ReturnType<typeof setTimeout> | undefined
function scheduleSync() {
  clearTimeout(syncTimer)
  syncTimer = setTimeout(() => void sync(), 800)
}

let started = false

/** All'avvio (dopo l'accesso e dopo initAudioStore): rilegge le scelte e tiene allineato il dispositivo. */
export async function initDownloads() {
  if (started) return
  started = true
  const saved = (await readMeta(PINS_FILE)) as Partial<Pins> | null
  if (saved) patch({ pins: { tracks: saved.tracks ?? {}, folders: saved.folders ?? [], playlists: saved.playlists ?? [] } })
  else {
    // Scelte sparite ma brani scaricati presenti: non si buttano, diventano precaricati.
    for (const [id, file] of Object.entries(audioStore.get().files)) if (file.kind === 'download') setKind(Number(id), 'cache')
  }
  let library = libraryStore.get().library
  libraryStore.subscribe(() => {
    if (libraryStore.get().library === library) return
    library = libraryStore.get().library
    if (downloadsStore.get().pins.folders.length) scheduleSync()
  })
  let lists = playlistsStore.get().tracks
  playlistsStore.subscribe(() => {
    const next = playlistsStore.get().tracks
    if (next === lists) return
    const changed = downloadsStore.get().pins.playlists.some((id) => next[id] !== lists[id])
    lists = next
    if (changed) scheduleSync()
  })
  onlineStore.subscribe(() => onlineStore.get() && scheduleSync())
  scheduleSync()
}
