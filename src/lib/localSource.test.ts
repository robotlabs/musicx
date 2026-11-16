import { describe, expect, it } from 'vitest'
import { buildLibrary } from './library'
import { trackPath } from './localSource'
import type { RawMeta } from './pcloud'

const tree: RawMeta = {
  name: 'music',
  isfolder: true,
  folderid: 1,
  contents: [
    {
      name: '-dementia]',
      isfolder: true,
      folderid: 2,
      contents: [
        {
          name: 'Bisio & Tanica',
          isfolder: true,
          folderid: 3,
          contents: [{ name: 'Non Può Essere #1?.mp3', isfolder: false, fileid: 30 }],
        },
        { name: 'Le Donne Di Tunisi.mp3', isfolder: false, fileid: 20 },
      ],
    },
    { name: 'sciolto.flac', isfolder: false, fileid: 10 },
  ],
}

describe('trackPath', () => {
  const library = buildLibrary(tree)

  it('parte dalla cartella della musica, senza includerla', () => {
    expect(trackPath(library, 10)).toBe('sciolto.flac')
    expect(trackPath(library, 20)).toBe('-dementia%5D/Le%20Donne%20Di%20Tunisi.mp3')
  })

  it('codifica ogni pezzo del percorso, accenti e simboli compresi', () => {
    expect(trackPath(library, 30)).toBe('-dementia%5D/Bisio%20%26%20Tanica/Non%20Pu%C3%B2%20Essere%20%231%3F.mp3')
  })

  it('non inventa percorsi per brani fuori dalla libreria', () => {
    expect(trackPath(library, 99)).toBeNull()
  })
})
