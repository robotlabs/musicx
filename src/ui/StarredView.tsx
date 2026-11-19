import { useMemo } from 'react'
import { playerStore } from '../lib/player'
import { playItems, playShuffled } from './play'
import { starredStore } from '../lib/starred'
import { useStore } from '../lib/store'
import { openTrackMenu } from './actions'
import { Icon } from './icons'
import { Notice, TrackRow } from './parts'
import { useSelection } from './selection'
import { tracksLabel } from './text'

/** I brani con la stella, dall'ultimo messo. */
export function StarredView() {
  const starred = useStore(starredStore, (state) => state.items)
  const items = useMemo(() => [...starred].reverse(), [starred])
  const current = useStore(playerStore, (state) => state.items[state.index]?.id)
  const playing = useStore(playerStore, (state) => state.playing)
  const selection = useSelection(items, 'Preferiti')

  return (
    <>
      <header className="view-head">
        <h1>Preferiti</h1>
        <p className="dim">{items.length ? tracksLabel(items.length) : 'Nessun brano con la stella'}</p>
        {items.length > 0 && (
          <div className="head-actions">
            <button className="pill primary" onClick={() => playItems(items)}>
              <Icon name="play" size={16} /> Riproduci
            </button>
            <button className="pill" onClick={() => playShuffled(items)}>
              <Icon name="shuffle" size={16} /> Casuale
            </button>
          </div>
        )}
      </header>
      {items.length === 0 && (
        <Notice
          title="Ancora nessun preferito"
          body="Sul Mac clicca la stella ☆ nella riga di un brano (o nel lettore). Sul telefono: menu ⋯ del brano → Aggiungi ai preferiti."
        />
      )}
      <ul className="rows">
        {items.map((item, index) => (
          <TrackRow
            key={item.id}
            item={item}
            active={item.id === current}
            playing={playing}
            onPlay={() => playItems(items, index)}
            drag={() => selection.dragFrom(index)}
            selected={selection.rows.has(index)}
            onSelect={selection.select && ((event) => selection.select?.(index, event))}
            onMenu={() => openTrackMenu(item, { selected: selection.selectedWith(index)?.map((row) => items[row]) })}
          />
        ))}
      </ul>
    </>
  )
}
