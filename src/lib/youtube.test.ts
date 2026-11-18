import { describe, expect, it } from 'vitest'
import { buildLibrary } from './library'
import type { RawMeta } from './pcloud'
import { artistFolder, guessFromTitle, safeName } from './youtube'

describe('artista e titolo dal video', () => {
  it('"Artista - Titolo (Official Video)"', () => {
    expect(guessFromTitle('Daft Punk - One More Time (Official Video)', 'Daft Punk')).toEqual({ artist: 'Daft Punk', title: 'One More Time' })
    expect(guessFromTitle('Vasco Rossi - Albachiara (Testo / Lyrics)', 'Mamma Mia Music')).toEqual({ artist: 'Vasco Rossi', title: 'Albachiara' })
    expect(guessFromTitle('Vasco Rossi-Albachiara.', 'fablol97')).toEqual({ artist: 'Vasco Rossi', title: 'Albachiara.' })
  })

  it('senza trattino: il canale fa da artista', () => {
    expect(guessFromTitle('Albachiara [Remastered]', 'Vasco Rossi - Topic')).toEqual({ artist: 'Vasco Rossi', title: 'Albachiara' })
  })

  it('nome del file senza caratteri vietati', () => {
    expect(safeName('AC/DC - Back in Black: Live?')).toBe('AC DC - Back in Black Live')
  })
})

describe('cartella dell\'artista', () => {
  const song = (fileid: number, artist?: string): RawMeta => ({ name: `${fileid}.mp3`, isfolder: false, fileid, artist })
  const library = buildLibrary({
    name: 'music',
    isfolder: true,
    folderid: 1,
    contents: [
      { name: 'Vasco Rossi', isfolder: true, folderid: 2, contents: [song(21, 'Vasco Rossi')] },
      { name: 'misto', isfolder: true, folderid: 3, contents: [{ name: 'vasco rossi', isfolder: true, folderid: 4, contents: [song(41)] }] },
      { name: 'Daft Punk - Discovery', isfolder: true, folderid: 5, contents: [song(51, 'Daft Punk'), song(52, 'Daft Punk')] },
    ],
  })

  it('preferisce la cartella con lo stesso nome appena sotto la radice', () => {
    expect(artistFolder(library, 'VASCO ROSSI')).toBe(2)
  })

  it('altrimenti quella con più brani suoi', () => {
    expect(artistFolder(library, 'Daft Punk')).toBe(5)
  })

  it('null se non c\'è', () => {
    expect(artistFolder(library, 'Franco Battiato')).toBeNull()
  })
})
