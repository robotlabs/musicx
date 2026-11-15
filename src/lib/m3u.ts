// Import delle vecchie playlist .m3u. Le righe possono essere percorsi locali
// (file:///Users/.../pCloud Drive/rob/music/...), URL del vecchio server rclone
// (http://127.0.0.1:8620/...) o percorsi relativi: contano solo le ultime cartelle.

import { folderTrail, type Library } from './library'

/** Estrae dal testo i riferimenti ai brani, uno per riga non di commento. */
export function parseM3u(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
}

const canonical = (path: string) => path.normalize('NFC').toLowerCase()

function decode(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

/** Riduce una riga a segmenti di percorso, senza schema né host. */
function segmentsOf(reference: string): string[] {
  const path = /^[a-z][a-z0-9+.-]*:\/\//i.test(reference) ? reference.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '') : reference
  return path
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .map((segment) => canonical(decode(segment)))
}

/** Percorso relativo alla radice della musica → id del brano. */
function pathIndex(library: Library): Map<string, number> {
  const folderPaths = new Map<number, string>()
  const pathOf = (folderId: number) => {
    let path = folderPaths.get(folderId)
    if (path === undefined) {
      // La radice non entra nel percorso.
      path = folderTrail(library, folderId)
        .slice(1)
        .map((folder) => canonical(folder.name))
        .join('/')
      folderPaths.set(folderId, path)
    }
    return path
  }
  const index = new Map<string, number>()
  for (const track of library.tracks.values()) {
    const folder = pathOf(track.parent)
    index.set((folder ? `${folder}/` : '') + canonical(track.name), track.id)
  }
  return index
}

export interface M3uMatch {
  /** Brani trovati, nell'ordine della playlist e senza doppioni. */
  trackIds: number[]
  /** Righe che non corrispondono a nessun brano della libreria. */
  missing: string[]
}

/** Per ogni riga cerca il brano il cui percorso coincide con la coda più lunga possibile della riga. */
export function matchM3u(library: Library, references: string[]): M3uMatch {
  const index = pathIndex(library)
  const found = new Set<number>()
  const missing: string[] = []
  for (const reference of references) {
    const segments = segmentsOf(reference)
    let id: number | undefined
    for (let start = 0; start < segments.length && id === undefined; start++) {
      id = index.get(segments.slice(start).join('/'))
    }
    if (id === undefined) missing.push(reference)
    else found.add(id)
  }
  return { trackIds: [...found], missing }
}
