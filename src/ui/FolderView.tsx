import { useMemo } from 'react'
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
import { Icon } from './icons'
import { Notice, TrackRow } from './parts'
import { openMenu } from './sheets'
import { tracksLabel } from './text'

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
  const trail = folderTrail(library, folder.id)
  const everything = (target: Folder) => queueItems(library, tracksUnder(library, target.id))

  const openFolderMenu = (target: Folder) =>
    openMenu(
      target.name,
      [
        { label: 'Riproduci', icon: 'play', onSelect: () => playItems(everything(target)) },
        { label: 'Riproduci in ordine casuale', icon: 'shuffle', onSelect: () => playShuffled(everything(target)) },
        ...queueMenuItems(everything(target)),
      ],
      tracksLabel(target.total),
    )

  return (
    <>
      {!isRoot && (
        <nav className="crumbs" aria-label="Percorso">
          {trail.slice(0, -1).map((step, i) => (
            <span key={step.id}>
              <a href={routeHref({ name: 'folder', id: i === 0 ? null : step.id })}>{i === 0 ? 'Libreria' : step.name}</a>
              <Icon name="chevron" size={14} />
            </span>
          ))}
        </nav>
      )}
      <header className="view-head">
        <h1>{isRoot ? 'Libreria' : folder.name}</h1>
        <p className="dim">{tracksLabel(folder.total)}</p>
        {folder.total > 0 && (
          <div className="head-actions">
            <button className="pill primary" onClick={() => playItems(everything(folder))}>
              <Icon name="play" size={16} /> Riproduci
            </button>
            <button className="pill" onClick={() => playShuffled(everything(folder))}>
              <Icon name="shuffle" size={16} /> Casuale
            </button>
            <button className="icon-button" aria-label="Altre azioni" onClick={() => openFolderMenu(folder)}>
              <Icon name="more" />
            </button>
          </div>
        )}
      </header>
      {folder.total === 0 && <Notice title="Nessun brano qui" body="In questa cartella di pCloud non c'è musica." />}
      <ul className="rows">
        {folder.folders.map((childId) => {
          const child = library.folders.get(childId)!
          return (
            <li className="row" key={`folder-${childId}`}>
              <a className="row-main" href={routeHref({ name: 'folder', id: childId })}>
                <span className="row-icon folder">
                  <Icon name="folder" size={18} />
                </span>
                <span className="row-text">
                  <span className="row-title">{child.name}</span>
                  <span className="row-sub">{tracksLabel(child.total)}</span>
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
            onMenu={() => openTrackMenu(item)}
          />
        ))}
      </ul>
    </>
  )
}
