// Pezzi riusati da più viste: riga di un brano, messaggi a tutta pagina.

import type { CSSProperties, ReactNode } from 'react'
import type { QItem } from '../lib/queue'
import { dragTracks } from './drag'
import { Icon } from './icons'

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
  /** Se dato, la riga si può trascinare sulle playlist della barra laterale. */
  draggable?: boolean
}) {
  const { item, active } = props
  const drag = props.draggable ? dragTracks(() => ({ ids: [item.id], label: item.title })) : {}
  return (
    <li className={`row${active ? ' active' : ''}${props.className ? ` ${props.className}` : ''}`} style={props.style} {...drag}>
      {props.leading}
      <button className="row-main" onClick={props.onPlay}>
        <span className="row-icon">{active ? <Bars moving={props.playing} /> : <Icon name="music" size={18} />}</span>
        <span className="row-text">
          <span className="row-title">{item.title}</span>
          {item.sub && <span className="row-sub">{item.sub}</span>}
        </span>
      </button>
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
