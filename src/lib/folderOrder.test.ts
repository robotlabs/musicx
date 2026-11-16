import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildLibrary, libraryStore, updateTracks, type Library } from './library'
import type { RawMeta } from './pcloud'

// Il salvataggio vero scarica e ricarica il file: qui si registra solo cosa verrebbe scritto.
const saved: { id: number; track: string }[] = []
let failOn: number | null = null
vi.mock('./trackInfo', () => ({
  canWriteTags: (name: string) => name.endsWith('.mp3'),
  saveTrackInfo: async (id: number, change: { track: string }) => {
    await Promise.resolve()
    if (id === failOn) throw new Error('rete giù')
    saved.push({ id, track: change.track })
    // Come show() in trackInfo.ts: l'indice prende il numero letto dal file.
    updateTracks(new Map([[id, { track: change.track }]]))
  },
}))

const { canReorder, moveFolderTrack, orderStore } = await import('./folderOrder')

let nextId = 1
const file = (name: string, trackno?: number): RawMeta => ({ name, isfolder: false, fileid: nextId++, album: 'Disco', trackno })
const folder = (name: string, contents: RawMeta[]): RawMeta => ({ name, isfolder: true, folderid: nextId++, contents })

let library: Library
let albumId: number
const names = () => {
  const now = libraryStore.get().library!
  return now.folders.get(albumId)!.tracks.map((id) => now.tracks.get(id)!.name)
}
const idOf = (name: string) => [...library.tracks.values()].find((track) => track.name === name)!.id
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const yes = async () => true

beforeEach(() => {
  saved.length = 0
  failOn = null
  const album = folder('disco', [file('A.mp3', 1), file('B.mp3', 2), file('C.mp3', 3), file('D.mp3', 4)])
  library = buildLibrary(folder('music', [album, folder('misto', [file('x.mp3'), file('y.flac')])]), 0)
  albumId = album.folderid!
  libraryStore.set({ status: 'ready', library, error: null, refreshing: false })
})

describe('riordinare una cartella trascinando', () => {
  it("l'ordine cambia subito e si riscrivono solo i file col numero cambiato", async () => {
    await moveFolderTrack(albumId, 3, 1, yes, () => {})
    expect(names()).toEqual(['A.mp3', 'D.mp3', 'B.mp3', 'C.mp3'])
    while (orderStore.get()) await settle()
    expect(saved).toEqual([
      { id: idOf('D.mp3'), track: '2' },
      { id: idOf('B.mp3'), track: '3' },
      { id: idOf('C.mp3'), track: '4' },
    ])
    expect(names()).toEqual(['A.mp3', 'D.mp3', 'B.mp3', 'C.mp3'])
  })

  it('se un file non si salva, l\'indice torna come sono i file', async () => {
    failOn = idOf('B.mp3')
    const errors: unknown[] = []
    await moveFolderTrack(albumId, 3, 0, yes, (error) => errors.push(error))
    expect(names()).toEqual(['D.mp3', 'A.mp3', 'B.mp3', 'C.mp3'])
    while (orderStore.get()) await settle()
    expect(errors).toHaveLength(1)
    // D e A erano già salvati (1 e 2), B e C no: restano 2 e 3, con D=1, A=2 (A prima di B a pari numero).
    expect(saved.map((entry) => entry.track)).toEqual(['1', '2'])
    expect(names()).toEqual(['D.mp3', 'A.mp3', 'B.mp3', 'C.mp3'])
    const now = libraryStore.get().library!
    expect(now.tracks.get(idOf('B.mp3'))!.track).toBe('2')
    expect(now.tracks.get(idOf('C.mp3'))!.track).toBe('3')
  })

  it('con tanti file chiede prima, e rinunciando non cambia niente', async () => {
    const many = folder('tanti', Array.from({ length: 30 }, (_, i) => file(`${String(i + 1).padStart(2, '0')}.mp3`)))
    library = buildLibrary(folder('music', [many]), 0)
    libraryStore.set({ status: 'ready', library, error: null, refreshing: false })
    const asked: number[] = []
    await moveFolderTrack(many.folderid!, 0, 29, async (files) => (asked.push(files), false), () => {})
    expect(asked).toEqual([30])
    expect(saved).toEqual([])
    expect(libraryStore.get().library).toBe(library)
  })

  it('si riordina solo se sono tutti mp3', () => {
    expect(canReorder(albumId)).toBe(true)
    const mixed = [...library.folders.values()].find((entry) => entry.name === 'misto')!
    expect(canReorder(mixed.id)).toBe(false)
  })
})
