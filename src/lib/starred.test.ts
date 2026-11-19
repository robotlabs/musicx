import { beforeEach, describe, expect, it } from 'vitest'
import { setTransport } from './pcloud'
import { refreshPlaylists, playlistsStore } from './playlists'
import { resetStarred, STARRED_NAME, starredStore, toggleStar } from './starred'

const song = (id: number) => ({ id, file: `${id}.mp3`, title: `Brano ${id}`, sub: 'Artista' })

describe('preferiti', () => {
  let calls: string[]
  let starredFiles: number[]
  let failNext = false

  beforeEach(() => {
    resetStarred()
    calls = []
    starredFiles = []
    failNext = false
    setTransport(async (method, params) => {
      calls.push(method)
      if (failNext) {
        failNext = false
        throw new Error('pCloud non risponde')
      }
      switch (method) {
        case 'collection_create':
          return { result: 0, collection: { id: 77, name: params.name, items: 0 } }
        case 'collection_linkfiles':
          starredFiles.push(...String(params.fileids).split(',').map(Number))
          return { result: 0, linkresult: [{ result: 0, fileid: params.fileids }] }
        case 'collection_unlinkfiles':
          starredFiles = starredFiles.filter((id) => id !== Number(params.fileids))
          return { result: 0 }
        case 'collection_list':
          return {
            result: 0,
            collections: [
              { id: 5, name: 'Battiato', items: 3 },
              { id: 77, name: STARRED_NAME, items: starredFiles.length },
            ],
          }
        case 'collection_details':
          return {
            result: 0,
            collection: {
              id: 77,
              name: STARRED_NAME,
              contents: starredFiles.map((id, index) => ({ fileid: id, name: `${id}.mp3`, isfolder: false, position: index + 1 })),
            },
          }
      }
      throw new Error(`unexpected ${method}`)
    })
  })

  it('la prima stella crea la playlist dei preferiti, la seconda toglie', async () => {
    expect(await toggleStar(song(1))).toBe(true)
    expect(calls).toEqual(['collection_create', 'collection_linkfiles'])
    expect(starredStore.get().id).toBe(77)
    expect(await toggleStar(song(2))).toBe(true)
    expect(starredStore.get().items.map((item) => item.id)).toEqual([1, 2])
    expect(await toggleStar(song(1))).toBe(false)
    expect(starredFiles).toEqual([2])
    expect([...starredStore.get().ids]).toEqual([2])
  })

  it('se pCloud non risponde la stella torna com\'era', async () => {
    await toggleStar(song(1))
    failNext = true
    await expect(toggleStar(song(3))).rejects.toThrow('pCloud non risponde')
    expect([...starredStore.get().ids]).toEqual([1])
  })

  it('non compare tra le playlist e si rilegge da pCloud', async () => {
    starredFiles = [4, 9]
    await refreshPlaylists()
    expect(playlistsStore.get().lists.map((list) => list.name)).toEqual(['Battiato'])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(starredStore.get()).toMatchObject({ id: 77 })
    expect(starredStore.get().items.map((item) => item.title)).toEqual(['4', '9'])
  })
})
