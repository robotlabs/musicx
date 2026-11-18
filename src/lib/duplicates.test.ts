import { describe, expect, it } from 'vitest'
import { findDuplicates, findSong } from './duplicates'
import { buildLibrary } from './library'
import type { RawMeta } from './pcloud'

const song = (fileid: number, name: string, extra: Partial<RawMeta> = {}): RawMeta => ({ name, isfolder: false, fileid, ...extra })
const library = buildLibrary({
  name: 'music',
  isfolder: true,
  folderid: 1,
  contents: [
    {
      name: 'a',
      isfolder: true,
      folderid: 2,
      contents: [
        song(1, '01 Albachiara.mp3', { artist: 'Vasco Rossi', title: 'Albachiara', hash: 111, size: 5 }),
        song(2, 'Siamo solo noi.mp3', { artist: 'Vasco Rossi', title: 'Siamo solo noi', hash: 222, size: 6 }),
      ],
    },
    {
      name: 'b',
      isfolder: true,
      folderid: 3,
      contents: [
        song(3, 'Albachiara (copia).mp3', { artist: 'Vasco Rossi', title: 'Albachiara', hash: 111, size: 5 }),
        song(4, 'albachiara.flac', { artist: 'VASCO ROSSI', title: 'Albachiara (Remastered)', hash: 333, size: 30 }),
        song(5, '07 - Siamo solo noi.mp3', { hash: 444, size: 6 }),
        song(6, 'senza impronta.mp3'),
      ],
    },
  ],
})

describe('doppioni', () => {
  it('identici: stessa impronta e dimensione', () => {
    expect(findDuplicates(library).same).toEqual([[1, 3]])
  })

  it('stesso brano in file diversi: artista e titolo, senza parentesi né numeri davanti', () => {
    expect(findDuplicates(library).similar).toEqual([[1, 3, 4]])
  })

  it('conta i brani senza impronta (indice da rileggere)', () => {
    expect(findDuplicates(library).unknown).toBe(1)
  })

  it('trova se una canzone c\'è già: titolo e artista, anche con parentesi o senza tag', () => {
    expect(findSong(library, 'vasco rossi', 'Albachiara (Official Video)').map((track) => track.id)).toEqual([1, 3, 4])
    expect(findSong(library, 'Vasco Rossi', 'Siamo solo noi').map((track) => track.id)).toEqual([2])
    expect(findSong(library, 'Ligabue', 'Albachiara')).toEqual([])
  })
})
