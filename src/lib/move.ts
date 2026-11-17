// Spostare brani e cartelle in un'altra cartella di pCloud. Lo sposta pCloud, quindi è sempre lo
// stesso file (stesso fileid) e resta nelle playlist; l'indice si aggiorna subito, senza rileggere
// la libreria. Sul Mac rclone se ne accorge da solo dopo pochi secondi.

import { libraryStore, trackSubtitle, updateTracks, type FolderPlace } from './library'
import { createFolder, listFolder, moveFile, moveFolder, type RawMeta } from './pcloud'
import { updateQueueItems } from './player'
import { updatePlaylistTracks } from './playlists'
import { storageKey } from './env'

/** Una cartella lungo un percorso: dalla cartella della musica (la prima) a quella scelta (l'ultima). */
export interface Step {
  id: number
  name: string
}

/** Nomi uguali per pCloud: meglio fermarsi anche a maiuscole diverse che sostituire un file. */
const nameKey = (name: string) => name.toLocaleLowerCase('it')

/** Le cartelle del percorso (tranne la prima, la cartella della musica) da mettere nell'indice. */
function placesOf(trail: Step[]): Map<number, FolderPlace> {
  const places = new Map<number, FolderPlace>()
  for (let i = 1; i < trail.length; i++) places.set(trail[i].id, { parent: trail[i - 1].id, name: trail[i].name })
  return places
}

/** Le sottocartelle, in ordine di nome (quelle nascoste no). */
export async function subfolders(folderId: number): Promise<Step[]> {
  const listing = await listFolder(folderId, true)
  const collator = new Intl.Collator('it', { numeric: true, sensitivity: 'base' })
  return (listing.contents ?? [])
    .filter((entry) => entry.isfolder && entry.folderid !== undefined && !entry.name.startsWith('.'))
    .map((entry) => ({ id: entry.folderid!, name: entry.name }))
    .sort((a, b) => collator.compare(a.name, b.name))
}

/** Crea una sottocartella (o trova quella che c'è già con quel nome). */
export async function newSubfolder(parentId: number, name: string): Promise<Step> {
  const clean = name.trim()
  if (!clean) throw new Error('Il nome non può essere vuoto.')
  if (/[/\\]/.test(clean)) throw new Error('Il nome non può contenere / o \\.')
  if (clean.startsWith('.')) throw new Error('Il nome non può cominciare con un punto.')
  const meta = await createFolder(parentId, clean)
  return { id: meta.folderid!, name: meta.name }
}

export interface MoveResult {
  moved: number
  /** Brani non spostati perché là c'è già un file con lo stesso nome (pCloud lo sostituirebbe). */
  clashes: string[]
  failed: number
  firstError: unknown
}

/** Quanti spostamenti insieme: abbastanza per non aspettare troppo, pochi per non disturbare pCloud. */
const AT_ONCE = 4

/** Sposta dei brani nell'ultima cartella di `trail`. */
export async function moveTracks(ids: number[], trail: Step[]): Promise<MoveResult> {
  const target = trail[trail.length - 1].id
  const library = libraryStore.get().library
  const todo = ids.filter((id) => {
    const track = library?.tracks.get(id)
    return track && track.parent !== target
  })
  const result: MoveResult = { moved: 0, clashes: [], failed: 0, firstError: null }
  if (!todo.length) return result

  // Cosa c'è adesso nella cartella (l'indice potrebbe non saperlo: file non audio, cartelle vuote).
  const taken = new Set(((await listFolder(target)).contents ?? []).map((entry: RawMeta) => nameKey(entry.name)))
  const places = placesOf(trail)
  const queue = [...todo]
  const worker = async () => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      const track = libraryStore.get().library?.tracks.get(id)
      if (!track) continue
      const key = nameKey(track.name)
      if (taken.has(key)) {
        result.clashes.push(track.name)
        continue
      }
      // Prenotato prima di chiamare pCloud: due brani con lo stesso nome non finiscono uno sull'altro.
      taken.add(key)
      try {
        await moveFile(id, target)
        updateTracks(new Map([[id, { parent: target }]]), places)
        result.moved++
      } catch (error) {
        taken.delete(key)
        result.failed++
        result.firstError ??= error
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, todo.length) }, worker))

  // Coda e playlist: senza artista il sottotitolo è il nome della cartella; "Vai alla cartella" porta a quella nuova.
  const now = libraryStore.get().library
  if (now) {
    const moved = new Set(todo.filter((id) => now.tracks.get(id)?.parent === target))
    const subOf = (id: number) => trackSubtitle(now, now.tracks.get(id)!)
    updateQueueItems((item) => (moved.has(item.id) ? { ...item, sub: subOf(item.id) } : item))
    updatePlaylistTracks((item) => (moved.has(item.id) ? { ...item, sub: subOf(item.id), parent: target } : item))
  }
  return result
}

/** Sposta una cartella (con tutto quello che c'è dentro) nell'ultima cartella di `trail`. */
export async function moveFolderTo(folderId: number, trail: Step[]): Promise<void> {
  const target = trail[trail.length - 1].id
  const folder = libraryStore.get().library?.folders.get(folderId)
  if (!folder) throw new Error('La cartella non è nella libreria.')
  if (folder.parent === target) return
  if (trail.some((step) => step.id === folderId)) throw new Error('Una cartella non può andare dentro sé stessa.')
  const listing = await listFolder(target)
  if ((listing.contents ?? []).some((entry) => nameKey(entry.name) === nameKey(folder.name))) {
    throw new Error(`In "${trail[trail.length - 1].name}" c'è già qualcosa che si chiama "${folder.name}".`)
  }
  await moveFolder(folderId, target)
  updateTracks(new Map(), new Map([...placesOf(trail), [folderId, { parent: target, name: folder.name }]]))
}

// L'ultima cartella in cui si è spostato qualcosa: riorganizzando la si riusa spesso.
const lastKey = () => storageKey('move-last')

export function lastDestination(): Step[] | null {
  try {
    const trail = JSON.parse(localStorage.getItem(lastKey()) ?? 'null') as Step[] | null
    return Array.isArray(trail) && trail.length ? trail : null
  } catch {
    return null
  }
}

export function rememberDestination(trail: Step[]) {
  try {
    localStorage.setItem(lastKey(), JSON.stringify(trail))
  } catch {
    // Pazienza: la prossima volta si naviga.
  }
}
