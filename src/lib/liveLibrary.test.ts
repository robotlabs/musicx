import { describe, expect, it } from 'vitest'
import { buildLibrary, type Library } from './library'
import { applyEvents } from './liveLibrary'
import type { DiffEntry, RawMeta } from './pcloud'

const song = (fileid: number, name: string, extra: Partial<RawMeta> = {}): RawMeta => ({ name, isfolder: false, fileid, ...extra })
const listing = (): RawMeta => ({
  name: 'music',
  isfolder: true,
  folderid: 1,
  contents: [
    { name: 'vasco', isfolder: true, folderid: 2, contents: [{ name: 'bollicine', isfolder: true, folderid: 3, contents: [song(31, 'b.mp3'), song(32, 'a.mp3')] }] },
    { name: 'misto', isfolder: true, folderid: 4, contents: [song(41, 'c.mp3')] },
    { name: 'Da sistemare', isfolder: true, folderid: 5, contents: [{ name: 'vuota dentro', isfolder: true, folderid: 6, contents: [] }] },
  ],
})

let diffid = 100
const file = (event: string, fileid: number, parentfolderid: number, name: string, extra: Partial<RawMeta> = {}): DiffEntry => ({
  event,
  diffid: ++diffid,
  metadata: { name, isfolder: false, fileid, parentfolderid, ...extra },
})
const dir = (event: string, folderid: number, parentfolderid: number, name: string): DiffEntry => ({
  event,
  diffid: ++diffid,
  metadata: { name, isfolder: true, folderid, parentfolderid },
})

const apply = (library: Library, entries: DiffEntry[]) => applyEvents(library, entries)
const totals = (library: Library) => Object.fromEntries([...library.folders].map(([id, folder]) => [id, folder.total]))

describe('cambiamenti da pCloud', () => {
  it('un brano nuovo entra nella sua cartella, ordinato, con i tag e i conteggi giusti', () => {
    const { library, refresh } = apply(buildLibrary(listing(), 0), [file('createfile', 33, 3, '0 primo.mp3', { title: 'Primo', artist: 'Vasco', hash: 7, size: 9 })])
    expect(refresh).toBe(false)
    expect(library.folders.get(3)!.tracks).toEqual([33, 32, 31])
    expect(library.tracks.get(33)).toMatchObject({ parent: 3, title: 'Primo', artist: 'Vasco', hash: '7', size: 9 })
    expect(totals(library)).toMatchObject({ 1: 4, 2: 3, 3: 3, 4: 1 })
  })

  it('in una cartella vuota la porta nella lista (con quelle sopra)', () => {
    const { library } = apply(buildLibrary(listing(), 0), [file('createfile', 61, 6, 'x.mp3')])
    expect(library.folders.get(1)!.folders).toContain(5)
    expect(library.folders.get(5)).toMatchObject({ folders: [6], total: 1 })
    expect(library.folders.get(6)).toMatchObject({ parent: 5, tracks: [61], total: 1 })
  })

  it('spostato, rinominato, cancellato; i file che non sono musica non contano', () => {
    let { library } = apply(buildLibrary(listing(), 0), [file('modifyfile', 41, 3, 'c.mp3')])
    expect(library.folders.get(4)!.tracks).toEqual([])
    expect(library.tracks.get(41)!.parent).toBe(3)
    ;({ library } = apply(library, [file('modifyfile', 41, 3, 'zz.mp3'), file('createfile', 99, 3, 'copertina.jpg')]))
    expect(library.tracks.get(41)!.name).toBe('zz.mp3')
    expect(library.tracks.has(99)).toBe(false)
    ;({ library } = apply(library, [file('deletefile', 31, 3, 'b.mp3')]))
    expect(library.folders.get(3)!.tracks).toEqual([32, 41])
    expect(totals(library)).toMatchObject({ 1: 2, 2: 2, 3: 2, 4: 0 })
  })

  it('un brano portato fuori dalla libreria sparisce', () => {
    const { library } = apply(buildLibrary(listing(), 0), [file('modifyfile', 31, 777, 'b.mp3')])
    expect(library.tracks.has(31)).toBe(false)
    expect(library.folders.get(1)!.total).toBe(2)
  })

  it('cartelle: creata e riempita, rinominata, spostata, cancellata con tutto dentro', () => {
    let { library } = apply(buildLibrary(listing(), 0), [dir('createfolder', 7, 4, 'nuova'), file('createfile', 71, 7, 'n.mp3')])
    expect(library.folders.get(4)).toMatchObject({ folders: [7], total: 2 })
    ;({ library } = apply(library, [dir('modifyfolder', 3, 4, 'Bollicine 1983')]))
    expect(library.folders.get(3)).toMatchObject({ parent: 4, name: 'Bollicine 1983' })
    expect(library.folders.get(4)!.folders).toEqual([3, 7])
    expect(totals(library)).toMatchObject({ 1: 4, 2: 0, 4: 4 })
    ;({ library } = apply(library, [dir('deletefolder', 4, 1, 'misto')]))
    expect(library.folders.has(3)).toBe(false)
    expect(library.tracks.size).toBe(0)
    expect(library.folders.get(1)!.total).toBe(0)
  })

  it('una cartella arrivata da fuori non si conosce: va riletto tutto', () => {
    expect(apply(buildLibrary(listing(), 0), [dir('modifyfolder', 500, 1, 'da fuori')]).refresh).toBe(true)
    expect(apply(buildLibrary(listing(), 0), [{ event: 'reset', diffid: 1 }]).refresh).toBe(true)
  })

  it('lo stesso evento due volte non cambia niente', () => {
    const entries = [file('createfile', 33, 3, 'n.mp3'), file('modifyfile', 41, 3, 'c.mp3'), dir('createfolder', 8, 1, 'z')]
    const once = apply(buildLibrary(listing(), 0), entries).library
    const twice = apply(once, entries).library
    expect(totals(twice)).toEqual(totals(once))
    expect(twice.folders.get(3)!.tracks).toEqual(once.folders.get(3)!.tracks)
  })
})
