// Pezzi riusati da più viste: riga di un brano, messaggi a tutta pagina.

import type { CSSProperties, MouseEvent, ReactNode } from 'react'
import { audioStore } from '../lib/audioStore'
import { onlineStore } from '../lib/network'
import type { QItem } from '../lib/queue'
import { useStore } from '../lib/store'
import { SavedMark } from './downloadActions'
import { dragTracks } from './drag'
import { Icon } from './icons'
import { StarButton } from './star'

/** Le tre barrette che segnano il brano in riproduzione (animate solo mentre suona). */
export function Bars({ moving }: { moving: boolean }) {
  return (
    <span className={`bars${moving ? ' moving' : ''}`} aria-label="In riproduzione">
      <i />
      <i />
      <i />
    </span>
  )
}

export function TrackRow(props: {
  item: QItem
  active: boolean
  playing: boolean
  onPlay: () => void
  onMenu: () => void
  leading?: ReactNode
  className?: string
  style?: CSSProperties
  /** Se dato, la riga si può trascinare sulle playlist della barra laterale: dà i brani da trascinare. */
  drag?: () => { ids: number[]; label: string } | null
  /** Col mouse il clic seleziona (vedi selection.ts) e il doppio clic suona. Senza, il clic suona. */
  onSelect?: (event: MouseEvent) => void
  selected?: boolean
}) {
  const { item, active, onSelect } = props
  const drag = props.drag ? dragTracks(props.drag) : {}
  const saved = useStore(audioStore, (state) => state.files[item.id]?.kind)
  // Senza rete i brani non salvati sul dispositivo non suonano: si vedono spenti.
  const online = useStore(onlineStore)
  const className = [
    'row',
    active && 'active',
    props.selected && 'selected',
    onSelect && 'selectable',
    !online && !saved && !active && 'unavailable',
    props.className,
  ]
  return (
    <li className={className.filter(Boolean).join(' ')} style={props.style} {...drag}>
      {props.leading}
      <button
        className="row-main"
        aria-pressed={onSelect ? Boolean(props.selected) : undefined}
        // Il clic da tastiera (Invio) ha detail 0: lì il brano parte comunque.
        onClick={(event) => (onSelect && event.detail > 0 ? onSelect(event) : props.onPlay())}
        onDoubleClick={onSelect && props.onPlay}
      >
        <span
          className="row-icon"
          // Col mouse, l'icona diventa ▶ e fa partire il brano con un clic solo.
          onClick={
            onSelect &&
            ((event) => {
              event.stopPropagation()
              if (event.detail === 1) props.onPlay()
            })
          }
          onDoubleClick={onSelect && ((event) => event.stopPropagation())}
        >
          {active ? <Bars moving={props.playing} /> : <Icon name="music" size={18} />}
          {onSelect && !active && (
            <span className="row-play" title="Riproduci">
              <Icon name="play" size={16} />
            </span>
          )}
        </span>
        <span className="row-text">
          <span className="row-title">{item.title}</span>
          {(item.sub || saved === 'download') && (
            <span className="row-sub">
              {saved === 'download' && <SavedMark />}
              {item.sub}
            </span>
          )}
        </span>
      </button>
      <StarButton item={item} />
      <button className="icon-button" aria-label={`Azioni per ${item.title}`} onClick={props.onMenu}>
        <Icon name="more" />
      </button>
    </li>
  )
}

/** Messaggio a centro pagina: caricamento, errore, lista vuota. */
export function Notice(props: {
  title: string
  body?: string | null
  loading?: boolean
  action?: { label: string; run: () => void }
}) {
  return (
    <div className="notice">
      {props.loading && <div className="spinner" aria-hidden="true" />}
      <h2>{props.title}</h2>
      {props.body && <p>{props.body}</p>}
      {props.action && (
        <button className="pill primary" onClick={props.action.run}>
          {props.action.label}
        </button>
      )}
    </div>
  )
}
