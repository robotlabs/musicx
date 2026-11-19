// "Importa" nella pagina Playlist: un .m3u o una playlist esportata da iTunes (.xml), scelta tra i
// file che stanno nella cartella della musica su pCloud o da un file del dispositivo.

import { LOCAL_SOURCE } from '../config'
import { matchItunes, parseItunes, type ItunesPlaylist } from '../lib/itunes'
import { libraryStore } from '../lib/library'
import { localSourceUp, whyNoFiles } from '../lib/localSource'
import { matchM3u, parseM3u } from '../lib/m3u'
import { isNativeApp, nativeGetBytes } from '../lib/native'
import { fileLink, listFolder, type RawMeta } from '../lib/pcloud'
import { addToPlaylist } from '../lib/playlists'
import { navigate } from '../lib/router'
import { createPlaylistFlow, openMenu, toast } from './sheets'
import { errorText, tracksLabel } from './text'

const PLAYLIST_FILE = /\.(m3u8?|xml)$/i
const baseName = (fileName: string) => fileName.replace(PLAYLIST_FILE, '')

/** Una playlist di iTunes da scegliere, se nel file ce n'è più di una. */
function choosePlaylist(lists: ItunesPlaylist[]): Promise<ItunesPlaylist | null> {
  if (lists.length <= 1) return Promise.resolve(lists[0] ?? null)
  return new Promise((resolve) => {
    openMenu(
      'Quale playlist?',
      lists.map((list) => ({ label: `${list.name} (${tracksLabel(list.tracks.length)})`, icon: 'list' as const, onSelect: () => resolve(list) })),
    )
  })
}

function missingText(missing: string[]) {
  if (!missing.length) return ''
  if (missing.length <= 2) return ` Non trovati: ${missing.join('; ')}.`
  return ` ${missing.length} non trovati (es. ${missing.slice(0, 2).join('; ')}).`
}

/** Crea la playlist dai brani del file che si ritrovano nella libreria. */
export async function importPlaylistText(fileName: string, text: string) {
  const library = libraryStore.get().library
  if (!library) return toast('La libreria non è ancora caricata.')

  let name = baseName(fileName)
  let trackIds: number[]
  let missing: string[]
  let total: number
  if (/\.xml$/i.test(fileName) || text.trimStart().startsWith('<?xml')) {
    const list = await choosePlaylist(parseItunes(text))
    if (!list) return toast('In questo file non c\'è nessuna playlist di iTunes.')
    name = list.name
    ;({ trackIds, missing } = matchItunes(library, list.tracks))
    total = list.tracks.length
  } else {
    const references = parseM3u(text)
    ;({ trackIds, missing } = matchM3u(library, references))
    total = references.length
  }
  if (!trackIds.length) return toast('Nessun brano di questo file è stato trovato nella libreria.')

  const id = await createPlaylistFlow(name)
  if (id === null) return
  try {
    await addToPlaylist(id, trackIds)
    toast(`Importati ${trackIds.length} brani su ${total}.${missingText(missing)}`)
    navigate({ name: 'playlist', id })
  } catch (error) {
    toast(errorText(error))
  }
}

/** Il testo di un file che sta nella cartella della musica (sul Mac da rclone, nell'app dal lato nativo). */
async function readMusicFile(file: RawMeta): Promise<string> {
  if (isNativeApp) return new TextDecoder().decode(await nativeGetBytes(await fileLink(file.fileid!, true), 60_000))
  if (await localSourceUp()) {
    const response = await fetch(`${LOCAL_SOURCE}/${encodeURIComponent(file.name)}`)
    if (!response.ok) throw new Error(`Il file non si legge (${response.status}).`)
    return response.text()
  }
  // Altrove pCloud di solito non dà il link a una pagina web (sì nella modalità finta di sviluppo).
  try {
    const response = await fetch(await fileLink(file.fileid!, true))
    if (response.ok) return await response.text()
  } catch {
    // Si spiega sotto perché non si può.
  }
  throw new Error(await whyNoFiles())
}

/** Menu "Importa": i file di playlist nella cartella della musica, poi "da un file". */
export async function openImportMenu(fromDevice: () => void) {
  const library = libraryStore.get().library
  let files: RawMeta[] = []
  if (library) {
    try {
      files = ((await listFolder(library.rootId)).contents ?? []).filter((entry) => !entry.isfolder && PLAYLIST_FILE.test(entry.name))
    } catch {
      // Senza rete resta l'import da un file del dispositivo.
    }
  }
  openMenu(
    'Importa una playlist',
    [
      ...files.map((file) => ({
        label: file.name,
        icon: 'list' as const,
        onSelect: async () => {
          try {
            await importPlaylistText(file.name, await readMusicFile(file))
          } catch (error) {
            toast(errorText(error))
          }
        },
      })),
      { label: isNativeApp ? 'Da un file del telefono…' : 'Da un file del Mac…', icon: 'upload', onSelect: fromDevice },
    ],
    files.length ? 'Playlist di iTunes (.xml) o .m3u, dalla cartella della musica su pCloud' : 'Playlist di iTunes (.xml) o .m3u',
  )
}
