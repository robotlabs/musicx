// Trascinare con il mouse: brani (o cartelle intere) sulle playlist, playlist dentro i gruppi.
// Solo con il mouse: sul telefono la barra laterale non c'è e il tocco lungo resta allo scorrimento.

import { useEffect, useState, type DragEvent } from 'react'
import type { Playlist } from '../lib/playlists'
import { createStore, useStore } from '../lib/store'

export type Dragged =
  /** Brani (id file pCloud) da aggiungere; `label` segue il puntatore e fa da nome a una nuova playlist. */
  | { kind: 'tracks'; ids: number[]; label: string }
  /** Una playlist da spostare in un gruppo. */
  | { kind: 'playlist'; id: number; title: string; group: string | null }

/** Cosa si sta trascinando adesso, se qualcosa. */
export const dragStore = createStore<Dragged | null>(null)

const canDrag = typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches

/** I brani si aggiungono (copia), le playlist si spostano: l'effetto del bersaglio deve combaciare, o il rilascio viene rifiutato. */
const effectOf = (dragged: Dragged) => (dragged.kind === 'tracks' ? 'copy' : 'move')

let startedAt = 0

// Se la riga di partenza sparisce durante il trascinamento, "dragend" non arriva: appena il
// puntatore torna a muoversi normalmente il trascinamento è sicuramente finito.
if (typeof window !== 'undefined') {
  window.addEventListener('pointermove', () => {
    if (dragStore.get() && Date.now() - startedAt > 300) dragStore.set(null)
  })
}

function start(event: DragEvent<HTMLElement>, dragged: Dragged, ghostText: string) {
  event.dataTransfer.effectAllowed = effectOf(dragged)
  event.dataTransfer.setData('text/plain', ghostText)
  const ghost = document.createElement('div')
  ghost.className = 'drag-ghost'
  ghost.textContent = ghostText
  document.body.append(ghost)
  event.dataTransfer.setDragImage(ghost, 14, 14)
  setTimeout(() => ghost.remove())
  startedAt = Date.now()
  dragStore.set(dragged)
}

/** Proprietà per un elemento che trascina brani. `get` viene chiamata solo quando parte il trascinamento. */
export function dragTracks(get: () => { ids: number[]; label: string } | null) {
  if (!canDrag) return {}
  return {
    draggable: true,
    onDragStart: (event: DragEvent<HTMLElement>) => {
      const tracks = get()
      if (!tracks?.ids.length) {
        event.preventDefault()
        return
      }
      const ghost = tracks.ids.length === 1 ? `♪ ${tracks.label}` : `${tracks.label} · ${tracks.ids.length} brani`
      start(event, { kind: 'tracks', ...tracks }, ghost)
    },
    onDragEnd: () => dragStore.set(null),
  }
}

/** Proprietà per un elemento che trascina una playlist (verso un gruppo). */
export function dragPlaylist(list: Playlist) {
  if (!canDrag) return {}
  return {
    draggable: true,
    onDragStart: (event: DragEvent<HTMLElement>) => {
      start(event, { kind: 'playlist', id: list.id, title: list.title, group: list.group }, list.title)
    },
    onDragEnd: () => dragStore.set(null),
  }
}

/** Prende quello che si stava trascinando e chiude il trascinamento. */
export function takeDrag(): Dragged | null {
  const dragged = dragStore.get()
  dragStore.set(null)
  return dragged
}

/**
 * Bersagli di rilascio per una parte della pagina. `over` è la chiave del bersaglio sotto il puntatore.
 * Più elementi possono condividere una chiave (l'intestazione di un gruppo e le sue playlist):
 * passare dall'uno all'altro non spegne l'evidenziazione.
 */
export function useDropTargets() {
  const dragged = useStore(dragStore)
  const [over, setOver] = useState<string | null>(null)
  useEffect(() => {
    if (!dragged) setOver(null)
  }, [dragged])

  /**
   * Proprietà per un bersaglio. Con `onDrop` null l'elemento non accetta il rilascio,
   * ma con `hover` reagisce comunque al passaggio (per esempio un gruppo chiuso che si apre).
   */
  const target = (key: string, onDrop: (() => void) | null, hover?: { enter: () => void; leave: () => void }) => {
    if (!dragged || (!onDrop && !hover)) return {}
    return {
      'data-drop': key,
      onDragEnter: (event: DragEvent<HTMLElement>) => {
        if (onDrop) event.preventDefault()
        // Anche passare sui figli dell'elemento fa arrivare un "dragenter": il passaggio comincia una volta sola.
        if (over !== key) hover?.enter()
        setOver(key)
      },
      onDragOver: (event: DragEvent<HTMLElement>) => {
        // Rimettere la chiave a ogni passaggio tiene accesa l'evidenziazione anche se un "dragleave"
        // arriva dopo il "dragenter" dell'elemento accanto con la stessa chiave.
        setOver(key)
        if (!onDrop) return
        event.preventDefault()
        event.dataTransfer.dropEffect = effectOf(dragged)
      },
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        const next = event.relatedTarget instanceof Element ? event.relatedTarget.closest('[data-drop]') : null
        if (next?.getAttribute('data-drop') === key) return
        hover?.leave()
        setOver((current) => (current === key ? null : current))
      },
      ...(onDrop && {
        onDrop: (event: DragEvent<HTMLElement>) => {
          event.preventDefault()
          setOver(null)
          takeDrag()
          onDrop()
        },
      }),
    }
  }

  return { dragged, over, target }
}
