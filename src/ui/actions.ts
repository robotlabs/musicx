// Azioni condivise tra le varie liste: menu di un brano, aggiunta a una playlist.

import { libraryStore } from '../lib/library'
import { enqueue, playNext } from '../lib/player'
import { addToPlaylist, playlistsStore } from '../lib/playlists'
import type { QItem } from '../lib/queue'
import { navigate } from '../lib/router'
import { trackDownloadItems } from './downloadActions'
import { starMenuItem } from './star'
import { editTracksInfo } from './editInfo'
import { moveTracksFlow } from './moveTo'
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

/** "Sposta in cartella…" e "Modifica info" se i brani sono nella libreria (una playlist può contenere file di altre cartelle). */
const editItem = (ids: number[]): MenuItem[] => {
  const library = libraryStore.get().library
  if (!ids.length || !ids.every((id) => library?.tracks.has(id))) return []
  return [
    { label: 'Sposta in cartella…', icon: 'moveTo', onSelect: () => void moveTracksFlow(ids) },
    { label: ids.length > 1 ? `Modifica info di ${tracksLabel(ids.length)}` : 'Modifica info', icon: 'edit', onSelect: () => editTracksInfo(ids) },
  ]
}

/**
 * Menu ⋯ di un brano. `parent` è la cartella che lo contiene, se si vuole la voce per andarci.
 * Con `selected` (più brani selezionati col mouse, compreso questo) il menu vale per tutti.
 */
export function openTrackMenu(item: QItem, options: { parent?: number | null; extra?: MenuItem[]; selected?: QItem[] | null } = {}) {
  const selected = options.selected
  if (selected && selected.length > 1) {
    const ids = selected.map((entry) => entry.id)
    openMenu(`${tracksLabel(selected.length)} selezionati`, [...queueMenuItems(selected), ...trackDownloadItems(selected), ...editItem(ids)])
    return
  }
  const items = [starMenuItem(item), ...queueMenuItems([item])]
  const parent = options.parent
  if (parent != null && libraryStore.get().library?.folders.has(parent)) {
    items.push({ label: 'Vai alla cartella', icon: 'folder', onSelect: () => navigate({ name: 'folder', id: parent }) })
  }
  openMenu(item.title, [...items, ...trackDownloadItems([item]), ...editItem([item.id]), ...(options.extra ?? [])], item.sub)
}
