import { describe, expect, it } from 'vitest'
import { buildLibrary, folderTrail, normalize, searchLibrary, tracksUnder } from './library'
import { matchM3u, parseM3u } from './m3u'
import type { RawMeta } from './pcloud'

let nextId = 1
const file = (name: string, tags: Partial<RawMeta> = {}): RawMeta => ({ name, isfolder: false, fileid: nextId++, ...tags })
const folder = (name: string, contents: RawMeta[]): RawMeta => ({ name, isfolder: true, folderid: nextId++, contents })

const raw = folder('music', [
  folder('-musica', [
    folder('--listen', [
      folder('Avion_Travel-Nino_Rota_Lamico_Magico-2009-ONe', [
        file('01-avion_travel-parlami_di_me.mp3', { artist: 'Avion Travel', title: 'Parlami Di Me' }),
        file('cover.jpg'),
      ]),
      folder('JMI', [file('10 Track 10.mp3'), file('2 Track 02.mp3'), file('._2 Track 02.mp3')]),
    ]),
    folder('Solo immagini', [file('a.jpg')]),
  ]),
  folder('Città', [file('Perché.flac')]),
])

const library = buildLibrary(raw, 0)
const byName = (name: string) => [...library.folders.values()].find((entry) => entry.name === name)!

describe('indice della libreria', () => {
  it('tiene solo i file audio e scarta le cartelle senza musica', () => {
    expect(library.tracks.size).toBe(4)
    expect([...library.folders.values()].some((entry) => entry.name === 'Solo immagini')).toBe(false)
    expect(library.folders.get(library.rootId)!.total).toBe(4)
  })

  it('ordina i nomi come una persona (2 prima di 10)', () => {
    const jmi = byName('JMI')
    expect(jmi.tracks.map((id) => library.tracks.get(id)!.name)).toEqual(['2 Track 02.mp3', '10 Track 10.mp3'])
  })

  it('tracksUnder raccoglie anche le sottocartelle e folderTrail risale alla radice', () => {
    expect(tracksUnder(library, byName('--listen').id)).toHaveLength(3)
    expect(folderTrail(library, byName('JMI').id).map((entry) => entry.name)).toEqual(['music', '-musica', '--listen', 'JMI'])
  })

  it('la ricerca ignora maiuscole, accenti e trattini', () => {
    expect(normalize('Città_Perché')).toBe('citta perche')
    expect(searchLibrary(library, 'parlami avion').tracks).toHaveLength(1)
    expect(searchLibrary(library, 'perche').tracks.map((track) => track.name)).toEqual(['Perché.flac'])
    expect(searchLibrary(library, 'citta').folders.map((entry) => entry.name)).toEqual(['Città'])
    expect(searchLibrary(library, 'amico magico').folders).toHaveLength(1)
    expect(searchLibrary(library, '   ').tracks).toHaveLength(0)
  })
})

describe('import .m3u', () => {
  it('riconosce i percorsi del vecchio pCloud Drive, del server rclone e quelli relativi', () => {
    const text = [
      '#EXTM3U',
      '#EXTINF:219,Avion Travel - Parlami Di Me',
      'file:///Users/roberto/pCloud%20Drive/rob/music/-musica/--listen/Avion_Travel-Nino_Rota_Lamico_Magico-2009-ONe/01-avion_travel-parlami_di_me.mp3',
      'http://127.0.0.1:8620/-musica/--listen/JMI/10%20Track%2010.mp3',
      'Città/Perché.flac',
      'file:///Users/roberto/pCloud%20Drive/rob/music/sparito.mp3',
      '',
    ].join('\n')
    const references = parseM3u(text)
    expect(references).toHaveLength(4)
    const { trackIds, missing } = matchM3u(library, references)
    expect(trackIds.map((id) => library.tracks.get(id)!.name)).toEqual([
      '01-avion_travel-parlami_di_me.mp3',
      '10 Track 10.mp3',
      'Perché.flac',
    ])
    expect(missing).toEqual(['file:///Users/roberto/pCloud%20Drive/rob/music/sparito.mp3'])
  })
})
