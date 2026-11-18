import { useCallback, useMemo } from 'react'
import { downloadsStore } from '../lib/downloads'
import { canReorder, moveFolderTrack, orderStore } from '../lib/folderOrder'
import {
  folderTrail,
  libraryStore,
  queueItems,
  refreshLibrary,
  tracksUnder,
  type Folder,
  type Library,
} from '../lib/library'
import { playerStore, playItems, playShuffled } from '../lib/player'
import { navigate, routeHref } from '../lib/router'
import { useStore } from '../lib/store'
import { openTrackMenu, queueMenuItems } from './actions'
import { DownloadToggle, folderDownloadItems, SavedMark, useDownloadedCount } from './downloadActions'
import { editTracksInfo } from './editInfo'
import { Icon } from './icons'
import { dragTracks, useDropTargets } from './drag'
import { moveFolderFlow, moveFolderInto, moveTracksTo, stepsTo } from './moveTo'
import { Notice, TrackRow } from './parts'
import { Grip, shiftOf, useDragReorder } from './reorder'
import { useSelection } from './selection'
import { confirmAction, openMenu, toast } from './sheets'
import { errorText, tracksLabel } from './text'

export function FolderView({ id }: { id: number | null }) {
  const { status, library, error } = useStore(libraryStore)
  if (!library) {
    if (status === 'error') {
      return <Notice title="Non riesco a leggere la libreria" body={error} action={{ label: 'Riprova', run: () => void refreshLibrary() }} />
    }
    return <Notice loading title="Leggo la libreria da pCloud…" body="La prima volta può volerci un po'." />
  }
  const folder = library.folders.get(id ?? library.rootId)
  if (!folder) {
    return (
      <Notice
        title="Cartella non trovata"
        body="Forse è stata spostata o rinominata su pCloud."
        action={{ label: 'Torna alla libreria', run: () => navigate({ name: 'folder', id: null }) }}
      />
    )
  }
  return <FolderContent library={library} folder={folder} />
}

