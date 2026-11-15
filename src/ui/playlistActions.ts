// Menu e richieste per playlist e gruppi di playlist, condivisi da barra laterale e pagine.

import { renameOpenGroup, setGroupOpen } from '../lib/openGroups'
import {
  deletePlaylist,
  groupPlaylists,
  movePlaylistsToGroup,
  playlistsStore,
  renameGroup,
  renamePlaylist,
  tidyName,
  ungroup,
  type Playlist,
  type PlaylistGroup,
} from '../lib/playlists'
import { navigate } from '../lib/router'
import { askText, choosePlaylists, confirmAction, createPlaylistFlow, openMenu, toast, type MenuItem } from './sheets'
import { errorText, tracksLabel } from './text'

const report = (task: Promise<unknown>) => void task.catch((error) => toast(errorText(error)))

const groupNames = () => groupPlaylists(playlistsStore.get().lists).groups.map((group) => group.name)

export const playlistCount = (count: number) => (count === 1 ? '1 playlist' : `${count} playlist`)

/** Sposta le playlist in un gruppo e lo apre, così si vede dove sono finite. */
function moveTo(ids: number[], group: string | null) {
  if (group) setGroupOpen(tidyName(group), true)
  report(movePlaylistsToGroup(ids, group))
}

async function askGroupName(title: string, initial = '') {
  const name = await askText(title, { initial, placeholder: 'Nome del gruppo', confirm: initial ? 'Rinomina' : 'Avanti' })
  return name && tidyName(name) ? tidyName(name) : null
}

/** Nuovo gruppo: nome, poi le playlist da metterci (un gruppo esiste solo se ne contiene almeno una). */
export async function newGroupFlow() {
  const name = await askGroupName('Nuovo gruppo')
  if (!name) return
  const ids = await choosePlaylists(`Playlist da mettere in "${name}"`, { confirm: 'Crea gruppo' })
  if (ids?.length) moveTo(ids, name)
}

function moveToGroupMenu(list: Playlist) {
  const items: MenuItem[] = [
    {
      label: 'Nuovo gruppo…',
      icon: 'plus',
      onSelect: async () => {
        const name = await askGroupName('Nuovo gruppo')
        if (name) moveTo([list.id], name)
      },
    },
    ...groupNames()
      .filter((name) => name !== list.group)
      .map((name): MenuItem => ({ label: name, icon: 'folder', onSelect: () => moveTo([list.id], name) })),
  ]
  if (list.group) items.push({ label: 'Fuori dai gruppi', icon: 'close', onSelect: () => moveTo([list.id], null) })
  openMenu('Sposta in gruppo', items, list.title)
}

export async function renamePlaylistFlow(list: Playlist) {
  const next = await askText('Rinomina playlist', { initial: list.title, confirm: 'Rinomina' })
  if (next && next !== list.title) report(renamePlaylist(list.id, next))
}

/** Restituisce true se la playlist è stata eliminata. */
export async function deletePlaylistFlow(list: Playlist): Promise<boolean> {
  const sure = await confirmAction(`Eliminare "${list.title}"?`, 'La playlist sparisce da pCloud. I brani restano dove sono.', 'Elimina')
  if (!sure) return false
  try {
    await deletePlaylist(list.id)
    return true
  } catch (error) {
    toast(errorText(error))
    return false
  }
}

/** Voci per spostare, rinominare ed eliminare una playlist. `onDeleted` serve alla pagina della playlist. */
export function playlistMenuItems(list: Playlist, onDeleted?: () => void): MenuItem[] {
  return [
    { label: 'Sposta in gruppo…', icon: 'folder', onSelect: () => moveToGroupMenu(list) },
    { label: 'Rinomina', icon: 'edit', onSelect: () => void renamePlaylistFlow(list) },
    {
      label: 'Elimina playlist',
      icon: 'trash',
      danger: true,
      onSelect: async () => {
        if ((await deletePlaylistFlow(list)) && onDeleted) onDeleted()
      },
    },
  ]
}

export const playlistSubtitle = (list: Playlist) => [list.group, tracksLabel(list.count)].filter(Boolean).join(' · ')

export function openPlaylistMenu(list: Playlist) {
  openMenu(list.title, playlistMenuItems(list), playlistSubtitle(list))
}

export function openGroupMenu(group: PlaylistGroup) {
  openMenu(
    group.name,
    [
      {
        label: 'Aggiungi playlist…',
        icon: 'plus',
        onSelect: async () => {
          const ids = await choosePlaylists(`Aggiungi a "${group.name}"`, {
            confirm: 'Aggiungi',
            exclude: group.lists.map((list) => list.id),
          })
          if (ids?.length) moveTo(ids, group.name)
        },
      },
      {
        label: 'Nuova playlist nel gruppo',
        icon: 'list',
        onSelect: async () => {
          const id = await createPlaylistFlow('', group.name)
          if (id !== null) navigate({ name: 'playlist', id })
        },
      },
      {
        label: 'Rinomina gruppo',
        icon: 'edit',
        onSelect: async () => {
          const name = await askGroupName('Rinomina gruppo', group.name)
          if (!name || name === group.name) return
          renameOpenGroup(group.name, name)
          report(renameGroup(group.name, name))
        },
      },
      {
        label: 'Sciogli gruppo',
        icon: 'close',
        danger: true,
        onSelect: async () => {
          const sure = await confirmAction(
            `Sciogliere "${group.name}"?`,
            `${playlistCount(group.lists.length)} escono dal gruppo. Nessuna playlist viene eliminata.`,
            'Sciogli',
          )
          if (sure) report(ungroup(group.name))
        },
      },
    ],
    playlistCount(group.lists.length),
  )
}

/** Il "+" accanto alle playlist: nuova playlist o nuovo gruppo. */
export function openCreateMenu() {
  openMenu('Crea', [
    {
      label: 'Nuova playlist',
      icon: 'list',
      onSelect: async () => {
        const id = await createPlaylistFlow()
        if (id !== null) navigate({ name: 'playlist', id })
      },
    },
    { label: 'Nuovo gruppo di playlist', icon: 'folder', onSelect: () => void newGroupFlow() },
  ])
}
