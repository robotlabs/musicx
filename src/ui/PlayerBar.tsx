import { useState } from 'react'
import { cycleRepeat, next, playerStore, previous, progressStore, seek, toggle, toggleShuffle } from '../lib/player'
import { useStore } from '../lib/store'
import { Icon } from './icons'
import { clock } from './text'

/** Barra di avanzamento. Mentre la si trascina mostra il valore scelto e salta solo al rilascio. */
function Seek() {
  const { position, duration } = useStore(progressStore)
  const [dragging, setDragging] = useState<number | null>(null)
  const value = dragging ?? position
  const max = duration || 1
  const commit = () => {
    if (dragging === null) return
    seek(dragging)
    setDragging(null)
  }
  return (
    <div className="seek">
      <span className="time">{clock(value)}</span>
      <input
        type="range"
        aria-label="Posizione nel brano"
        min={0}
        max={max}
        step={1}
        value={Math.min(value, max)}
        disabled={!duration}
        onChange={(event) => setDragging(Number(event.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      <span className="time">{duration ? clock(duration) : '–:––'}</span>
      <div className="progress-line" aria-hidden="true">
        <div style={{ width: `${duration ? (value / duration) * 100 : 0}%` }} />
      </div>
    </div>
  )
}

const repeatLabel = { off: 'Ripetizione spenta', all: 'Ripeti tutta la coda', one: 'Ripeti questo brano' }

export function PlayerBar() {
  const player = useStore(playerStore)
  // Sul telefono la barra è compatta; toccando il titolo si apre con tutti i comandi.
  const [expanded, setExpanded] = useState(false)
  const item = player.items[player.index]
  if (!item) return null

  return (
    <section className={`player${expanded ? ' expanded' : ''}`} aria-label="Lettore">
      <button className="now" onClick={() => setExpanded((open) => !open)} aria-expanded={expanded}>
        <span className="now-title">{item.title}</span>
        <span className={`now-sub${player.error ? ' error' : ''}`}>
          {player.error ?? (player.loading && player.playing ? 'Carico…' : item.sub)}
        </span>
      </button>
      <div className="transport">
        <button
          className={`icon-button extra${player.shuffle ? ' on' : ''}`}
          aria-label="Ordine casuale"
          aria-pressed={player.shuffle}
          onClick={toggleShuffle}
        >
          <Icon name="shuffle" size={18} />
        </button>
        <button className="icon-button extra" aria-label="Brano precedente" onClick={previous}>
          <Icon name="previous" />
        </button>
        <button className="play-button" aria-label={player.playing ? 'Pausa' : 'Riproduci'} onClick={toggle}>
          <Icon name={player.playing ? 'pause' : 'play'} size={22} />
        </button>
        <button className="icon-button" aria-label="Brano successivo" onClick={next}>
          <Icon name="next" />
        </button>
        <button
          className={`icon-button extra${player.repeat !== 'off' ? ' on' : ''}`}
          aria-label={repeatLabel[player.repeat]}
          title={repeatLabel[player.repeat]}
          onClick={cycleRepeat}
        >
          <Icon name="repeat" size={18} />
          {player.repeat === 'one' && <span className="badge">1</span>}
        </button>
      </div>
      <Seek />
    </section>
  )
}
