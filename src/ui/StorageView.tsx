// Download e spazio: cosa c'è su questo dispositivo, quanto occupa, e "Pulisci tutto".

import { useMemo } from 'react'
import { audioStore, canSave, clearCache, needsNewApp, setCacheLimit, usageOf } from '../lib/audioStore'
import { cleanEverything } from '../lib/cleanup'
import { downloadsStore, pinFolder, pinPlaylist, pinTracks } from '../lib/downloads'
import { libraryStore } from '../lib/library'
import { ANDROID_APP_URL, isAndroidBrowser, isNativeApp } from '../lib/native'
import { onlineStore } from '../lib/network'
import { playlistsStore } from '../lib/playlists'
import { useStore } from '../lib/store'
import { Icon } from './icons'
import { Notice } from './parts'
import { confirmAction, toast } from './sheets'
import { tracksLabel } from './text'

export function sizeLabel(bytes: number): string {
  if (bytes < 1024 ** 2) return `${Math.max(0, Math.round(bytes / 1024)).toLocaleString('it')} kB`
  if (bytes < 1024 ** 3) return `${Math.round(bytes / 1024 ** 2).toLocaleString('it')} MB`
  return `${(bytes / 1024 ** 3).toLocaleString('it', { maximumFractionDigits: 1 })} GB`
}

const LIMITS = [512 * 1024 ** 2, 1024 ** 3, 2 * 1024 ** 3, 5 * 1024 ** 3]

async function cleanFlow() {
  const sure = await confirmAction(
    'Pulire tutto?',
    'Tolgo da questo dispositivo i brani scaricati, quelli precaricati e la copia di libreria e playlist. Su pCloud non cambia niente e resti dentro: la libreria si rilegge da pCloud.',
    'Pulisci tutto',
  )
  if (!sure) return
  await cleanEverything()
  toast('Fatto: su questo dispositivo non c\'è più niente.')
}

function Unsupported() {
  if (needsNewApp()) {
    return (
      <Notice
        title="Serve l'app nuova"
        body="Per scaricare i brani sul telefono serve la versione nuova dell'app musicx. Si installa sopra quella che hai: resti dentro."
        action={{ label: "Scarica l'app", run: () => location.assign(ANDROID_APP_URL) }}
      />
    )
  }
  const body = isAndroidBrowser
    ? "Da Chrome pCloud non lascia scaricare i brani: sul telefono usa l'app musicx per Android."
    : 'pCloud dà i brani solo all\'app per Android e, sul Mac, a rclone: da qui non si possono scaricare.'
  return <Notice title="Qui non si scarica" body={body} />
}

export function StorageView() {
  const { files, limit } = useStore(audioStore)
  const { pins, todo, done, failed, waiting } = useStore(downloadsStore)
  const online = useStore(onlineStore)
  const library = useStore(libraryStore, (state) => state.library)
  const lists = useStore(playlistsStore, (state) => state.lists)
  const usage = useMemo(() => usageOf(files), [files])

  const supported = canSave()
  const single = Object.entries(pins.tracks).map(([id, file]) => ({ id: Number(id), file }))
  const chosen = [
    ...pins.playlists.map((id) => ({
      key: `p${id}`,
      icon: 'list' as const,
      name: lists.find((list) => list.id === id)?.title ?? 'Playlist',
      remove: () => pinPlaylist(id, false),
    })),
    ...pins.folders.map((id) => ({
      key: `f${id}`,
      icon: 'folder' as const,
      name: library?.folders.get(id)?.name ?? 'Cartella',
      remove: () => pinFolder(id, false),
    })),
    ...(single.length
      ? [{ key: 'tracks', icon: 'music' as const, name: `${tracksLabel(single.length)} scelti uno per uno`, remove: () => pinTracks(single, false) }]
      : []),
  ]

  const status = !supported
    ? null
    : waiting || (!online && chosen.length)
      ? 'Senza rete: riprendo a scaricare appena torna.'
      : todo > 0
        ? `Scarico ${Math.min(done + failed + 1, todo)} di ${todo}…`
        : failed > 0
          ? `${tracksLabel(failed)} non scaricati: riprovo più tardi.`
          : null

  return (
    <>
      <header className="view-head">
        <h1>Download e spazio</h1>
        <p className="dim">{isNativeApp ? 'Su questo telefono' : 'Su questo dispositivo'}</p>
      </header>
      {!supported && <Unsupported />}

      {supported && (
        <section className="storage">
          <h2>
            <Icon name="downloaded" size={18} /> Scaricati
          </h2>
          <p>
            <strong>{tracksLabel(usage.download.count)}</strong> · {sizeLabel(usage.download.bytes)}
          </p>
          {status && <p className="dim">{status}</p>}
          {chosen.length === 0 ? (
            <p className="dim">Niente scaricato. Dal ⋯ di un brano, di una cartella o di una playlist: "Scarica".</p>
          ) : (
            <ul className="rows">
              {chosen.map((item) => (
                <li className="row" key={item.key}>
                  <span className="row-main">
                    <span className="row-icon folder">
                      <Icon name={item.icon} size={18} />
                    </span>
                    <span className="row-text">
                      <span className="row-title">{item.name}</span>
                    </span>
                  </span>
                  <button className="pill small" onClick={() => (item.remove(), toast('Download rimosso.'))}>
                    Rimuovi
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {supported && (
        <section className="storage">
          <h2>
            <Icon name="next" size={18} /> Precaricati
          </h2>
          <p>
            <strong>{tracksLabel(usage.cache.count)}</strong> · {sizeLabel(usage.cache.bytes)} di {sizeLabel(limit)}
          </p>
          <p className="dim">
            Mentre suona un brano, i 2 successivi si preparano qui: il cambio è immediato e riascoltarli non usa la rete.
            Quando lo spazio finisce escono i meno ascoltati.
          </p>
          <div className="chips" role="group" aria-label="Spazio per i precaricati">
            {LIMITS.map((value) => (
              <button key={value} className={`chip${value === limit ? ' on' : ''}`} aria-pressed={value === limit} onClick={() => setCacheLimit(value)}>
                {sizeLabel(value)}
              </button>
            ))}
          </div>
          {usage.cache.count > 0 && (
            <button className="pill" onClick={() => void clearCache().then(() => toast('Precaricati tolti.'))}>
              Svuota i precaricati
            </button>
          )}
        </section>
      )}

      <section className="storage">
        <h2>
          <Icon name="trash" size={18} /> Pulisci tutto
        </h2>
        <p className="dim">
          Toglie i brani scaricati, quelli precaricati e la copia di libreria e playlist salvata qui. Si resta dentro pCloud.
        </p>
        <button className="pill danger" onClick={() => void cleanFlow()}>
          Pulisci tutto
        </button>
      </section>
    </>
  )
}
