// Scarica e Rimuovi download: voci dei menu, pulsante nelle intestazioni, segno sulle righe.

import { audioStore, canSave, needsNewApp } from '../lib/audioStore'
import { downloadsStore, isFolderPinned, isPlaylistPinned, pinFolder, pinPlaylist, pinTracks, wantedTracks } from '../lib/downloads'
import { ANDROID_APP_URL } from '../lib/native'
import type { QItem } from '../lib/queue'
import { useStore } from '../lib/store'
import { Icon } from './icons'
import { confirmAction, toast, type MenuItem } from './sheets'
import { tracksLabel } from './text'

/** Con l'APK vecchio i pezzi nativi per salvare i file non ci sono: si propone quello nuovo. */
async function askForNewApp() {
  const sure = await confirmAction(
    "Serve l'app nuova",
    "Per scaricare i brani sul telefono serve la versione nuova dell'app musicx. Si installa sopra quella che hai: resti dentro.",
    "Scarica l'app",
  )
  if (sure) location.assign(ANDROID_APP_URL)
}

/** Se qui si possono offrire i download (anche solo per dire che serve l'app nuova). */
export const offersDownloads = () => canSave() || needsNewApp()

function startedText(count: number) {
  return count ? `Scarico ${tracksLabel(count)} su questo dispositivo.` : 'Niente da scaricare qui.'
}

/** "Scarica" / "Rimuovi download" per dei brani. */
export function trackDownloadItems(items: QItem[]): MenuItem[] {
  if (!items.length || !offersDownloads()) return []
  const files = audioStore.get().files
  const wanted = wantedTracks()
  if (items.every((item) => files[item.id]?.kind === 'download' || wanted.has(item.id))) {
    // Come in Spotify: un brano di una cartella o playlist scaricata si toglie togliendo quella.
    const own = items.filter((item) => wanted.get(item.id)?.sources.includes(`track-${item.id}`))
    if (!own.length) return []
    return [{ label: 'Rimuovi download', icon: 'downloaded', onSelect: () => (pinTracks(own, false), toast('Download rimosso.')) }]
  }
  return [
    {
      label: 'Scarica',
      icon: 'download',
      onSelect: () => {
        if (needsNewApp()) return void askForNewApp()
        pinTracks(items, true)
        toast(startedText(items.length))
      },
    },
  ]
}

function toggleItem(pinned: boolean, count: number, pin: (on: boolean) => void): MenuItem {
  return pinned
    ? { label: 'Rimuovi download', icon: 'downloaded', onSelect: () => (pin(false), toast('Download rimosso.')) }
    : {
        label: 'Scarica',
        icon: 'download',
        onSelect: () => {
          if (needsNewApp()) return void askForNewApp()
          pin(true)
          toast(startedText(count))
        },
      }
}

export function folderDownloadItems(folderId: number, count: number): MenuItem[] {
  if (!offersDownloads()) return []
  return [toggleItem(isFolderPinned(folderId), count, (on) => pinFolder(folderId, on))]
}

export function playlistDownloadItems(listId: number, count: number): MenuItem[] {
  if (!offersDownloads()) return []
  return [toggleItem(isPlaylistPinned(listId), count, (on) => pinPlaylist(listId, on))]
}

/** Pulsante nell'intestazione di una cartella o di una playlist, come quello di Spotify. */
export function DownloadToggle(props: { kind: 'folder' | 'playlist'; id: number; count: number }) {
  const { kind, id, count } = props
  const pinned = useStore(downloadsStore, (state) => (kind === 'folder' ? state.pins.folders : state.pins.playlists).includes(id))
  if (!offersDownloads() || count === 0) return null
  const toggle = () => {
    const pin = kind === 'folder' ? pinFolder : pinPlaylist
    toggleItem(pinned, count, (on) => pin(id, on)).onSelect()
  }
  return (
    <button
      className={`icon-button download-toggle${pinned ? ' on' : ''}`}
      aria-pressed={pinned}
      aria-label={pinned ? 'Rimuovi download' : 'Scarica'}
      title={pinned ? 'Scaricata: tocca per rimuovere il download' : 'Scarica su questo dispositivo'}
      onClick={toggle}
    >
      <Icon name={pinned ? 'downloaded' : 'download'} size={22} />
    </button>
  )
}

/** Quanti dei brani sono già sul dispositivo (scaricati), per il sottotitolo delle intestazioni. */
export function useDownloadedCount(ids: number[]): number {
  return useStore(audioStore, (state) => {
    let count = 0
    for (const id of ids) if (state.files[id]?.kind === 'download') count += 1
    return count
  })
}

/** Segno verde accanto a un brano scaricato. */
export function SavedMark() {
  return (
    <span className="saved-mark" title="Scaricato su questo dispositivo">
      <Icon name="downloaded" size={13} />
    </span>
  )
}
