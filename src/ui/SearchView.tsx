import { useDeferredValue, useMemo } from 'react'
import { libraryStore, searchLibrary, toQueueItem, tracksUnder } from '../lib/library'
import { playerStore, playItems } from '../lib/player'
import { routeHref } from '../lib/router'
import { useStore } from '../lib/store'
import { openTrackMenu } from './actions'
import { dragSource } from './dragTracks'
import { Icon } from './icons'
import { Notice, TrackRow } from './parts'
import { tracksLabel } from './text'

export function SearchView({ query }: { query: string }) {
  const library = useStore(libraryStore, (state) => state.library)
  const currentId = useStore(playerStore, (state) => state.items[state.index]?.id)
  const playing = useStore(playerStore, (state) => state.playing)
  // Digitando veloce la lista segue con un attimo di ritardo invece di bloccare la tastiera.
  const deferredQuery = useDeferredValue(query)
  const found = useMemo(() => {
    if (!library) return null
    const result = searchLibrary(library, deferredQuery)
    return { ...result, items: result.tracks.map((track) => toQueueItem(library, track)) }
  }, [library, deferredQuery])

  if (!found) return <Notice loading title="Leggo la libreria da pCloud…" />
  if (!query.trim()) return <Notice title="Cerca nella libreria" body="Titolo, artista, album o nome della cartella." />
  if (!found.folders.length && !found.items.length) {
    return <Notice title="Nessun risultato" body={`Niente che contenga "${query.trim()}".`} />
  }

  return (
    <>
      {found.folders.length > 0 && (
        <>
          <h2 className="section">Cartelle</h2>
          <ul className="rows">
            {found.folders.map((folder) => (
              <li
                className="row"
                key={folder.id}
                {...dragSource(() => {
                  const library = libraryStore.get().library
                  return library ? { ids: tracksUnder(library, folder.id), label: folder.name } : null
                })}
              >
                <a className="row-main" href={routeHref({ name: 'folder', id: folder.id })}>
                  <span className="row-icon folder">
                    <Icon name="folder" size={18} />
                  </span>
                  <span className="row-text">
                    <span className="row-title">{folder.name}</span>
                    <span className="row-sub">{tracksLabel(folder.total)}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
      {found.items.length > 0 && (
        <>
          <h2 className="section">Brani</h2>
          <ul className="rows">
            {found.items.map((item, i) => (
              <TrackRow
                key={item.id}
                item={item}
                active={item.id === currentId}
                playing={playing}
                onPlay={() => playItems(found.items, i)}
                onMenu={() => openTrackMenu(item, { parent: found.tracks[i].parent })}
                draggable
              />
            ))}
          </ul>
        </>
      )}
      {found.truncated && <p className="dim footnote">Ci sono altri risultati: aggiungi una parola per restringere.</p>}
    </>
  )
}
