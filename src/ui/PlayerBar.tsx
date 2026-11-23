import { useEffect, useState } from 'react'
import { castStore } from '../lib/cast/remote'
import { cycleRepeat, next, playerStore, previous, progressStore, seek, toggle, toggleShuffle } from '../lib/player'
import { libraryStore } from '../lib/library'
import { playlistsStore } from '../lib/playlists'
import { useStore } from '../lib/store'
import { openTrackMenu } from './actions'
import { canCast, castLabel, openCastSheet, useCastErrors } from './cast'
import { dragTracks } from './drag'
import { Icon } from './icons'
import { goToSource, sourceLabel, sourceOf } from './play'
import { StarButton } from './star'
import { onBack } from './back'
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

/** Come nel CSS: da 900px la barra non si apre, è sempre completa. */
const wide = () => typeof matchMedia === 'function' && matchMedia('(min-width: 900px)').matches

export function PlayerBar() {
  const player = useStore(playerStore)
  // Sul telefono la barra è compatta; toccando il titolo si apre con tutti i comandi.
  const [expanded, setExpanded] = useState(false)
  // Aperto, il tasto indietro di Android lo richiude.
  useEffect(() => (expanded ? onBack(() => setExpanded(false)) : undefined), [expanded])
  const item = player.items[player.index]
  // Il nome di cartelle e playlist arriva con la libreria e le playlist: quando cambiano si ridisegna.
  useStore(libraryStore, (state) => state.library)
  useStore(playlistsStore, (state) => state.lists)
  const castTarget = useStore(castStore, (state) => state.target)
  useCastErrors()
  const source = sourceOf(player)
  if (!item) return null
  const castName = castTarget && castLabel(castTarget)

  return (
    <section className={`player${expanded ? ' expanded' : ''}`} aria-label="Lettore">
      {/* Il brano che suona: col mouse si trascina su una playlist della barra laterale, il ⋯ apre il suo menu. */}
      <div className="now-wrap" {...dragTracks(() => ({ ids: [item.id], label: item.title }))}>
        <span className="now-icon" title="Trascina su una playlist" aria-hidden="true">
          <Icon name="music" size={18} />
        </span>
        <button
          className={`now${source ? ' has-source' : ''}`}
          // Su schermo largo (Mac) il titolo riporta alla playlist o cartella da cui suona; stretto apre il lettore.
          onClick={() => (source && wide() ? goToSource() : setExpanded((open) => !open))}
          title={source && wide() ? `Torna a ${sourceLabel(source)}` : undefined}
          aria-expanded={expanded}
        >
          <span className="now-title">{item.title}</span>
          <span className={`now-sub${player.error ? ' error' : ''}`}>
            {/* Mentre trasmette, prima di tutto dove suona. */}
            {castName && !player.error && <span className="now-cast">{castName} · </span>}
            {player.error ?? (player.loading && player.playing ? 'Carico…' : item.sub)}
          </span>
        </button>
        {source && (
          // Sul Mac: "↩ Battiato" riporta alla playlist o cartella che suona (sul telefono è nel ⋯).
          <button className="now-back" title={`Torna a ${sourceLabel(source)}`} onClick={goToSource}>
            <Icon name="back" size={14} />
            <span>{sourceLabel(source)}</span>
          </button>
        )}
        <StarButton item={item} className="now-star" />
        <button
          className="icon-button now-more"
          aria-label={`Azioni per ${item.title}`}
          title="Aggiungi a playlist e altro"
          onClick={() =>
            openTrackMenu(item, {
              parent: libraryStore.get().library?.tracks.get(item.id)?.parent,
              extra: source ? [{ label: `Torna a ${sourceLabel(source)}`, icon: 'back', onSelect: goToSource }] : [],
            })
          }
        >
          <Icon name="more" size={18} />
        </button>
      </div>
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
        {canCast() && (
          // Sulla barra compatta del telefono si vede solo mentre trasmette.
          <button
            className={`icon-button${castTarget ? ' on' : ' extra'}`}
            aria-label={castName ? `In riproduzione su ${castName}` : 'Trasmetti a una cassa'}
            title={castName ? `In riproduzione su ${castName}` : 'Trasmetti a una cassa'}
            onClick={openCastSheet}
          >
            <Icon name="speaker" size={18} />
          </button>
        )}
      </div>
      <Seek />
    </section>
  )
}
