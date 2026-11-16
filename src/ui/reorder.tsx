// Riordino per trascinamento della maniglia ⠿, con mouse o dito: brani di una playlist o di una cartella.

import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'
import { Icon } from './icons'

export interface Drag {
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
export function useDragReorder(count: number, onMove: (from: number, to: number) => void) {
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
export function shiftOf(drag: Drag | null, index: number): number {
  if (!drag) return 0
  if (index === drag.from) return drag.offset
  if (drag.from < drag.to && index > drag.from && index <= drag.to) return -drag.rowHeight
  if (drag.from > drag.to && index >= drag.to && index < drag.from) return drag.rowHeight
  return 0
}

/** La maniglia ⠿ a sinistra della riga. */
export function Grip(props: {
  index: number
  onGrab: (index: number, event: PointerEvent<HTMLElement>) => void
  onDrag: (event: PointerEvent<HTMLElement>) => void
  onDrop: () => void
}) {
  return (
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
      onPointerDown={(event) => props.onGrab(props.index, event)}
      onPointerMove={props.onDrag}
      onPointerUp={props.onDrop}
      onPointerCancel={props.onDrop}
    >
      <Icon name="grip" size={18} />
    </span>
  )
}
