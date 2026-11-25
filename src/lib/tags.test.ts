import { beforeEach, describe, expect, it } from 'vitest'
import { buildLibrary, libraryStore } from './library'
import { setTransport, type RawMeta } from './pcloud'
import { addTag, deleteTag, loadTags, removeTag, renameTag, resetTags, searchTags, tagStore, tagsOf } from './tags'

describe('tag', () => {
  let folders: RawMeta[]
  let next: number

  const childrenOf = (id: number) => folders.filter((entry) => entry.parentfolderid === id)
  const tree = (id: number): RawMeta => ({ ...folders.find((entry) => entry.folderid === id)!, contents: childrenOf(id).map((child) => tree(child.folderid!)) })
  const pathOf = (id: number): string[] => {
    const entry = folders.find((folder) => folder.folderid === id)
    return entry ? [...pathOf(entry.parentfolderid!), entry.name] : []
  }
  const onPcloud = () =>
    folders
      .filter((entry) => childrenOf(entry.folderid!).length === 0)
      .map((entry) => pathOf(entry.folderid!).join('/'))
      .sort()

  beforeEach(() => {
    folders = []
    next = 100
    resetTags()
    libraryStore.set({ status: 'ready', library: buildLibrary({ name: 'music', isfolder: true, folderid: 1, contents: [] }), error: null, refreshing: false })
    setTransport(async (method, params) => {
      const id = Number(params.folderid)
      switch (method) {
        case 'createfolderifnotexists': {
          let made = folders.find((entry) => entry.parentfolderid === id && entry.name === params.name)
          if (!made) {
            made = { name: String(params.name), isfolder: true, folderid: next++, parentfolderid: id }
            folders.push(made)
          }
          return { result: 0, metadata: made }
        }
        case 'listfolder':
          if (params.recursive) return { result: 0, metadata: tree(id) }
          return { result: 0, metadata: { name: '', isfolder: true, folderid: id, contents: childrenOf(id) } }
        case 'deletefolder':
          if (childrenOf(id).length) return Promise.reject(new Error('Folder is not empty.'))
          folders = folders.filter((entry) => entry.folderid !== id)
          return { result: 0 }
        case 'deletefolderrecursive': {
          const gone = new Set([id])
          for (let grew = true; grew; ) {
            grew = false
            for (const entry of folders) {
              if (gone.has(entry.parentfolderid!) && !gone.has(entry.folderid!)) {
                gone.add(entry.folderid!)
                grew = true
              }
            }
          }
          folders = folders.filter((entry) => !gone.has(entry.folderid!))
          return { result: 0 }
        }
        case 'renamefolder': {
          const entry = folders.find((folder) => folder.folderid === id)!
          entry.name = String(params.toname)
          return { result: 0, metadata: entry }
        }
      }
      throw new Error(`unexpected ${method}`)
    })
  })

  const names = () => tagStore.get().tags.map((tag) => `${tag.name}: ${tag.items.map((item) => `${item.kind[0]}${item.id}`).join(' ')}`)

  it('un tag è una cartella in .musicx/tag con una cartellina per ogni cosa', async () => {
    await addTag('  Musica da cena ', [{ kind: 'folder', id: 7 }])
    await addTag('musica DA cena', [{ kind: 'playlist', id: 45 }, { kind: 'track', id: 678 }])
    await addTag('AC/DC vibes', [{ kind: 'track', id: 678 }])
    expect(names()).toEqual(['AC/DC vibes: t678', 'Musica da cena: f7 p45 t678'])
    expect(onPcloud()).toEqual([
      'music/.musicx/tag/AC∕DC vibes/t678',
      'music/.musicx/tag/Musica da cena/f7',
      'music/.musicx/tag/Musica da cena/p45',
      'music/.musicx/tag/Musica da cena/t678',
    ].map((path) => path.replace('music/', '')))
    // Un altro dispositivo li rilegge uguali.
    resetTags()
    await loadTags()
    expect(names()).toEqual(['AC/DC vibes: t678', 'Musica da cena: f7 p45 t678'])
    expect(tagsOf(tagStore.get().tags, { kind: 'track', id: 678 }).map((tag) => tag.name)).toEqual(['AC/DC vibes', 'Musica da cena'])
  })

  it("togliere l'ultima cosa fa sparire il tag, anche da pCloud", async () => {
    await addTag('chill', [{ kind: 'folder', id: 7 }, { kind: 'track', id: 8 }])
    await removeTag('Chill', [{ kind: 'folder', id: 7 }])
    expect(names()).toEqual(['chill: t8'])
    await removeTag('chill', [{ kind: 'track', id: 8 }])
    expect(names()).toEqual([])
    expect(onPcloud()).toEqual(['.musicx/tag'])
  })

  it('si toglie anche dopo aver riaperto l’app (dove sta si legge da pCloud)', async () => {
    await addTag('chill', [{ kind: 'track', id: 8 }, { kind: 'track', id: 9 }])
    const cached = tagStore.get().tags
    resetTags()
    tagStore.set({ tags: cached, loaded: true, error: null })
    await removeTag('chill', [{ kind: 'track', id: 8 }])
    expect(onPcloud()).toEqual(['.musicx/tag/chill/t9'])
  })

  it('rinominare e cancellare un tag', async () => {
    await addTag('chill', [{ kind: 'track', id: 8 }])
    await addTag('jazz', [{ kind: 'track', id: 9 }])
    await expect(renameTag('chill', 'JAZZ')).rejects.toThrow('C\'è già un tag "jazz"')
    await renameTag('chill', 'relax')
    expect(names()).toEqual(['jazz: t9', 'relax: t8'])
    await deleteTag('jazz')
    expect(names()).toEqual(['relax: t8'])
    expect(onPcloud()).toEqual(['.musicx/tag/relax/t8'])
  })

  it('senza la cartella dei tag non ce ne sono (e non la crea)', async () => {
    await loadTags()
    expect(tagStore.get()).toMatchObject({ tags: [], loaded: true, error: null })
    expect(folders).toEqual([])
  })

  it('la ricerca trova i tag per parole, senza badare ad accenti e maiuscole', async () => {
    await addTag('Città di notte', [{ kind: 'track', id: 1 }])
    await addTag('chill', [{ kind: 'track', id: 2 }])
    expect(searchTags(tagStore.get().tags, 'citta').map((tag) => tag.name)).toEqual(['Città di notte'])
    expect(searchTags(tagStore.get().tags, 'notte di').map((tag) => tag.name)).toEqual(['Città di notte'])
    expect(searchTags(tagStore.get().tags, 'rock')).toEqual([])
  })
})
