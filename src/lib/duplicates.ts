// Doppioni nella libreria. Due tipi:
// - identici: stesso contenuto (pCloud dà a ogni file un'impronta, `hash`, e la dimensione);
// - stesso brano: stesso artista e titolo (dai tag o, senza tag, dal nome del file) ma file diversi,
//   per esempio un mp3 e un flac, o due rip diversi.

import { normalize, stripExtension, type Library, type Track } from './library'

const collator = new Intl.Collator('it', { numeric: true, sensitivity: 'base' })

export interface Duplicates {
  /** Gruppi di brani identici (almeno 2 per gruppo). */
  same: number[][]
  /** Gruppi dello stesso brano in file diversi. */
  similar: number[][]
  /** Brani senza impronta: l'indice è di prima, va riletta la libreria. */
  unknown: number
}

/** Titolo senza numero di traccia davanti né parentesi ("(Remastered)", "[Live]"). */
const cleanTitle = (text: string) =>
  normalize(text)
    .replace(/[([{].*?[)\]}]/g, ' ')
    .replace(/^\s*(?:track\s*)?\d{1,3}\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()

const cleanArtist = (text: string) => normalize(text).replace(/\s+/g, ' ').trim()

const plainTitle = (track: Track) => cleanTitle(track.title ?? stripExtension(track.name))

/**
 * I brani della libreria che sono già questa canzone: stesso titolo (senza parentesi né numeri) e
 * stesso artista nel tag; un brano senza artista nel tag vale se l'artista è nel nome del file o
 * della sua cartella.
 */
export function findSong(library: Library, artist: string, title: string): Track[] {
  const wantedTitle = cleanTitle(title)
  const wantedArtist = cleanArtist(artist)
  if (wantedTitle.length < 2) return []
  return [...library.tracks.values()].filter((track) => {
    if (plainTitle(track) !== wantedTitle) return false
    if (!wantedArtist) return true
    if (track.artist) return cleanArtist(track.artist) === wantedArtist
    const where = normalize(`${track.name} ${library.folders.get(track.parent)?.name ?? ''}`)
    return where.includes(wantedArtist)
  })
}

/** Chiave "stesso brano": artista e titolo. Senza artista nel tag vale il nome del file da solo. */
function songKey(track: Track): string | null {
  const title = plainTitle(track)
  if (title.length < 2) return null
  const artist = track.artist ? cleanArtist(track.artist) : ''
  return `${artist}|${title}`
}

function groups(tracks: Iterable<Track>, keyOf: (track: Track) => string | null): number[][] {
  const byKey = new Map<string, number[]>()
  for (const track of tracks) {
    const key = keyOf(track)
    if (key === null) continue
    const group = byKey.get(key)
    if (group) group.push(track.id)
    else byKey.set(key, [track.id])
  }
  return [...byKey.values()].filter((group) => group.length > 1)
}

export function findDuplicates(library: Library): Duplicates {
  const tracks = [...library.tracks.values()]
  const contentOf = (track: Track) => (track.hash === undefined ? null : `${track.hash}:${track.size ?? ''}`)
  const same = groups(tracks, contentOf)
  // Lo stesso brano conta solo se ci sono almeno due contenuti diversi (gli identici sono già sopra).
  const similar = groups(tracks, songKey).filter((group) => {
    const contents = new Set(group.map((id) => contentOf(library.tracks.get(id)!) ?? `?${id}`))
    return contents.size > 1
  })
  // In ordine di artista e titolo, come si cercherebbero a mano.
  const nameOf = (group: number[]) => {
    const track = library.tracks.get(group[0])!
    return `${track.artist ?? ''} ${track.title ?? track.name}`
  }
  const byName = (a: number[], b: number[]) => collator.compare(nameOf(a), nameOf(b))
  return {
    same: same.sort(byName),
    similar: similar.sort(byName),
    unknown: tracks.filter((track) => track.hash === undefined).length,
  }
}
