import { useRef, type ChangeEvent } from 'react'
import { libraryStore } from '../lib/library'
import { matchM3u, parseM3u } from '../lib/m3u'
import { addToPlaylist, playlistsStore, refreshPlaylists } from '../lib/playlists'
import { navigate, routeHref } from '../lib/router'
import { useStore } from '../lib/store'
import { Icon } from './icons'
import { Notice } from './parts'
import { createPlaylistFlow, toast } from './sheets'
import { errorText, tracksLabel } from './text'

/** Crea una playlist dai brani di un file .m3u che si ritrovano nella libreria. */
async function importM3u(file: File) {
  const library = libraryStore.get().library
  if (!library) return toast('La libreria non è ancora caricata.')
  const references = parseM3u(await file.text())
  const { trackIds } = matchM3u(library, references)
  if (!trackIds.length) return toast('Nessun brano di questo file è stato trovato nella libreria.')

  const id = await createPlaylistFlow(file.name.replace(/\.m3u8?$/i, ''))
  if (id === null) return
  try {
    await addToPlaylist(id, trackIds)
    toast(`Importati ${trackIds.length} brani su ${references.length}.`)
    navigate({ name: 'playlist', id })
  } catch (error) {
    toast(errorText(error))
  }
}

export function PlaylistsView() {
  const { lists, loaded, error } = useStore(playlistsStore)
  const fileInput = useRef<HTMLInputElement>(null)

  const create = async () => {
    const id = await createPlaylistFlow()
    if (id !== null) navigate({ name: 'playlist', id })
  }
  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) void importM3u(file)
  }

  return (
    <>
      <header className="view-head">
        <h1>Playlist</h1>
        <p className="dim">Sono le playlist del tuo account pCloud.</p>
        <div className="head-actions">
          <button className="pill primary" onClick={() => void create()}>
            <Icon name="plus" size={16} /> Nuova
          </button>
          <button className="pill" onClick={() => fileInput.current?.click()}>
            <Icon name="upload" size={16} /> Importa .m3u
          </button>
          <input ref={fileInput} type="file" accept=".m3u,.m3u8,audio/x-mpegurl" hidden onChange={onFile} />
        </div>
      </header>
      {!loaded && <Notice loading title="Carico le playlist…" />}
      {loaded && error && (
        <Notice title="Non riesco a leggere le playlist" body={error} action={{ label: 'Riprova', run: () => void refreshPlaylists() }} />
      )}
      {loaded && !error && lists.length === 0 && (
        <Notice title="Ancora nessuna playlist" body='Creane una, oppure usa "Aggiungi a playlist" dal menu ⋯ di un brano o di una cartella.' />
      )}
      <ul className="rows">
        {lists.map((list) => (
          <li className="row" key={list.id}>
            <a className="row-main" href={routeHref({ name: 'playlist', id: list.id })}>
              <span className="row-icon folder">
                <Icon name="list" size={18} />
              </span>
              <span className="row-text">
                <span className="row-title">{list.name}</span>
                <span className="row-sub">{tracksLabel(list.count)}</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </>
  )
}
