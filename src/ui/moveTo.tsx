// "Sposta in cartella…": si sceglie la cartella navigando le cartelle vere di pCloud (anche quelle
// ancora vuote, che l'indice non ha), se ne può creare una nuova, e lo spostamento lo fa pCloud.

import { useEffect, useState, type FormEvent } from 'react'
import { folderTrail, libraryStore, trackTitle, type Library } from '../lib/library'
import {
  lastDestination,
  moveFolderTo,
  moveTracks,
  newSubfolder,
  rememberDestination,
  subfolders,
  type MoveResult,
  type Step,
} from '../lib/move'
import { Icon } from './icons'
import { closeSheet, showSheet, toast } from './sheets'
import { errorText, tracksLabel } from './text'

/** Il percorso dalla cartella della musica ("Libreria") a `folderId`. */
export function stepsTo(library: Library, folderId: number): Step[] {
  return folderTrail(library, folderId).map((folder) => ({ id: folder.id, name: folder.id === library.rootId ? 'Libreria' : folder.name }))
}

const lastOf = (trail: Step[]) => trail[trail.length - 1]

function FolderPicker(props: {
  title: string
  start: Step[]
  /** Dove sono già: lì "Sposta qui" non serve. */
  current: number | null
  /** La cartella che si sta spostando: non ci si può entrare. */
  blocked: number | null
  /** Il pulsante che conferma (di solito "Sposta qui"). */
  confirm?: string
  onDone: (trail: Step[] | null) => void
}) {
  const [trail, setTrail] = useState(props.start)
  const [children, setChildren] = useState<Step[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [last] = useState(lastDestination)
  const here = lastOf(trail)

  useEffect(() => {
    let live = true
    setChildren(null)
    setProblem(null)
    subfolders(here.id).then(
      (list) => live && setChildren(list),
      (error) => live && setProblem(errorText(error)),
    )
    return () => {
      live = false
    }
  }, [here.id])

  const crosses = (steps: Step[]) => props.blocked !== null && steps.some((step) => step.id === props.blocked)
  const go = (next: Step[]) => {
    setNaming(false)
    setTrail(next)
  }
  const create = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      const made = await newSubfolder(here.id, name)
      setName('')
      go([...trail, made])
    } catch (error) {
      setProblem(errorText(error))
    } finally {
      setBusy(false)
    }
  }

  const showLast = last && lastOf(last).id !== here.id && !crosses(last)
  const canMoveHere = here.id !== props.current && !crosses(trail)

  return (
    <div className="picker">
      <header className="sheet-head">
        <div className="sheet-title">{props.title}</div>
        <div className="sheet-sub">{trail.map((step) => step.name).join(' ▸ ')}</div>
      </header>
      <ul className="menu folder-picker">
        {trail.length > 1 && (
          <li>
            <button onClick={() => go(trail.slice(0, -1))}>
              <Icon name="up" />
              <span>{trail[trail.length - 2].name}</span>
              <small>su</small>
            </button>
          </li>
        )}
        {last && showLast && (
          <li>
            <button onClick={() => go(last)}>
              <Icon name="moveTo" />
              <span>{lastOf(last).name}</span>
              <small>ultima usata</small>
            </button>
          </li>
        )}
        <li>
          {naming ? (
            <form className="new-folder" onSubmit={create}>
              <input autoFocus value={name} placeholder="Nome della cartella" onChange={(event) => setName(event.target.value)} />
              <button type="submit" className="pill primary" disabled={!name.trim() || busy}>
                Crea
              </button>
            </form>
          ) : (
            <button onClick={() => setNaming(true)}>
              <Icon name="folderPlus" />
              <span>Nuova cartella qui…</span>
            </button>
          )}
        </li>
        {problem && <li className="menu-note danger">{problem}</li>}
        {!problem && children === null && <li className="menu-note">Leggo le cartelle…</li>}
        {children?.length === 0 && <li className="menu-note">Nessuna sottocartella.</li>}
        {children?.map((child) => (
          <li key={child.id}>
            <button disabled={child.id === props.blocked} onClick={() => go([...trail, child])}>
              <Icon name="folder" />
              <span>{child.name}</span>
              {child.id === props.blocked ? <small>è questa</small> : <Icon name="chevron" size={16} />}
            </button>
          </li>
        ))}
      </ul>
      <div className="dialog-actions picker-actions">
        <button onClick={() => props.onDone(null)}>Annulla</button>
        <button className="primary" disabled={!canMoveHere} onClick={() => props.onDone(trail)}>
          {props.confirm ?? 'Sposta qui'}
        </button>
      </div>
    </div>
  )
}

