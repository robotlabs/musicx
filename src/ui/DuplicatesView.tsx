// Doppioni: file identici e lo stesso brano in file diversi, con dove stanno e cosa farne.

import { useMemo } from 'react'
import { findDuplicates } from '../lib/duplicates'
import { folderTrail, libraryStore, refreshLibrary, toQueueItem, type Library } from '../lib/library'
import { deleteTracks } from './actions'
import { playItems } from './play'
import { navigate } from '../lib/router'
import { useStore } from '../lib/store'
import { Icon } from './icons'
import { Notice } from './parts'
import { sizeLabel } from './StorageView'
import { openMenu } from './sheets'
import { tracksLabel } from './text'

const pathOf = (library: Library, folderId: number) =>
  folderTrail(library, folderId)
    .slice(1)
    .map((folder) => folder.name)
    .join(' ▸ ') || 'Libreria'

function DuplicateGroup({ library, ids, identical }: { library: Library; ids: number[]; identical: boolean }) {
  const tracks = ids.flatMap((id) => library.tracks.get(id) ?? [])
  const first = tracks[0]
  if (!first || tracks.length < 2) return null

  const menu = (index: number) => {
    const track = tracks[index]
    const others = tracks.filter((other) => other.id !== track.id).map((other) => other.id)
    openMenu(
      track.title ?? track.name,
      [
        { label: 'Riproduci', icon: 'play', onSelect: () => playItems(tracks.map((each) => toQueueItem(library, each)), index) },
        { label: 'Vai alla cartella', icon: 'folder', onSelect: () => navigate({ name: 'folder', id: track.parent }) },
        ...(identical
          ? [{ label: 'Tieni questo, elimina gli altri', icon: 'check' as const, onSelect: () => void deleteTracks(others, others.length === 1 ? "Eliminare l'altra copia?" : `Eliminare le altre ${others.length} copie?`) }]
          : []),
        { label: 'Elimina', icon: 'trash', danger: true, onSelect: () => void deleteTracks([track.id], `Eliminare "${track.name}"?`) },
      ],
      pathOf(library, track.parent),
    )
  }

  return (
    <li className="dupe">
      <div className="dupe-head">
        <strong>{first.title ?? first.name}</strong>
        {first.artist && <span className="dim"> · {first.artist}</span>}
      </div>
      <ul className="rows">
        {tracks.map((track, index) => (
          <li className="row" key={track.id}>
            <button className="row-main" onClick={() => menu(index)}>
              <span className="row-icon">
                <Icon name="music" size={18} />
              </span>
              <span className="row-text">
                <span className="row-title">{track.name}</span>
                <span className="row-sub">
                  {pathOf(library, track.parent)}
                  {track.size ? ` · ${sizeLabel(track.size)}` : ''}
                </span>
              </span>
            </button>
            <button className="icon-button" aria-label={`Azioni per ${track.name}`} onClick={() => menu(index)}>
              <Icon name="more" />
            </button>
          </li>
        ))}
      </ul>
    </li>
  )
}

export function DuplicatesView() {
  const library = useStore(libraryStore, (state) => state.library)
  const refreshing = useStore(libraryStore, (state) => state.refreshing)
  const found = useMemo(() => (library ? findDuplicates(library) : null), [library])

  if (!library || !found) return <Notice loading title="Leggo la libreria…" />
  const wasted = found.same.reduce((sum, group) => {
    const size = library.tracks.get(group[0])?.size ?? 0
    return sum + size * (group.length - 1)
  }, 0)

  return (
    <>
      <header className="view-head">
        <h1>Doppioni</h1>
        <p className="dim">
          {found.same.length === 1 ? '1 gruppo' : `${found.same.length} gruppi`} di file identici
          {wasted ? ` (${sizeLabel(wasted)} di copie)` : ''} · {found.similar.length === 1 ? '1 brano' : `${found.similar.length} brani`} in più versioni
        </p>
      </header>
      {found.unknown > 0 && (
        <Notice
          title={refreshing ? 'Rileggo la libreria…' : 'Per alcuni brani manca l\'impronta'}
          body={`${tracksLabel(found.unknown)} non si possono confrontare finché la libreria non viene riletta da pCloud.`}
          action={refreshing ? undefined : { label: 'Rileggi la libreria', run: () => void refreshLibrary() }}
        />
      )}
      {found.same.length + found.similar.length === 0 && found.unknown === 0 && <Notice title="Nessun doppione" body="Ogni brano c'è una volta sola." />}
      {found.same.length > 0 && (
        <section className="dupes">
          <h2>Identici</h2>
          <p className="dim">Stesso file, copiato in più posti. Tocca una copia per sentirla, andare alla sua cartella o tenere solo quella.</p>
          <ul>
            {found.same.map((ids) => (
              <DuplicateGroup key={ids.join()} library={library} ids={ids} identical />
            ))}
          </ul>
        </section>
      )}
      {found.similar.length > 0 && (
        <section className="dupes">
          <h2>Stesso brano, file diversi</h2>
          <p className="dim">Stesso artista e titolo ma contenuto diverso: un altro formato, un'altra qualità o un'altra versione.</p>
          <ul>
            {found.similar.map((ids) => (
              <DuplicateGroup key={ids.join()} library={library} ids={ids} identical={false} />
            ))}
          </ul>
        </section>
      )}
    </>
  )
}
