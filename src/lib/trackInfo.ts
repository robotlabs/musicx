// Cambiare titolo, artista, album, numero di traccia e nome del file di un brano.
// I tag stanno dentro il file: lo si scarica, si riscrive il tag (id3.ts) e lo si ricarica su pCloud
// al posto del vecchio. Il fileid resta lo stesso, quindi il brano resta nelle playlist, e pCloud
// tiene la versione precedente tra le revisioni. Il file si legge da rclone sul Mac e dal lato
// nativo nell'app Android: alle pagine web pCloud non lo dà.

import { writeTags, type TagChanges, type Tags } from './id3'
import {
  extensionOf,
  libraryStore,
  refreshLibrary,
  stripExtension,
  trackSubtitle,
  trackTags,
  trackTitle,
  updateTracks,
  type Track,
} from './library'
import { isRefererError, localUrl, whyNoFiles } from './localSource'
import { isNativeApp, nativeGetBytes } from './native'
import { fileLink, renameFile, uploadFile } from './pcloud'
import { updateQueueItems } from './player'
import { updatePlaylistTracks } from './playlists'

export const TAG_FIELDS = ['title', 'artist', 'album', 'track'] as const

/** Per ora i tag si riscrivono solo negli mp3 (13.690 file su circa 14.800); gli altri si possono rinominare. */
export const canWriteTags = (fileName: string) => extensionOf(fileName) === 'mp3'

/** Cosa cambiare: i campi del tag (stringa vuota = togli) e il nome del file senza estensione. */
export interface InfoChange extends TagChanges {
  name?: string
}

/** Senza accesso ai file non si può fare niente: inutile provare con gli altri brani. */
export class NoFileAccess extends Error {
  name = 'NoFileAccess'
}

/**
 * Quello che abbiamo scritto in questa sessione, per brano. rclone sul Mac può servire per qualche
 * minuto il file di prima: rimettendo anche questi campi, una seconda modifica non annulla la prima.
 */
const written = new Map<number, Tags>()

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) throw new Error(`Non riesco a leggere il file (${response.status}).`)
  return new Uint8Array(await response.arrayBuffer())
}

async function fileBytes(track: Track): Promise<Uint8Array> {
  const local = await localUrl(track.id)
  if (local) return fetchBytes(local)
  let url: string
  try {
    url = await fileLink(track.id, true)
  } catch (error) {
    if (isRefererError(error)) throw new NoFileAccess(await whyNoFiles())
    throw error
  }
  // blob: arriva solo dalla modalità finta di sviluppo.
  return isNativeApp && !url.startsWith('blob:') ? nativeGetBytes(url, 120_000) : fetchBytes(url)
}

/** Il nome completo nuovo, dopo aver controllato che sia valido e libero (pCloud sovrascriverebbe l'altro file). */
function newFileName(track: Track, base: string): string {
  const clean = base.trim()
  if (!clean) throw new Error('Il nome del file non può essere vuoto.')
  if (/[/\\]/.test(clean)) throw new Error('Il nome del file non può contenere / o \\.')
  if (clean.startsWith('.')) throw new Error('Il nome del file non può cominciare con un punto.')
  const name = clean + track.name.slice(track.name.length - extensionOf(track.name).length - 1)
  const library = libraryStore.get().library
  const siblings = library?.folders.get(track.parent)?.tracks ?? []
  const taken = siblings.some((id) => id !== track.id && library?.tracks.get(id)?.name.toLowerCase() === name.toLowerCase())
  if (taken) throw new Error(`C'è già un file "${name}" in questa cartella.`)
  return name
}

/** Dopo il salvataggio: indice, coda e playlist mostrano subito i nomi nuovi. */
function show(id: number, change: Partial<Track>) {
  updateTracks(new Map([[id, change]]))
  const library = libraryStore.get().library
  const track = library?.tracks.get(id)
  if (!library || !track) return
  const looks = { title: trackTitle(track), sub: trackSubtitle(library, track), file: track.name }
  updateQueueItems((item) => (item.id === id ? { ...item, ...looks } : item))
  updatePlaylistTracks((item) => (item.id === id ? { ...item, ...looks } : item))
}

let saving: Promise<unknown> = Promise.resolve()

/**
 * Salva le modifiche di un brano: prima i tag (nel file), poi il nome. Un salvataggio alla volta:
 * due caricamenti dello stesso file insieme (per esempio "Modifica info" mentre si salva l'ordine
 * della cartella) si annullerebbero a vicenda.
 */
export function saveTrackInfo(id: number, change: InfoChange): Promise<void> {
  const run = saving.then(() => save(id, change))
  saving = run.catch(() => {})
  return run
}

async function save(id: number, change: InfoChange): Promise<void> {
  const track = libraryStore.get().library?.tracks.get(id)
  if (!track) throw new Error('Il brano non è nella libreria.')

  const tags: TagChanges = {}
  for (const key of TAG_FIELDS) if (change[key] !== undefined) tags[key] = change[key].trim()
  const renameTo = change.name !== undefined && change.name.trim() !== stripExtension(track.name) ? newFileName(track, change.name) : null
  const result: Partial<Track> = {}

  if (Object.keys(tags).length) {
    if (!canWriteTags(track.name)) throw new Error(`Nei file .${extensionOf(track.name)} per ora posso cambiare solo il nome.`)
    const wanted = { ...written.get(id), ...tags }
    const raw = await uploadFile(track.parent, track.name, writeTags(await fileBytes(track), wanted))
    written.set(id, wanted)
    if (raw.fileid !== id) {
      // Non dovrebbe succedere (pCloud tiene l'id quando sovrascrive): meglio rileggere tutto.
      void refreshLibrary()
      return
    }
    // Quello che ha letto pCloud dal file nuovo; se non l'ha ancora letto, quello che abbiamo scritto.
    const read = trackTags(raw)
    for (const key of TAG_FIELDS) result[key] = read[key] ?? (wanted[key] || undefined)
  }
  if (renameTo) result.name = (await renameFile(id, renameTo)).name

  show(id, result)
}

export interface ManyResult {
  saved: number
  /** File in cui i tag non si possono scrivere (non mp3). */
  skipped: number
  failed: number
  /** Il primo errore, da mostrare. */
  firstError: unknown
}

/**
 * Gli stessi campi su tanti brani, uno alla volta. `progress` dice a che punto siamo; `stopped`
 * ferma il lavoro tra un brano e l'altro.
 */
export async function saveManyInfo(
  ids: number[],
  change: TagChanges,
  progress: (done: number, total: number) => void,
  stopped: () => boolean,
): Promise<ManyResult> {
  const library = libraryStore.get().library
  const writable = ids.filter((id) => {
    const track = library?.tracks.get(id)
    return track && canWriteTags(track.name)
  })
  const result: ManyResult = { saved: 0, skipped: ids.length - writable.length, failed: 0, firstError: null }
  for (const [index, id] of writable.entries()) {
    if (stopped()) break
    progress(index, writable.length)
    try {
      await saveTrackInfo(id, change)
      result.saved++
    } catch (error) {
      result.failed++
      result.firstError ??= error
      if (error instanceof NoFileAccess) break
    }
  }
  progress(writable.length, writable.length)
  return result
}
