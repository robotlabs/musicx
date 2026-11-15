import { beforeEach, describe, expect, it } from 'vitest'
import { setTransport } from './pcloud'
import {
  groupPlaylists,
  joinName,
  movePlaylistsToGroup,
  playlistsStore,
  refreshPlaylists,
  renameGroup,
  renamePlaylist,
  splitName,
  ungroup,
} from './playlists'

describe('group names', () => {
  it('splits group and title', () => {
    expect(splitName('CCCP ▸ Epica etica')).toEqual({ group: 'CCCP', title: 'Epica etica' })
    expect(splitName('CCCP▸Epica')).toEqual({ group: 'CCCP', title: 'Epica' })
    expect(splitName('Battiato')).toEqual({ group: null, title: 'Battiato' })
    expect(splitName('De Gregori - Rimmel')).toEqual({ group: null, title: 'De Gregori - Rimmel' })
    // Un segno all'inizio o alla fine non fa un gruppo.
    expect(splitName('▸ strano')).toEqual({ group: null, title: '▸ strano' })
    expect(splitName('strano ▸')).toEqual({ group: null, title: 'strano ▸' })
  })

  it('joins and keeps the separator out of names', () => {
    expect(joinName('CCCP', 'Epica')).toBe('CCCP ▸ Epica')
    expect(joinName(null, '  Battiato ')).toBe('Battiato')
    expect(joinName('A ▸ B', 'C')).toBe('A - B ▸ C')
    expect(splitName(joinName('A ▸ B', 'C ▸ D'))).toEqual({ group: 'A - B', title: 'C - D' })
  })

  it('groups playlists alphabetically and keeps the loose ones apart', () => {
    const list = (id: number, name: string) => ({ id, name, count: 0, ...splitName(name) })
    const { groups, loose } = groupPlaylists([list(1, 'b ▸ x'), list(2, 'Solo'), list(3, 'a ▸ y'), list(4, 'b ▸ z')])
    expect(groups.map((group) => [group.name, group.lists.map((item) => item.id)])).toEqual([
      ['a', [3]],
      ['b', [1, 4]],
    ])
    expect(loose.map((item) => item.id)).toEqual([2])
  })
})

describe('moving playlists between groups', () => {
  let names: Map<number, string>
  let renames: string[]

  beforeEach(async () => {
    names = new Map([
      [1, 'CCCP ▸ Socialismo'],
      [2, 'CCCP ▸ Punkow'],
      [3, 'Battiato'],
    ])
    renames = []
    setTransport(async (method, params) => {
      if (method === 'collection_list') {
        return { result: 0, collections: [...names].map(([id, name]) => ({ id, name, items: 0, system: false })) }
      }
      if (method === 'collection_rename') {
        names.set(Number(params.collectionid), String(params.name))
        renames.push(String(params.name))
        return { result: 0 }
      }
      throw new Error(`unexpected ${method}`)
    })
    await refreshPlaylists()
  })

  const shown = () => playlistsStore.get().lists.map((list) => `${list.group ?? '-'}/${list.title}`).sort()

  it('moves into a group, out of it, and renames only the title', async () => {
    await movePlaylistsToGroup([3], 'Italiani')
    expect(names.get(3)).toBe('Italiani ▸ Battiato')
    await movePlaylistsToGroup([3], null)
    expect(names.get(3)).toBe('Battiato')
    await renamePlaylist(1, 'Socialismo e barbarie')
    expect(names.get(1)).toBe('CCCP ▸ Socialismo e barbarie')
    expect(shown()).toEqual(['-/Battiato', 'CCCP/Punkow', 'CCCP/Socialismo e barbarie'])
  })

  it('renames and dissolves a whole group, skipping playlists that would not change', async () => {
    await renameGroup('CCCP', 'CSI')
    expect([...renames].sort()).toEqual(['CSI ▸ Punkow', 'CSI ▸ Socialismo'])
    await movePlaylistsToGroup([1], 'CSI')
    expect(renames).toHaveLength(2)
    await ungroup('CSI')
    expect(shown()).toEqual(['-/Battiato', '-/Punkow', '-/Socialismo'])
  })
})
