// Azioni condivise tra le varie liste: menu di un brano, aggiunta a una playlist.

import { forget } from '../lib/audioStore'
import { libraryStore } from '../lib/library'
import { applyLocalEvents } from '../lib/liveLibrary'
import { deleteFile } from '../lib/pcloud'
import { enqueue, playNext } from '../lib/player'
import { addToPlaylist, playlistsStore, removeFromPlaylist } from '../lib/playlists'
import type { QItem } from '../lib/queue'
import { navigate } from '../lib/router'
import { trackDownloadItems } from './downloadActions'
import { starMenuItem } from './star'
import { tagMenuItem } from './tagPicker'
import { editTracksInfo } from './editInfo'
import { moveTracksFlow } from './moveTo'
import { choosePlaylist, confirmAction, openMenu, toast, type MenuItem } from './sheets'
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

/** "Tag…" per brani della libreria (quelli di una playlist che stanno fuori non si ritroverebbero). */
const tagItem = (ids: number[], title: string): MenuItem[] => {
  const library = libraryStore.get().library
  if (!ids.length || !ids.every((id) => library?.tracks.has(id))) return []
  return [tagMenuItem(ids.map((id) => ({ kind: 'track' as const, id })), title)]
}

/**
 * Sposta i file nel cestino di pCloud e li toglie dall'indice e dal dispositivo. Con `question`
 * prima chiede conferma (senza, la scelta è già stata fatta in un menu).
 */
export async function deleteTracks(ids: number[], question: string | null) {
  if (question) {
    const sure = await confirmAction(
      question,
      'Vanno nel cestino di pCloud, da dove si possono recuperare. Se erano in una playlist, lì non ci sono più.',
      'Elimina',
    )
    if (!sure) return
  }
  let done = 0
  for (const id of ids) {
    try {
      await deleteFile(id)
      applyLocalEvents([{ event: 'deletefile', diffid: 0, metadata: { name: '', isfolder: false, fileid: id } }])
      void forget(id)
      done += 1
    } catch (error) {
      toast(errorText(error))
      return
    }
  }
  toast(done === 1 ? 'Spostato nel cestino di pCloud.' : `${tracksLabel(done)} spostati nel cestino di pCloud.`)
}

async function removeTracksFrom(playlist: number, ids: number[]) {
  try {
    for (const id of ids) await removeFromPlaylist(playlist, id)
    toast(ids.length === 1 ? 'Tolto dalla playlist.' : `${tracksLabel(ids.length)} tolti dalla playlist.`)
  } catch (error) {
    toast(errorText(error))
  }
}

/** Via il file, a partire da una playlist: prima lo si toglie da lì (così sparisce subito), poi nel cestino. */
async function deleteFromList(playlist: number, ids: number[]) {
  for (const id of ids) await removeFromPlaylist(playlist, id).catch(() => {})
  await deleteTracks(ids, null)
}

/**
 * "Elimina". Dentro una playlist chiede: solo da questa playlist o via il file da pCloud (nel cestino).
 * Altrove elimina il file, dopo la conferma. Il file si elimina solo se è nella libreria.
 */
const deleteItems = (items: QItem[], playlist?: number): MenuItem[] => {
  if (!items.length) return []
  const library = libraryStore.get().library
  const inLibrary = items.every((item) => library?.tracks.has(item.id))
  const ids = items.map((item) => item.id)
  const what = items.length === 1 ? `"${items[0].title}"` : tracksLabel(items.length)
  const label = items.length === 1 ? 'Elimina' : `Elimina ${tracksLabel(items.length)}`
  if (playlist === undefined) {
    return inLibrary ? [{ label, icon: 'trash', danger: true, onSelect: () => void deleteTracks(ids, `Eliminare ${what}?`) }] : []
  }
  const fromList: MenuItem = { label: 'Solo da questa playlist', icon: 'close', onSelect: () => void removeTracksFrom(playlist, ids) }
  if (!inLibrary) return [{ ...fromList, label: 'Togli dalla playlist', danger: true }]
  return [
    {
      label,
      icon: 'trash',
      danger: true,
      onSelect: () =>
        openMenu(
          `Eliminare ${what}?`,
          [fromList, { label: 'Via il file da pCloud', icon: 'trash', danger: true, onSelect: () => void deleteFromList(playlist, ids) }],
          'Il file va nel cestino di pCloud (si recupera da lì) e sparisce da tutte le playlist.',
        ),
    },
  ]
}

/**
 * Menu ⋯ di un brano. `parent` è la cartella che lo contiene, se si vuole la voce per andarci.
 * Con `selected` (più brani selezionati col mouse, compreso questo) il menu vale per tutti.
 */
export function openTrackMenu(
  item: QItem,
  options: { parent?: number | null; extra?: MenuItem[]; selected?: QItem[] | null; playlist?: number } = {},
) {
  const selected = options.selected
  if (selected && selected.length > 1) {
    const ids = selected.map((entry) => entry.id)
    const title = `${tracksLabel(selected.length)} selezionati`
    openMenu(title, [...queueMenuItems(selected), ...tagItem(ids, title), ...trackDownloadItems(selected), ...editItem(ids), ...deleteItems(selected, options.playlist)])
    return
  }
  const items = [starMenuItem(item), ...queueMenuItems([item])]
  const parent = options.parent
  if (parent != null && libraryStore.get().library?.folders.has(parent)) {
    items.push({ label: 'Vai alla cartella', icon: 'folder', onSelect: () => navigate({ name: 'folder', id: parent }) })
  }
  openMenu(
    item.title,
    [...items, ...tagItem([item.id], item.title), ...trackDownloadItems([item]), ...editItem([item.id]), ...(options.extra ?? []), ...deleteItems([item], options.playlist)],
    item.sub,
  )
}
