import { describe, expect, it, vi } from 'vitest'
import type { RawMeta } from './pcloud'

// pCloud finto: l'elenco della libreria arriva quando lo decide il test.
let deliver: (root: RawMeta) => void = () => {}
vi.mock('./pcloud', () => ({
  PCloudError: class extends Error {},
  listTree: () => new Promise<RawMeta>((resolve) => (deliver = resolve)),
}))

const { libraryStore, refreshLibrary, updateTracks } = await import('./library')

const listing = (): RawMeta => ({
  name: 'music',
  isfolder: true,
  folderid: 1,
  contents: [
    {
      name: 'colpa',
      isfolder: true,
      folderid: 2,
      contents: [
        { name: 'Track-01.mp3', isfolder: false, fileid: 11, album: 'Colpa', trackno: 1 },
        { name: 'Track-02.mp3', isfolder: false, fileid: 12, album: 'Colpa', trackno: 2 },
      ],
    },
  ],
})

describe('rileggere la libreria', () => {
  it('non perde le modifiche fatte mentre arrivava l\'elenco', async () => {
    const first = refreshLibrary()
    deliver(listing())
    await first

    // Si rilegge; intanto si cambia un brano. L'elenco che arriva è stato letto prima della modifica.
    const second = refreshLibrary()
    updateTracks(new Map([[12, { name: 'Alibi.mp3', title: 'Alibi', track: '1' }], [11, { track: '2' }]]))
    deliver(listing())
    await second

    const library = libraryStore.get().library!
    expect(library.tracks.get(12)).toMatchObject({ name: 'Alibi.mp3', title: 'Alibi', track: '1' })
    expect(library.folders.get(2)!.tracks).toEqual([12, 11])
  })
})
