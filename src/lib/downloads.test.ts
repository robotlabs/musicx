import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RawMeta } from './pcloud'
import { createStore } from './store'

// Dispositivo finto: cosa è salvato, cosa si scarica e cosa si toglie.
interface Saved {
  name: string
  size: number
  used: number
  kind: 'download' | 'cache'
}
const audio = createStore<{ files: Record<number, Saved>; limit: number }>({ files: {}, limit: 0 })
const fetched: number[] = []
const forgotten: number[] = []
let pinsFile: unknown = null
const setFile = (id: number, kind: Saved['kind'] | null) =>
  audio.set((state) => {
    const files = { ...state.files }
    if (kind) files[id] = { name: `${id}.mp3`, size: 1, used: 0, kind }
    else delete files[id]
    return { ...state, files }
  })
vi.mock('./audioStore', () => ({
  audioStore: audio,
  canSave: () => true,
  saveTrack: async (id: number, _file: string, kind: Saved['kind']) => {
    fetched.push(id)
    setFile(id, kind)
    return true
  },
  setKind: (id: number, kind: Saved['kind']) => setFile(id, kind),
  forget: async (id: number) => {
    forgotten.push(id)
    setFile(id, null)
  },
  readMeta: async () => pinsFile,
  writeMeta: async (_name: string, data: unknown) => {
    pinsFile = data
  },
}))
const playlistTracks = new Map<number, { id: number; file: string }[]>()
vi.mock('./playlists', async () => {
  const { createStore } = await import('./store')
  const playlistsStore = createStore<{ tracks: Record<number, unknown> }>({ tracks: {} })
  return {
    playlistsStore,
    loadPlaylist: async (id: number) => {
      const tracks = playlistTracks.get(id)
      if (!tracks) throw new Error('offline')
      playlistsStore.set((state) => ({ tracks: { ...state.tracks, [id]: tracks } }))
    },
  }
})

const { buildLibrary, libraryStore } = await import('./library')
const { downloadsStore, initDownloads, pinFolder, pinPlaylist, pinTracks, wantedTracks } = await import('./downloads')
const { playlistsStore } = await import('./playlists')

const song = (fileid: number, name: string): RawMeta => ({ name, isfolder: false, fileid })
const listing: RawMeta = {
  name: 'music',
  isfolder: true,
  folderid: 1,
  contents: [
    { name: 'vasco', isfolder: true, folderid: 2, contents: [{ name: 'bollicine', isfolder: true, folderid: 3, contents: [song(31, 'a.mp3'), song(32, 'b.wma')] }, song(21, 'c.mp3')] },
    { name: 'misto', isfolder: true, folderid: 4, contents: [song(41, 'd.mp3')] },
  ],
}

const settle = () => vi.advanceTimersByTimeAsync(1000)

beforeEach(async () => {
  vi.useFakeTimers()
  fetched.length = 0
  forgotten.length = 0
  libraryStore.set({ status: 'ready', library: buildLibrary(listing, 0), error: null, refreshing: false })
  downloadsStore.set({ pins: { tracks: {}, folders: [], playlists: [] }, todo: 0, done: 0, failed: 0, waiting: false })
  audio.set({ files: {}, limit: 0 })
  playlistsStore.set((state) => ({ ...state, tracks: {} }))
  playlistTracks.clear()
  await initDownloads()
  await settle()
})

describe('download', () => {
  it('una cartella scaricata porta con sé le sottocartelle, ma non i formati che Chrome non suona', async () => {
    pinFolder(2, true)
    expect([...wantedTracks().keys()].sort()).toEqual([21, 31])
    await settle()
    expect(fetched.sort()).toEqual([21, 31])
    expect(audio.get().files[31].kind).toBe('download')
  })

  it('un brano già precaricato diventa scaricato senza riscaricarlo… e togliendo la scelta sparisce', async () => {
    setFile(41, 'cache')
    pinTracks([{ id: 41, file: 'd.mp3' }], true)
    await settle()
    expect(audio.get().files[41].kind).toBe('download')
    pinTracks([{ id: 41, file: 'd.mp3' }], false)
    await settle()
    expect(forgotten).toEqual([41])
  })

  it('una playlist scaricata segue pCloud: i brani aggiunti arrivano, quelli tolti spariscono', async () => {
    playlistTracks.set(9, [{ id: 41, file: 'd.mp3' }])
    pinPlaylist(9, true)
    await settle()
    expect(audio.get().files[41].kind).toBe('download')
    playlistsStore.set((state) => ({ ...state, tracks: { 9: [{ id: 21, file: 'c.mp3' }] as never } }))
    await settle()
    expect(audio.get().files[21].kind).toBe('download')
    expect(forgotten).toEqual([41])
  })

  it('senza rete e con una playlist mai letta non butta via niente', async () => {
    setFile(31, 'download')
    downloadsStore.set((state) => ({ ...state, pins: { tracks: {}, folders: [], playlists: [77] } }))
    pinFolder(4, true)
    await settle()
    expect(forgotten).toEqual([])
    expect(audio.get().files[31].kind).toBe('download')
  })
})