function FolderContent({ library, folder }: { library: Library; folder: Folder }) {
  const currentId = useStore(playerStore, (state) => state.items[state.index]?.id)
  const playing = useStore(playerStore, (state) => state.playing)
  const items = useMemo(() => queueItems(library, folder.tracks), [library, folder])
  const isRoot = folder.id === library.rootId
  const selection = useSelection(items, isRoot ? 'Libreria' : folder.name)

  // Trascinando la maniglia l'ordine diventa il numero di traccia scritto nei file (folderOrder.ts).
  const reorderable = useMemo(() => canReorder(folder.id), [library, folder])
  const saving = useStore(orderStore, (state) => (state?.folder === folder.id ? state : null))
  const folderId = folder.id
  const reorder = useCallback(
    (from: number, to: number) =>
      void moveFolderTrack(
        folderId,
        from,
        to,
        (files) =>
          confirmAction(
            'Riordinare la cartella?',
            `Per salvare quest'ordine scrivo il numero di traccia in ${files} file: ognuno va scaricato e ricaricato su pCloud, e ci vorrà un po'.`,
            'Riordina',
          ),
        (problem) => toast(`L'ordine non è stato salvato: ${errorText(problem)}`),
      ),
    [folderId],
  )
  const { drag, start, move, end } = useDragReorder(reorderable ? items.length : 0, reorder)

  const trail = folderTrail(library, folder.id)
  const everything = (target: Folder) => queueItems(library, tracksUnder(library, target.id))
  const allIds = useMemo(() => tracksUnder(library, folder.id), [library, folder])
  const downloaded = useDownloadedCount(allIds)
  const pinnedFolders = useStore(downloadsStore, (state) => state.pins.folders)

  // Sul Mac brani e cartelle si trascinano su una cartella della lista o del percorso in alto: ci si spostano.
  const { dragged, over, target: dropTarget } = useDropTargets()
  const dropOn = (destId: number) => {
    const key = `folder-${destId}`
    let onDrop: (() => void) | null = null
    if (dragged?.kind === 'tracks') {
      const dest = stepsTo(library, destId)
      const moving = dragged.folder
      if (moving !== undefined) {
        const source = library.folders.get(moving)
        if (source && source.parent !== destId && !dest.some((step) => step.id === moving)) onDrop = () => void moveFolderInto(moving, dest)
      } else if (dragged.ids.some((trackId) => library.tracks.get(trackId)?.parent !== destId)) {
        onDrop = () => void moveTracksTo(dragged.ids, dest)
      }
    }
    return { props: dropTarget(key, onDrop, undefined, 'move'), over: onDrop !== null && over === key }
  }

  const openFolderMenu = (target: Folder) =>
    openMenu(
      target.name,
      [
        { label: 'Riproduci', icon: 'play', onSelect: () => playItems(everything(target)) },
        { label: 'Riproduci in ordine casuale', icon: 'shuffle', onSelect: () => playShuffled(everything(target)) },
        ...queueMenuItems(everything(target)),
        ...(target.id === library.rootId
          ? []
          : [
              ...folderDownloadItems(target.id, target.total),
              { label: 'Sposta in cartella…', icon: 'moveTo' as const, onSelect: () => void moveFolderFlow(target.id) },
              { label: 'Modifica info dei brani', icon: 'edit' as const, onSelect: () => editTracksInfo(tracksUnder(library, target.id)) },
            ]),
      ],
      tracksLabel(target.total),
    )

  return (
    <>
      {!isRoot && (
        <nav className="crumbs" aria-label="Percorso">
          {trail.slice(0, -1).map((step, i) => {
            const drop = dropOn(step.id)
            return (
              <span key={step.id}>
                <a href={routeHref({ name: 'folder', id: i === 0 ? null : step.id })} className={drop.over ? 'drop-over' : undefined} {...drop.props}>
                  {i === 0 ? 'Libreria' : step.name}
                </a>
                <Icon name="chevron" size={14} />
              </span>
            )
          })}
        </nav>
      )}
      <header className="view-head">
        <h1>{isRoot ? 'Libreria' : folder.name}</h1>
        <p className="dim">
          {tracksLabel(folder.total)}
          {downloaded > 0 && ` · ${downloaded === folder.total ? 'tutti scaricati' : `${downloaded} scaricati`}`}
          {saving && ` · Salvo l'ordine nei file: ${Math.min(saving.done + 1, saving.total)} di ${saving.total}…`}
        </p>
        {folder.total > 0 && (
          <div className="head-actions">
            <button className="pill primary" onClick={() => playItems(everything(folder))}>
              <Icon name="play" size={16} /> Riproduci
            </button>
            <button className="pill" onClick={() => playShuffled(everything(folder))}>
              <Icon name="shuffle" size={16} /> Casuale
            </button>
            {!isRoot && <DownloadToggle kind="folder" id={folder.id} count={folder.total} />}
            <button className="icon-button" aria-label="Altre azioni" onClick={() => openFolderMenu(folder)}>
              <Icon name="more" />
            </button>
          </div>
        )}
      </header>
      {folder.total === 0 && <Notice title="Nessun brano qui" body="In questa cartella di pCloud non c'è musica." />}
      <ul className={`rows${drag ? ' reordering' : ''}`}>
        {folder.folders.map((childId) => {
          const child = library.folders.get(childId)!
          const drop = dropOn(childId)
          return (
            <li
              className={`row${drop.over ? ' drop-over' : ''}`}
              key={`folder-${childId}`}
              {...dragTracks(() => ({ ids: tracksUnder(library, childId), label: child.name, folder: childId }))}
              {...drop.props}
            >
              <a className="row-main" href={routeHref({ name: 'folder', id: childId })}>
                <span className="row-icon folder">
                  <Icon name="folder" size={18} />
                </span>
                <span className="row-text">
                  <span className="row-title">{child.name}</span>
                  <span className="row-sub">
                    {pinnedFolders.includes(childId) && <SavedMark />}
                    {tracksLabel(child.total)}
                  </span>
                </span>
              </a>
              <button className="icon-button" aria-label={`Azioni per ${child.name}`} onClick={() => openFolderMenu(child)}>
                <Icon name="more" />
              </button>
            </li>
          )
        })}
        {items.map((item, i) => (
          <TrackRow
            key={item.id}
            item={item}
            active={item.id === currentId}
            playing={playing}
            onPlay={() => playItems(items, i)}
            onMenu={() => openTrackMenu(item, { selected: selection.selectedWith(i)?.map((row) => items[row]) })}
            drag={() => selection.dragFrom(i)}
            selected={selection.rows.has(i)}
            onSelect={selection.select && ((event) => selection.select?.(i, event))}
            className={drag?.from === i ? 'dragged' : undefined}
            style={drag ? { transform: `translateY(${shiftOf(drag, i)}px)` } : undefined}
            leading={reorderable && <Grip index={i} onGrab={start} onDrag={move} onDrop={end} />}
          />
        ))}
      </ul>
    </>
  )
}
