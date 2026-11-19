import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from 'react'
import { playerStore } from '../lib/player'
import { playItems, playShuffled } from './play'
import { setGroupOpen } from '../lib/openGroups'
import {
  loadPlaylist,
  movePlaylistTrack,
  playlistsStore,
  removeFromPlaylist,
  sortPlaylistByTrackNumber,
  type PlaylistTrack,
} from '../lib/playlists'
import { navigate } from '../lib/router'
import { useStore } from '../lib/store'
import { openTrackMenu, queueMenuItems } from './actions'
import { DownloadToggle, playlistDownloadItems, useDownloadedCount } from './downloadActions'
import { Icon } from './icons'
import { Notice, TrackRow } from './parts'
import { Grip, shiftOf, useDragReorder } from './reorder'
import { useSelection } from './selection'
import { playlistMenuItems, playlistSubtitle } from './playlistActions'
import { openMenu, toast } from './sheets'
import { errorText, tracksLabel } from './text'

const PlaylistRow = memo(function PlaylistRow(props: {
  track: PlaylistTrack
  index: number
  active: boolean
  playing: boolean
  shift: number
  dragged: boolean
  selected: boolean
  onSelect?: (index: number, event: MouseEvent) => void
  dragFrom: (index: number) => { ids: number[]; label: string } | null
  onPlay: (index: number) => void
  onMenu: (index: number) => void
  onGrab: (index: number, event: PointerEvent<HTMLElement>) => void
  onDrag: (event: PointerEvent<HTMLElement>) => void
  onDrop: () => void
}) {
  const { index } = props
  const style: CSSProperties | undefined = props.shift ? { transform: `translateY(${props.shift}px)` } : undefined
  return (
    <TrackRow
      item={props.track}
      active={props.active}
      playing={props.playing}
      className={props.dragged ? 'dragged' : undefined}
      style={style}
      onPlay={() => props.onPlay(index)}
      onMenu={() => props.onMenu(index)}
      drag={() => props.dragFrom(index)}
      selected={props.selected}
      onSelect={props.onSelect && ((event) => props.onSelect?.(index, event))}
      leading={
        <Grip index={index} onGrab={props.onGrab} onDrag={props.onDrag} onDrop={props.onDrop} />
      }
    />
  )
})

const noTracks: PlaylistTrack[] = []

export function PlaylistView({ id }: { id: number }) {
  const list = useStore(playlistsStore, (state) => state.lists.find((item) => item.id === id))
  const listsLoaded = useStore(playlistsStore, (state) => state.loaded)
  const tracks = useStore(playlistsStore, (state) => state.tracks[id])
  const currentId = useStore(playerStore, (state) => state.items[state.index]?.id)
  const playing = useStore(playerStore, (state) => state.playing)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setError(null)
    // Senza rete va bene la copia salvata sul dispositivo, se c'è.
    loadPlaylist(id).catch((problem) => !playlistsStore.get().tracks[id] && setError(errorText(problem)))
  }, [id])

  // Le righe sono memoizzate: ricevono funzioni stabili che leggono i brani più recenti da qui.
  const tracksRef = useRef(tracks)
  tracksRef.current = tracks

  const reorder = useCallback(
    (from: number, to: number) => {
      movePlaylistTrack(id, from, to).catch((problem) => toast(errorText(problem)))
    },
    [id],
  )
  const { drag, start, move, end } = useDragReorder(tracks?.length ?? 0, reorder)
  const trackIds = useMemo(() => (tracks ?? noTracks).map((track) => track.id), [tracks])
  const downloaded = useDownloadedCount(trackIds)
  const selection = useSelection(tracks ?? noTracks, list?.title ?? 'Playlist')
  const { selectedWith } = selection

  const play = useCallback((index: number) => playItems(tracksRef.current ?? [], index), [])
  const menu = useCallback(
    (index: number) => {
      const track = tracksRef.current?.[index]
      if (!track) return
      const selected = selectedWith(index)
      if (selected) return openTrackMenu(track, { selected: selected.map((row) => tracksRef.current![row]) })
      openTrackMenu(track, {
        parent: track.parent,
        extra: [
          {
            label: 'Rimuovi dalla playlist',
            icon: 'close',
            danger: true,
            onSelect: () => void removeFromPlaylist(id, track.id).catch((problem) => toast(errorText(problem))),
          },
        ],
      })
    },
    [id, selectedWith],
  )

  if (error) {
    return <Notice title="Non riesco ad aprire la playlist" body={error} action={{ label: 'Tutte le playlist', run: () => navigate({ name: 'playlists' }) }} />
  }
  if (!tracks || (!list && !listsLoaded)) return <Notice loading title="Carico la playlist…" />

  const name = list?.title ?? 'Playlist'
  const group = list?.group ?? null

  const openPlaylistMenu = () =>
    openMenu(
      name,
      [
        ...(tracks.length ? queueMenuItems(tracks).slice(0, 2) : []),
        ...(tracks.length ? playlistDownloadItems(id, tracks.length) : []),
        ...(tracks.length > 1
          ? [
              {
                label: 'Ordina per numero di traccia',
                icon: 'sort' as const,
                onSelect: () => void sortPlaylistByTrackNumber(id).catch((problem) => toast(errorText(problem))),
              },
            ]
          : []),
        ...(list ? playlistMenuItems(list, () => navigate({ name: 'playlists' }, { replace: true })) : []),
      ],
      list ? playlistSubtitle(list) : tracksLabel(tracks.length),
    )

  return (
    <>
      <nav className="crumbs" aria-label="Percorso">
        <span>
          <a href="#/playlists">Playlist</a>
          <Icon name="chevron" size={14} />
        </span>
        {group && (
          <span>
            <a href="#/playlists" onClick={() => setGroupOpen(group, true)}>
              {group}
            </a>
            <Icon name="chevron" size={14} />
          </span>
        )}
      </nav>
      <header className="view-head">
        <h1>{name}</h1>
        <p className="dim">
          {tracksLabel(tracks.length)}
          {downloaded > 0 && ` · ${downloaded === tracks.length ? 'tutti scaricati' : `${downloaded} scaricati`}`}
        </p>
        <div className="head-actions">
          {tracks.length > 0 && (
            <>
              <button className="pill primary" onClick={() => playItems(tracks)}>
                <Icon name="play" size={16} /> Riproduci
              </button>
              <button className="pill" onClick={() => playShuffled(tracks)}>
                <Icon name="shuffle" size={16} /> Casuale
              </button>
              <DownloadToggle kind="playlist" id={id} count={tracks.length} />
            </>
          )}
          <button className="icon-button" aria-label="Altre azioni" onClick={openPlaylistMenu}>
            <Icon name="more" />
          </button>
        </div>
      </header>
      {tracks.length === 0 && (
        <Notice title="Playlist vuota" body='Aggiungi brani dal menu ⋯ di un brano o di una cartella: "Aggiungi a playlist".' />
      )}
      <ul className={`rows${drag ? ' reordering' : ''}`}>
        {tracks.map((track, index) => (
          <PlaylistRow
            key={track.id}
            track={track}
            index={index}
            active={track.id === currentId}
            playing={playing}
            shift={shiftOf(drag, index)}
            dragged={drag?.from === index}
            selected={selection.rows.has(index)}
            onSelect={selection.select}
            dragFrom={selection.dragFrom}
            onPlay={play}
            onMenu={menu}
            onGrab={start}
            onDrag={move}
            onDrop={end}
          />
        ))}
      </ul>
    </>
  )
}
