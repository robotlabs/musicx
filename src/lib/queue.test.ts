import { describe, expect, it } from 'vitest'
import {
  appendToQueue,
  emptyQueue,
  insertNext,
  nextIndex,
  previousIndex,
  removeAt,
  replaceQueue,
  toggleShuffle,
  type QItem,
} from './queue'

const item = (id: number): QItem => ({ id, file: `${id}.mp3`, title: `t${id}`, sub: '' })
const items = [1, 2, 3, 4, 5].map(item)
const ids = (list: QItem[]) => list.map((entry) => entry.id)
/** "Mescolatore" prevedibile: lascia l'ordine invariato. */
const noShuffle = () => 0.999

describe('coda', () => {
  it('replaceQueue parte dal brano scelto', () => {
    const queue = replaceQueue(emptyQueue, items, 2)
    expect(queue.index).toBe(2)
    expect(ids(queue.items)).toEqual([1, 2, 3, 4, 5])
  })

  it('con lo shuffle il brano scelto va in testa e il resto si mescola', () => {
    const queue = replaceQueue({ ...emptyQueue, shuffle: true }, items, 3, Math.random)
    expect(queue.index).toBe(0)
    expect(queue.items[0].id).toBe(4)
    expect(ids(queue.items).sort()).toEqual([1, 2, 3, 4, 5])
    expect(queue.original).toBe(items)
  })

  it('spegnere lo shuffle torna all\'ordine originale sullo stesso brano', () => {
    const on = toggleShuffle(replaceQueue(emptyQueue, items, 1), Math.random)
    expect(on.items[on.index].id).toBe(2)
    const off = toggleShuffle(on)
    expect(ids(off.items)).toEqual([1, 2, 3, 4, 5])
    expect(off.index).toBe(1)
  })

  it('insertNext mette dopo il corrente, appendToQueue in fondo', () => {
    const queue = replaceQueue(emptyQueue, items, 1)
    expect(ids(insertNext(queue, [item(9)]).items)).toEqual([1, 2, 9, 3, 4, 5])
    expect(ids(appendToQueue(queue, [item(9)]).items)).toEqual([1, 2, 3, 4, 5, 9])
  })

  it('su una coda vuota insertNext e appendToQueue partono dal primo', () => {
    expect(insertNext(emptyQueue, [item(7)]).index).toBe(0)
    expect(appendToQueue(emptyQueue, [item(7)]).index).toBe(0)
  })

  it('removeAt tiene allineato il brano corrente', () => {
    const queue = replaceQueue(emptyQueue, items, 2)
    expect(removeAt(queue, 0).index).toBe(1)
    expect(removeAt(queue, 4).index).toBe(2)
    const removedCurrent = removeAt(queue, 2)
    expect(removedCurrent.items[removedCurrent.index].id).toBe(4)
    const last = removeAt(replaceQueue(emptyQueue, items, 4), 4)
    expect(last.index).toBe(3)
    expect(removeAt(replaceQueue(emptyQueue, [item(1)], 0), 0).index).toBe(-1)
  })

  it('avanti e indietro rispettano la ripetizione', () => {
    const end = replaceQueue(emptyQueue, items, 4, noShuffle)
    expect(nextIndex(end, true)).toBeNull()
    expect(nextIndex({ ...end, repeat: 'all' }, true)).toBe(0)
    expect(nextIndex({ ...end, repeat: 'one' }, true)).toBe(4)
    // Il tasto avanti salta anche con "ripeti brano".
    expect(nextIndex({ ...end, repeat: 'one' }, false)).toBeNull()
    const start = replaceQueue(emptyQueue, items, 0)
    expect(previousIndex(start)).toBeNull()
    expect(previousIndex({ ...start, repeat: 'all' })).toBe(4)
  })
})
