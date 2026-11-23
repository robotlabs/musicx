import { beforeEach, describe, expect, it } from 'vitest'
import { buildLibrary, libraryStore } from './library'
import { setTransport, type RawMeta } from './pcloud'
import { addWish, loadWishes, removeWish, wishStore } from './wishlist'

describe('da cercare', () => {
  let folders: RawMeta[]
  let next: number

  beforeEach(() => {
    folders = []
    next = 100
    wishStore.set({ items: [], loaded: false, error: null })
    libraryStore.set({ status: 'ready', library: buildLibrary({ name: 'music', isfolder: true, folderid: 1, contents: [] }), error: null, refreshing: false })
    setTransport(async (method, params) => {
      const parent = Number(params.folderid)
      switch (method) {
        case 'createfolderifnotexists': {
          let made = folders.find((entry) => entry.parentfolderid === parent && entry.name === params.name)
          if (!made) {
            made = { name: String(params.name), isfolder: true, folderid: next++, parentfolderid: parent, created: new Date(next * 1000).toUTCString() }
            folders.push(made)
          }
          return { result: 0, metadata: made }
        }
        case 'listfolder':
          return { result: 0, metadata: { name: '', isfolder: true, folderid: parent, contents: folders.filter((entry) => entry.parentfolderid === parent) } }
        case 'deletefolder':
          folders = folders.filter((entry) => entry.folderid !== parent)
          return { result: 0 }
      }
      throw new Error(`unexpected ${method}`)
    })
  })

  it('una voce è una cartellina in .musicx/da cercare, anche con la barra nel titolo', async () => {
    await addWish('AC/DC  - Thunderstruck ')
    await addWish('Nina Simone - Sinnerman')
    const list = folders.find((entry) => entry.name === 'da cercare')!
    expect(folders.find((entry) => entry.folderid === list.parentfolderid)?.name).toBe('.musicx')
    expect(folders.filter((entry) => entry.parentfolderid === list.folderid).map((entry) => entry.name)).toEqual([
      'AC∕DC - Thunderstruck',
      'Nina Simone - Sinnerman',
    ])
    wishStore.set({ items: [], loaded: false, error: null })
    await loadWishes()
    expect(wishStore.get().items.map((wish) => wish.text)).toEqual(['AC/DC - Thunderstruck', 'Nina Simone - Sinnerman'])
  })

  it('togliere una voce manda la cartellina nel cestino', async () => {
    await addWish('Wax Tailor - Que Sera')
    const [wish] = wishStore.get().items
    await removeWish(wish.id)
    expect(wishStore.get().items).toEqual([])
    expect(folders.some((entry) => entry.folderid === wish.id)).toBe(false)
  })

  it('senza la cartella la lista è vuota (e non la crea)', async () => {
    await loadWishes()
    expect(wishStore.get()).toMatchObject({ items: [], loaded: true, error: null })
    expect(folders).toEqual([])
  })
})
