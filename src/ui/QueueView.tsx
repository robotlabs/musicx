import { clearQueue, jumpTo, playerStore, removeFromQueue } from '../lib/player'
import { useStore } from '../lib/store'
import { addToPlaylistFlow } from './actions'
import { Icon } from './icons'
import { Notice, TrackRow } from './parts'
import { openMenu } from './sheets'
import { tracksLabel } from './text'

/** Con code enormi (tutta la libreria) si disegna solo una finestra attorno al brano corrente. */
const BEFORE = 30
const AFTER = 300

export function QueueView() {
  const { items, index, playing } = useStore(playerStore)

  if (!items.length) {
    return <Notice title="La coda è vuota" body="Scegli un brano, una cartella o una playlist e parte da lì." />
  }

  const first = Math.max(0, index - BEFORE)
  const last = Math.min(items.length, index + AFTER + 1)
  const visible = items.slice(first, last)

  return (
    <>
      <header className="view-head">
        <h1>Coda</h1>
        <p className="dim">
          {tracksLabel(items.length)} · brano {index + 1}
        </p>
        <div className="head-actions">
          <button className="pill" onClick={() => void addToPlaylistFlow(items.map((item) => item.id))}>
            <Icon name="plus" size={16} /> Salva come playlist
          </button>
          <button className="pill" onClick={clearQueue}>
            <Icon name="close" size={16} /> Svuota
          </button>
        </div>
      </header>
      {first > 0 && <p className="dim footnote">{tracksLabel(first)} già passati.</p>}
      <ul className="rows">
        {visible.map((item, offset) => {
          const position = first + offset
          return (
            <TrackRow
              // Lo stesso brano può stare in coda più volte: la chiave comprende la posizione.
              key={`${position}-${item.id}`}
              item={item}
              active={position === index}
              playing={playing}
              className={position < index ? 'played' : undefined}
              onPlay={() => jumpTo(position)}
              onMenu={() =>
                openMenu(
                  item.title,
                  [
                    { label: 'Aggiungi a playlist…', icon: 'plus', onSelect: () => void addToPlaylistFlow([item.id]) },
                    { label: 'Togli dalla coda', icon: 'close', danger: true, onSelect: () => removeFromQueue(position) },
                  ],
                  item.sub,
                )
              }
            />
          )
        })}
      </ul>
      {last < items.length && <p className="dim footnote">…e altri {tracksLabel(items.length - last)}.</p>}
    </>
  )
}
