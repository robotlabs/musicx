// Trascinare brani (o cartelle intere) sulle playlist della barra laterale.
// Solo con il mouse: sul telefono la barra laterale non c'è e il tocco lungo resta allo scorrimento.

import type { DragEvent } from 'react'
import { createStore } from '../lib/store'

export interface DragPayload {
  /** Brani (id file pCloud) da aggiungere. */
  ids: number[]
  /** Cosa si sta trascinando, per l'etichetta che segue il puntatore e per il nome di una nuova playlist. */
  label: string
}

/** Cosa si sta trascinando adesso, se qualcosa. */
export const dragStore = createStore<DragPayload | null>(null)

const canDrag = typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches

let startedAt = 0

// Se la riga di partenza sparisce durante il trascinamento, "dragend" non arriva: appena il
// puntatore torna a muoversi normalmente il trascinamento è sicuramente finito.
if (typeof window !== 'undefined') {
  window.addEventListener('pointermove', () => {
    if (dragStore.get() && Date.now() - startedAt > 300) dragStore.set(null)
  })
}

/** Proprietà da mettere sull'elemento trascinabile. `get` viene chiamata solo quando parte il trascinamento. */
export function dragSource(get: () => DragPayload | null) {
  if (!canDrag) return {}
  return {
    draggable: true,
    onDragStart: (event: DragEvent<HTMLElement>) => {
      const payload = get()
      if (!payload?.ids.length) {
        event.preventDefault()
        return
      }
      event.dataTransfer.effectAllowed = 'copy'
      event.dataTransfer.setData('text/plain', payload.label)
      const ghost = document.createElement('div')
      ghost.className = 'drag-ghost'
      ghost.textContent = payload.ids.length === 1 ? `♪ ${payload.label}` : `${payload.label} · ${payload.ids.length} brani`
      document.body.append(ghost)
      event.dataTransfer.setDragImage(ghost, 14, 14)
      setTimeout(() => ghost.remove())
      startedAt = Date.now()
      dragStore.set(payload)
    },
    onDragEnd: () => dragStore.set(null),
  }
}

/** Prende quello che si stava trascinando e chiude il trascinamento. */
export function takeDrag(): DragPayload | null {
  const payload = dragStore.get()
  dragStore.set(null)
  return payload
}
