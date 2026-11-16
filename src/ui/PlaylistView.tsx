import { memo, useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from 'react'
import { playerStore, playItems, playShuffled } from '../lib/player'
import { setGroupOpen } from '../lib/openGroups'
import { loadPlaylist, movePlaylistTrack, playlistsStore, removeFromPlaylist, type PlaylistTrack } from '../lib/playlists'
import { navigate } from '../lib/router'
import { useStore } from '../lib/store'
import { openTrackMenu, queueMenuItems } from './actions'
import { Icon } from './icons'
import { Notice, TrackRow } from './parts'
import { useSelection } from './selection'
import { playlistMenuItems, playlistSubtitle } from './playlistActions'
import { openMenu, toast } from './sheets'
import { errorText, tracksLabel } from './text'

interface Drag {
  from: number
  to: number
  /** Di quanto si è spostata la riga trascinata, in pixel. */
  offset: number
  rowHeight: number
}

/**
 * Riordino per trascinamento della maniglia, con mouse o dito.
 * Le altre righe si scostano con una trasformazione; l'ordine vero cambia solo al rilascio.
 */
function useDragReorder(count: number, onMove: (from: number, to: number) => void) {
  const [drag, setDrag] = useState<Drag | null>(null)
  const latest = useRef({ count, onMove })
  latest.current = { count, onMove }
  const session = useRef<{
    from: number
    to: number
    startY: number
    pointerY: number
    rowHeight: number
    scroller: HTMLElement
    startScroll: number
    frame: number
  } | null>(null)

  const update = useCallback(() => {
    const s = session.current
    if (!s) return
    const offset = s.pointerY - s.startY + (s.scroller.scrollTop - s.startScroll)
    s.to = Math.min(Math.max(s.from + Math.round(offset / s.rowHeight), 0), latest.current.count - 1)
    setDrag({ from: s.from, to: s.to, offset, rowHeight: s.rowHeight })
  }, [])

  const start = useCallback(
    (index: number, event: PointerEvent<HTMLElement>) => {
      const row = event.currentTarget.closest('li')
      const scroller = event.currentTarget.closest<HTMLElement>('.content')
      if (!row || !scroller) return
      event.preventDefault()
      try {
        // Così il trascinamento continua anche se il dito esce dalla maniglia.
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // Puntatore già rilasciato: il trascinamento funziona lo stesso finché si resta sulla riga.
      }

      // Vicino ai bordi la lista scorre da sola.
      const autoScroll = () => {
        const s = session.current
        if (!s) return
        const box = s.scroller.getBoundingClientRect()
        const edge = 56
        const speed =
          s.pointerY < box.top + edge
            ? -(box.top + edge - s.pointerY) / 5
            : s.pointerY > box.bottom - edge
              ? (s.pointerY - (box.bottom - edge)) / 5
              : 0
        if (speed) {
          s.scroller.scrollTop += speed
          update()
        }
        s.frame = requestAnimationFrame(autoScroll)
      }

      session.current = {
        from: index,
        to: index,
        startY: event.clientY,
        pointerY: event.clientY,
        rowHeight: row.offsetHeight,
        scroller,
        startScroll: scroller.scrollTop,
        frame: requestAnimationFrame(autoScroll),
      }
      setDrag({ from: index, to: index, offset: 0, rowHeight: row.offsetHeight })
    },
    [update],
  )

  const move = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (!session.current) return
      session.current.pointerY = event.clientY
      update()
    },
    [update],
  )

  const end = useCallback(() => {
    const s = session.current
    if (!s) return
    cancelAnimationFrame(s.frame)
    session.current = null
    setDrag(null)
    if (s.from !== s.to) latest.current.onMove(s.from, s.to)
  }, [])

  useEffect(() => () => cancelAnimationFrame(session.current?.frame ?? 0), [])

  return { drag, start, move, end }
}

/** Quanto deve scostarsi la riga `index` mentre un'altra viene trascinata. */
function shiftOf(drag: Drag | null, index: number): number {
  if (!drag) return 0
  if (index === drag.from) return drag.offset
  if (drag.from < drag.to && index > drag.from && index <= drag.to) return -drag.rowHeight
  if (drag.from > drag.to && index >= drag.to && index < drag.from) return drag.rowHeight
  return 0
}

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
        <span
          className="grip"
          role="button"
          aria-label="Trascina per riordinare"
          // La maniglia riordina: non deve far partire il trascinamento della riga verso le playlist.
          draggable
          onDragStart={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onPointerDown={(event) => props.onGrab(index, event)}
          onPointerMove={props.onDrag}
          onPointerUp={props.onDrop}
          onPointerCancel={props.onDrop}
        >
          <Icon name="grip" size={18} />
        </span>
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
    loadPlaylist(id).catch((problem) => setError(errorText(problem)))
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
  const selection = useSelection(tracks ?? noTracks, list?.title ?? 'Playlist')

  const play = useCallback((index: number) => playItems(tracksRef.current ?? [], index), [])
  const menu = useCallback(
    (index: number) => {
      const track = tracksRef.current?.[index]
      if (!track) return
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
    [id],
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
        <p className="dim">{tracksLabel(tracks.length)}</p>
        <div className="head-actions">
          {tracks.length > 0 && (
            <>
              <button className="pill primary" onClick={() => playItems(tracks)}>
                <Icon name="play" size={16} /> Riproduci
              </button>
              <button className="pill" onClick={() => playShuffled(tracks)}>
                <Icon name="shuffle" size={16} /> Casuale
              </button>
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
