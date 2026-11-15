// Azioni condivise tra le varie liste: menu di un brano, aggiunta a una playlist.

import { libraryStore } from '../lib/library'
import { enqueue, playNext } from '../lib/player'
import { addToPlaylist, playlistsStore } from '../lib/playlists'
import type { QItem } from '../lib/queue'
import { navigate } from '../lib/router'
import { choosePlaylist, openMenu, toast, type MenuItem } from './sheets'
import { errorText, tracksLabel } from './text'

/** Chiede in quale playlist e ci aggiunge i brani. */
export async function addToPlaylistFlow(trackIds: number[]) {
  if (!trackIds.length) return
  const id = await choosePlaylist()
  if (id !== null) await addTracksTo(id, trackIds)
}

/** Aggiunge i brani alla playlist e dice com'è andata. */
export async function addTracksTo(id: number, trackIds: number[]) {
  try {
    const added = await addToPlaylist(id, trackIds)
    const name = playlistsStore.get().lists.find((list) => list.id === id)?.title ?? 'playlist'
    const skipped = trackIds.length - added
    if (added === 0) toast(trackIds.length === 1 ? `È già in "${name}".` : `Sono già tutti in "${name}".`)
    else toast(`${tracksLabel(added)} in "${name}"${skipped ? ` (${skipped} già presenti)` : ''}.`)
  } catch (error) {
    toast(errorText(error))
  }
}

/** Voci di menu valide per qualsiasi gruppo di brani (uno solo o una cartella intera). */
export function queueMenuItems(items: QItem[]): MenuItem[] {
  return [
    { label: 'Riproduci dopo', icon: 'playNext', onSelect: () => playNext(items) },
    { label: 'Aggiungi alla coda', icon: 'queue', onSelect: () => enqueue(items) },
    { label: 'Aggiungi a playlist…', icon: 'plus', onSelect: () => void addToPlaylistFlow(items.map((item) => item.id)) },
  ]
}

/** Menu ⋯ di un brano. `parent` è la cartella che lo contiene, se si vuole la voce per andarci. */
export function openTrackMenu(item: QItem, options: { parent?: number | null; extra?: MenuItem[] } = {}) {
  const items = queueMenuItems([item])
  const parent = options.parent
  if (parent != null && libraryStore.get().library?.folders.has(parent)) {
    items.push({ label: 'Vai alla cartella', icon: 'folder', onSelect: () => navigate({ name: 'folder', id: parent }) })
  }
  openMenu(item.title, [...items, ...(options.extra ?? [])], item.sub)
}
