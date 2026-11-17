import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RawMeta } from './pcloud'

// pCloud finto: cosa c'è in ogni cartella (solo i nomi, per i doppioni) e cosa si è spostato.
const names = new Map<number, string[]>()
const moves: [number, number][] = []
let deliver: (root: RawMeta) => void = () => {}
vi.mock('./pcloud', () => ({
  PCloudError: class extends Error {},
  listTree: () => new Promise<RawMeta>((resolve) => (deliver = resolve)),
  listFolder: async (folderid: number) => ({ name: '', isfolder: true, folderid, contents: (names.get(folderid) ?? []).map((name) => ({ name, isfolder: false })) }),
  moveFile: async (fileid: number, tofolderid: number) => {
    moves.push([fileid, tofolderid])
    return { name: '', isfolder: false, fileid }
  },
  moveFolder: async (folderid: number, tofolderid: number) => {
    moves.push([folderid, tofolderid])
    return { name: '', isfolder: true, folderid }
  },
  createFolder: async () => ({}),
}))
vi.mock('./player', () => ({ updateQueueItems: () => {} }))
vi.mock('./playlists', () => ({ updatePlaylistTracks: () => {} }))

const { buildLibrary, libraryStore, refreshLibrary } = await import('./library')
const { moveFolderTo, moveTracks } = await import('./move')

const song = (fileid: number, name: string, trackno?: number): RawMeta => ({ name, isfolder: false, fileid, album: 'Disco', trackno })
const listing = (): RawMeta => ({
  name: 'music',
  isfolder: true,
  folderid: 1,
  contents: [
    { name: 'vasco', isfolder: true, folderid: 2, contents: [{ name: 'bollicine', isfolder: true, folderid: 3, contents: [song(31, 'Vado al massimo.mp3', 1), song(32, 'Bollicine.mp3', 2)] }] },
    { name: 'misto', isfolder: true, folderid: 4, contents: [song(41, 'Alibi.mp3'), song(42, 'Susanna.mp3'), song(43, 'Bollicine.mp3')] },
  ],
})

const root = { id: 1, name: 'Libreria' }
const library = () => libraryStore.get().library!
const folder = (id: number) => library().folders.get(id)!

beforeEach(() => {
  names.clear()
  moves.length = 0
  libraryStore.set({ status: 'ready', library: buildLibrary(listing(), 0), error: null, refreshing: false })
})

describe('spostare brani', () => {
  it("passano nell'altra cartella, con conteggi e ordine giusti", async () => {
    names.set(3, ['Vado al massimo.mp3', 'Bollicine.mp3', 'copertina.jpg'])
    const result = await moveTracks([41, 42], [root, { id: 2, name: 'vasco' }, { id: 3, name: 'bollicine' }])
    expect(result).toMatchObject({ moved: 2, clashes: [], failed: 0 })
    expect(moves).toEqual([[41, 3], [42, 3]])
    expect(folder(4).tracks).toEqual([43])
    expect(folder(3).tracks).toEqual([31, 32, 41, 42])
    expect(library().tracks.get(41)!.parent).toBe(3)
    expect([folder(1).total, folder(2).total, folder(3).total, folder(4).total]).toEqual([5, 4, 4, 1])
  })

  it('non sostituisce un file con lo stesso nome (pCloud lo farebbe)', async () => {
    names.set(3, ['Vado al massimo.mp3', 'bollicine.MP3'])
    const result = await moveTracks([43, 41], [root, { id: 2, name: 'vasco' }, { id: 3, name: 'bollicine' }])
    expect(result).toMatchObject({ moved: 1, clashes: ['Bollicine.mp3'] })
    expect(moves).toEqual([[41, 3]])
    expect(library().tracks.get(43)!.parent).toBe(4)
  })

  it('in una cartella che l\'indice non ha (vuota o nuova), la aggiunge', async () => {
    const result = await moveTracks([31], [root, { id: 2, name: 'vasco' }, { id: 50, name: 'Da sistemare' }, { id: 51, name: 'nuova' }])
    expect(result.moved).toBe(1)
    expect(folder(2).folders).toEqual([3, 50])
    expect(folder(50)).toMatchObject({ parent: 2, folders: [51], total: 1 })
    expect(folder(51)).toMatchObject({ parent: 50, tracks: [31], total: 1 })
    expect(folder(3).tracks).toEqual([32])
    expect(folder(2).total).toBe(2)
  })

  it('se sono già lì non chiama pCloud', async () => {
    const result = await moveTracks([41], [root, { id: 4, name: 'misto' }])
    expect(result.moved).toBe(0)
    expect(moves).toEqual([])
  })

  it('una rilettura della libreria arrivata dopo non annulla lo spostamento', async () => {
    const refreshing = refreshLibrary()
    await moveTracks([41], [root, { id: 2, name: 'vasco' }, { id: 50, name: 'Da sistemare' }])
    deliver(listing())
    await refreshing
    expect(library().tracks.get(41)!.parent).toBe(50)
    expect(folder(50).tracks).toEqual([41])
    expect(folder(4).tracks).toEqual([43, 42])
  })
})

describe('spostare una cartella', () => {
  it('si porta dietro i brani e i conteggi', async () => {
    await moveFolderTo(3, [root, { id: 4, name: 'misto' }])
    expect(moves).toEqual([[3, 4]])
    expect(folder(3).parent).toBe(4)
    expect(folder(4).folders).toEqual([3])
    expect(folder(2).folders).toEqual([])
    expect([folder(1).total, folder(2).total, folder(4).total]).toEqual([5, 0, 5])
  })

  it('non va dentro sé stessa e non sopra una con lo stesso nome', async () => {
    await expect(moveFolderTo(2, [root, { id: 2, name: 'vasco' }, { id: 3, name: 'bollicine' }])).rejects.toThrow('dentro sé stessa')
    names.set(4, ['Bollicine'])
    await expect(moveFolderTo(3, [root, { id: 4, name: 'misto' }])).rejects.toThrow('c\'è già')
    expect(moves).toEqual([])
  })
})
