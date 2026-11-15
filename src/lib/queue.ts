// La coda di riproduzione come dati puri: nessun audio qui dentro, così si può testare.

export type Repeat = 'off' | 'all' | 'one'

/** Un brano in coda. Porta con sé quello che serve per mostrarlo, senza dipendere dall'indice. */
export interface QItem {
  /** fileid di pCloud. */
  id: number
  /** Nome del file (serve l'estensione per decidere se transcodificare). */
  file: string
  title: string
  sub: string
}

export interface QueueState {
  items: QItem[]
  /** Posizione del brano corrente, -1 a coda vuota. */
  index: number
  shuffle: boolean
  repeat: Repeat
  /** Con lo shuffle attivo: l'ordine originale, per poterci tornare. */
  original: QItem[] | null
}

export const emptyQueue: QueueState = { items: [], index: -1, shuffle: false, repeat: 'off', original: null }

export function shuffled<T>(list: T[], random: () => number = Math.random): T[] {
  const result = [...list]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

/** Sostituisce la coda e parte da `start`. Con lo shuffle attivo il resto viene mescolato. */
export function replaceQueue(queue: QueueState, items: QItem[], start: number, random?: () => number): QueueState {
  if (!items.length) return { ...queue, items: [], index: -1, original: null }
  const index = Math.min(Math.max(start, 0), items.length - 1)
  if (!queue.shuffle) return { ...queue, items, index, original: null }
  const rest = items.filter((_, i) => i !== index)
  return { ...queue, items: [items[index], ...shuffled(rest, random)], index: 0, original: items }
}

/** Inserisce subito dopo il brano corrente. */
export function insertNext(queue: QueueState, added: QItem[]): QueueState {
  if (!queue.items.length) return replaceQueue(queue, added, 0)
  const items = [...queue.items]
  items.splice(queue.index + 1, 0, ...added)
  return { ...queue, items, original: queue.original && [...queue.original, ...added] }
}

export function appendToQueue(queue: QueueState, added: QItem[]): QueueState {
  if (!queue.items.length) return replaceQueue(queue, added, 0)
  return {
    ...queue,
    items: [...queue.items, ...added],
    original: queue.original && [...queue.original, ...added],
  }
}

/** Toglie un brano. Se era quello corrente, `index` resta e punta al successivo (o all'ultimo). */
export function removeAt(queue: QueueState, position: number): QueueState {
  const removed = queue.items[position]
  if (!removed) return queue
  const items = queue.items.filter((_, i) => i !== position)
  let index = queue.index
  if (position < index) index -= 1
  if (index >= items.length) index = items.length - 1
  return {
    ...queue,
    items,
    index,
    original: items.length ? (queue.original?.filter((item) => item !== removed) ?? null) : null,
  }
}

/** Accende lo shuffle (mescola quello che viene dopo) o lo spegne (torna all'ordine originale). */
export function toggleShuffle(queue: QueueState, random?: () => number): QueueState {
  if (!queue.shuffle) {
    if (!queue.items.length) return { ...queue, shuffle: true }
    const played = queue.items.slice(0, queue.index + 1)
    const upcoming = queue.items.slice(queue.index + 1)
    return { ...queue, shuffle: true, items: [...played, ...shuffled(upcoming, random)], original: queue.items }
  }
  const current = queue.items[queue.index]
  const position = queue.original && current ? queue.original.indexOf(current) : -1
  if (!queue.original || position < 0) return { ...queue, shuffle: false, original: null }
  return { ...queue, shuffle: false, items: queue.original, index: position, original: null }
}

export const nextRepeat = (repeat: Repeat): Repeat => (repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off')

/**
 * L'indice del prossimo brano, o null se la riproduzione finisce.
 * `auto` = il brano è finito da solo (rispetta "ripeti brano"); altrimenti è il tasto avanti.
 */
export function nextIndex(queue: QueueState, auto: boolean): number | null {
  if (!queue.items.length) return null
  if (auto && queue.repeat === 'one') return queue.index
  if (queue.index < queue.items.length - 1) return queue.index + 1
  return queue.repeat === 'all' ? 0 : null
}

export function previousIndex(queue: QueueState): number | null {
  if (!queue.items.length) return null
  if (queue.index > 0) return queue.index - 1
  return queue.repeat === 'all' ? queue.items.length - 1 : null
}
