// Selezionare più brani col mouse, come nelle app desktop (Spotify, Finder):
// clic seleziona, Maiusc+clic seleziona l'intervallo, Cmd/Ctrl+clic aggiunge o toglie, doppio clic suona.
// Cmd/Ctrl+A seleziona tutto, Esc o un clic nel vuoto tolgono la selezione.
// Sul touch non c'è: il tocco su un brano lo fa partire.

import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import { finePointer } from './drag'
import { sheetOpen } from './sheets'

interface Picked {
  rows: ReadonlySet<number>
  /** Riga da cui parte l'intervallo con Maiusc+clic. */
  anchor: number
}

const none: Picked = { rows: new Set(), anchor: -1 }

export interface Selection {
  /** Posizioni (indici nella lista) delle righe selezionate. */
  rows: ReadonlySet<number>
  /** Gestore del clic sulla riga `index`; assente sul touch. */
  select?: (index: number, event: MouseEvent) => void
  /** Cosa trascinare partendo dalla riga `index`: tutta la selezione se la riga ne fa parte, se no solo lei. */
  dragFrom: (index: number) => { ids: number[]; label: string } | null
  /** Le righe selezionate (in ordine) se `index` è una di più righe selezionate, se no null. */
  selectedWith: (index: number) => number[] | null
}

export const isTyping = (target: EventTarget | null) =>
  target instanceof Element &&
  Boolean(target.closest('input:not([type=range]):not([type=checkbox]):not([type=radio]), textarea, select, [contenteditable]'))

/**
 * Selezione per una lista di brani. Si azzera quando cambia la lista (`items` è un altro array).
 * `label` dà il nome al gruppo trascinato (e alla playlist nuova creata rilasciandolo).
 */
export function useSelection(items: readonly { id: number; title: string }[], label: string): Selection {
  const [picked, setPicked] = useState<Picked>(none)
  const latest = useRef({ items, label, picked })
  latest.current = { items, label, picked }

  useEffect(() => setPicked(none), [items])

  useEffect(() => {
    if (!finePointer) return
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || sheetOpen()) return
      if (event.key === 'Escape') {
        setPicked(none)
      } else if (event.key.toLowerCase() === 'a' && (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey) {
        event.preventDefault()
        setPicked({ rows: new Set(latest.current.items.keys()), anchor: 0 })
      }
    }
    // Un clic nella pagina fuori dalle righe (e dai pulsanti) toglie la selezione.
    const onClick = (event: globalThis.MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('.content') && !target.closest('button, a, input, li')) setPicked(none)
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('click', onClick)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('click', onClick)
    }
  }, [])

  const select = useCallback((index: number, event: MouseEvent) => {
    const toggle = event.metaKey || event.ctrlKey
    setPicked(({ rows, anchor }) => {
      if (event.shiftKey && anchor >= 0) {
        const next = new Set(toggle ? rows : [])
        for (let i = Math.min(anchor, index); i <= Math.max(anchor, index); i++) next.add(i)
        return { rows: next, anchor }
      }
      if (toggle) {
        const next = new Set(rows)
        if (!next.delete(index)) next.add(index)
        return { rows: next, anchor: index }
      }
      return { rows: new Set([index]), anchor: index }
    })
  }, [])

  const selectedWith = useCallback((index: number) => {
    const { items, picked } = latest.current
    if (!picked.rows.has(index) || picked.rows.size < 2) return null
    return [...picked.rows].filter((row) => row < items.length).sort((a, b) => a - b)
  }, [])

  const dragFrom = useCallback(
    (index: number) => {
      const { items, label } = latest.current
      const item = items[index]
      if (!item) return null
      const rows = selectedWith(index)
      return rows ? { ids: rows.map((row) => items[row].id), label } : { ids: [item.id], label: item.title }
    },
    [selectedWith],
  )

  return { rows: picked.rows, select: finePointer ? select : undefined, dragFrom, selectedWith }
}