/** Fa scegliere una cartella. Restituisce il percorso fino a quella scelta, o null se annullato. */
/** Fa scegliere una cartella vera di pCloud (anche vuota, o nuova). Restituisce il percorso fino a lì. */
export function chooseFolder(
  title: string,
  options: { start: Step[]; current: number | null; blocked?: number; confirm?: string },
): Promise<Step[] | null> {
  return new Promise((resolve) => {
    const done = (trail: Step[] | null) => {
      closeSheet()
      resolve(trail)
    }
    showSheet(
      <FolderPicker
        title={title}
        start={options.start}
        current={options.current}
        blocked={options.blocked ?? null}
        confirm={options.confirm}
        onDone={done}
      />,
      () => resolve(null),
    )
  })
}

function resultText(result: MoveResult, asked: number, where: string): string {
  const parts: string[] = []
  if (result.moved === 1) parts.push(asked === 1 ? `Spostato in "${where}".` : `1 brano spostato in "${where}".`)
  else if (result.moved > 1) parts.push(`${tracksLabel(result.moved)} spostati in "${where}".`)
  if (result.clashes.length === 1) parts.push(`"${result.clashes[0]}" no: là c'è già un file con quel nome.`)
  else if (result.clashes.length > 1) parts.push(`${result.clashes.length} no: là ci sono già file con quei nomi.`)
  if (result.failed) parts.push(`${result.failed === 1 ? '1 non spostato' : `${result.failed} non spostati`}: ${errorText(result.firstError)}`)
  if (!parts.length) return asked === 1 ? `È già in "${where}".` : `Sono già in "${where}".`
  return parts.join(' ')
}

/** Sposta dei brani nell'ultima cartella di `trail` e dice com'è andata. */
export async function moveTracksTo(ids: number[], trail: Step[]) {
  rememberDestination(trail)
  const where = lastOf(trail).name
  if (ids.length > 4) toast(`Sposto ${tracksLabel(ids.length)} in "${where}"…`)
  try {
    toast(resultText(await moveTracks(ids, trail), ids.length, where))
  } catch (error) {
    toast(errorText(error))
  }
}

/** Sposta una cartella nell'ultima di `trail` e dice com'è andata. */
export async function moveFolderInto(folderId: number, trail: Step[]) {
  rememberDestination(trail)
  const name = libraryStore.get().library?.folders.get(folderId)?.name ?? 'La cartella'
  try {
    await moveFolderTo(folderId, trail)
    toast(`"${name}" spostata in "${lastOf(trail).name}".`)
  } catch (error) {
    toast(errorText(error))
  }
}

/** "Sposta in cartella…" per uno o più brani. Si parte dalla cartella sopra la loro, con le cartelle vicine. */
export async function moveTracksFlow(ids: number[]) {
  const library = libraryStore.get().library
  const tracks = ids.flatMap((id) => library?.tracks.get(id) ?? [])
  if (!library || !tracks.length) return
  const from = tracks[0].parent
  const above = library.folders.get(from)?.parent ?? -1
  const start = stepsTo(library, library.folders.has(above) ? above : from)
  const together = tracks.every((track) => track.parent === from)
  const title = tracks.length === 1 ? `Sposta "${trackTitle(tracks[0])}"` : `Sposta ${tracksLabel(tracks.length)}`
  const trail = await chooseFolder(title, { start, current: together ? from : null })
  if (trail) await moveTracksTo(tracks.map((track) => track.id), trail)
}

/** "Sposta in cartella…" per una cartella intera. */
export async function moveFolderFlow(folderId: number) {
  const library = libraryStore.get().library
  const folder = library?.folders.get(folderId)
  if (!library || !folder || folderId === library.rootId) return
  const trail = await chooseFolder(`Sposta "${folder.name}"`, { start: stepsTo(library, folder.parent), current: folder.parent, blocked: folderId })
  if (trail) await moveFolderInto(folderId, trail)
}
