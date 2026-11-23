// "Importa" nella pagina Playlist: un .m3u o una playlist esportata da iTunes (.xml), scelta tra i
// file che stanno nella cartella della musica su pCloud o da un file del dispositivo.

import { matchItunes, parseItunes, type ItunesPlaylist } from '../lib/itunes'
import { libraryStore } from '../lib/library'
import { matchM3u, parseM3u } from '../lib/m3u'
import { isNativeApp } from '../lib/native'
import { deleteFile, listFolder, type RawMeta } from '../lib/pcloud'
import { readMusicFile } from '../lib/textFile'
import { addToPlaylist, createPlaylist, playlistsStore, refreshPlaylists } from '../lib/playlists'
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

/**
 * Playlist preparate fuori dall'app (per esempio da una libreria di iTunes) da creare da sole: un file
 * `musicx-import.json` nella cartella della musica, `{ "playlists": [{ "name": "...", "files": [fileid, ...] }] }`.
 * All'avvio l'app lo legge, lo mette nel cestino (così un altro dispositivo non le crea due volte) e crea le
 * playlist che non ci sono già.
 */
export const IMPORT_JOB_FILE = 'musicx-import.json'

interface ImportJob {
  playlists?: { name?: unknown; files?: unknown }[]
}

export async function runImportJob() {
  const library = libraryStore.get().library
  if (!library) return
  let job: RawMeta | undefined
  let data: ImportJob
  try {
    job = (await listFolder(library.rootId)).contents?.find((entry) => !entry.isfolder && entry.name === IMPORT_JOB_FILE)
    if (!job?.fileid) return
    data = JSON.parse(await readMusicFile(job)) as ImportJob
    await deleteFile(job.fileid)
  } catch {
    // Senza rete, file illeggibile o già preso da un altro dispositivo: si riprova al prossimo avvio.
    return
  }
  try {
    await refreshPlaylists()
    const existing = new Set(playlistsStore.get().lists.map((list) => list.name))
    let made = 0
    for (const list of data.playlists ?? []) {
      const name = typeof list.name === 'string' ? list.name.trim() : ''
      const files = Array.isArray(list.files) ? list.files.filter((id): id is number => typeof id === 'number' && library.tracks.has(id)) : []
      if (!name || !files.length || existing.has(name)) continue
      const id = await createPlaylist(name)
      await addToPlaylist(id, files)
      existing.add(name)
      made += 1
    }
    if (made) toast(made === 1 ? 'Creata 1 playlist importata.' : `Create ${made} playlist importate.`)
  } catch (error) {
    toast(errorText(error))
  }
}
