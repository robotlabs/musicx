import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RawMeta } from './pcloud'

// Una playlist su un pCloud finto. Come sposti gli altri brani pCloud non lo dice: si prova sia
// "togli e rimetti" sia "scambia i due", e l'ordine finale deve venire giusto in tutti e due i casi.
let fileIds: number[] = []
let mode: 'splice' | 'swap' = 'splice'
let moves = 0
vi.mock('./pcloud', () => ({
  PCloudError: class extends Error {},
  listTree: async () => ({}),
  collections: {
    list: async () => [{ id: 7, name: 'Colpa', items: fileIds.length }],
    details: async () => ({ id: 7, name: 'Colpa', items: fileIds.length, contents: fileIds.map((fileid, i) => ({ fileid, name: `${fileid}.mp3`, position: i + 1 })) }),
    move: async (_id: number, fileId: number, from: number, to: number) => {
      moves++
      if (fileIds[from - 1] !== fileId) throw new Error('posizione sbagliata')
      if (mode === 'splice') {
        const [moved] = fileIds.splice(from - 1, 1)
        fileIds.splice(to - 1, 0, moved)
      } else {
        ;[fileIds[from - 1], fileIds[to - 1]] = [fileIds[to - 1], fileIds[from - 1]]
      }
    },
  },
}))

const { buildLibrary, libraryStore } = await import('./library')
const { loadPlaylist, playlistsStore, sortPlaylistByTrackNumber, trackNumberOrder } = await import('./playlists')

const song = (fileid: number, name: string, album: string, trackno?: number): RawMeta => ({ name, isfolder: false, fileid, album, trackno })

beforeEach(() => {
  moves = 0
  const music: RawMeta = {
    name: 'music',
    isfolder: true,
    folderid: 1,
    contents: [
      {
        name: 'colpa',
        isfolder: true,
        folderid: 2,
        contents: [
          song(11, "Non l'hai mica capito.mp3", "Colpa D'Alfredo", 1),
          song(12, "Colpa d'alfredo.mp3", "Colpa D'Alfredo", 2),
          song(13, 'Susanna.mp3', "Colpa d'Alfredo", 3),
          song(14, 'Anima fragile.mp3', "Colpa D'Alfredo", 4),
          song(15, 'Alibi.mp3', "Colpa D'alfredo", 5),
        ],
      },
      { name: 'bollicine', isfolder: true, folderid: 3, contents: [song(21, 'Track-02.mp3', 'Bollicine'), song(22, 'Track-01.mp3', 'Bollicine')] },
    ],
  }
  libraryStore.set({ status: 'ready', library: buildLibrary(music, 0), error: null, refreshing: false })
})

describe('ordinare una playlist per numero di traccia', () => {
  it('raggruppa per album nell\'ordine in cui compaiono e dentro segue il numero', () => {
    const items = [14, 22, 12, 99, 11, 21].map((id, i) => ({ id, file: `${id}.mp3`, title: String(id), sub: '', position: i + 1, parent: null }))
    expect(trackNumberOrder(items).map((item) => item.id)).toEqual([11, 12, 14, 22, 21, 99])
  })

  for (const how of ['splice', 'swap'] as const) {
    it(`su pCloud arriva l'ordine giusto (spostamento "${how}")`, async () => {
      mode = how
      fileIds = [14, 12, 15, 13, 11]
      await loadPlaylist(7)
      const sorting = sortPlaylistByTrackNumber(7)
      // A schermo subito.
      expect(playlistsStore.get().tracks[7]!.map((track) => track.id)).toEqual([11, 12, 13, 14, 15])
      await sorting
      expect(fileIds).toEqual([11, 12, 13, 14, 15])
      expect(playlistsStore.get().tracks[7]!.map((track) => track.id)).toEqual([11, 12, 13, 14, 15])
    })
  }

  it('se è già in ordine non tocca pCloud', async () => {
    fileIds = [11, 12, 13]
    await loadPlaylist(7)
    await sortPlaylistByTrackNumber(7)
    expect(moves).toBe(0)
  })
})
