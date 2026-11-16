// Da dove arriva l'audio. pCloud non dà i link ai file alle app web: getfilelink, getaudiolink e
// simili rispondono "Invalid link referer" a chiunque non sia pcloud.com, anche senza Referer.
// Sul Mac i brani passano quindi da rclone, che serve la cartella della musica su LOCAL_SOURCE.
// La prima volta Chrome chiede il permesso di parlare con i servizi di questo computer.

import { LOCAL_SOURCE } from '../config'
import { extensionOf, libraryStore, type Library } from './library'
import { isAndroidBrowser } from './native'
import { PCloudError } from './pcloud'
import type { QItem } from './queue'

/** rclone c'è solo sul Mac: altrove non si chiede nemmeno il permesso. */
let enabled =
  typeof navigator !== 'undefined' && /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints < 2

/** La modalità finta di sviluppo lo spegne: i suoi brani non esistono su rclone. */
export function setLocalSourceEnabled(next: boolean) {
  enabled = next
  status = null
}

/** Il percorso del brano dentro la cartella della musica, già pronto per un URL. */
export function trackPath(library: Library, trackId: number): string | null {
  const track = library.tracks.get(trackId)
  if (!track) return null
  const parts = [track.name]
  let folder = library.folders.get(track.parent)
  while (folder && folder.id !== library.rootId) {
    parts.unshift(folder.name)
    folder = library.folders.get(folder.parent)
  }
  return folder ? parts.map(encodeURIComponent).join('/') : null
}

type Access = PermissionState | 'unknown'

/** Il permesso di Chrome per i servizi di questo computer (il nome è cambiato tra una versione e l'altra). */
async function access(): Promise<Access> {
  for (const name of ['loopback-network', 'local-network-access']) {
    try {
      return (await navigator.permissions.query({ name: name as PermissionName })).state
    } catch {
      // Nome sconosciuto a questo Chrome: si prova il successivo.
    }
  }
  return 'unknown'
}

const RECHECK_MS = 30_000
let status: { up: boolean; at: number } | null = null
let checking: Promise<boolean> | null = null

async function probe(): Promise<boolean> {
  // Se Chrome sta chiedendo il permesso, la richiesta resta sospesa finché non si risponde.
  const asking = (await access()) === 'prompt'
  try {
    await fetch(`${LOCAL_SOURCE}/`, {
      method: 'HEAD',
      mode: 'no-cors',
      cache: 'no-store',
      signal: AbortSignal.timeout(asking ? 120_000 : 4_000),
    })
    return true
  } catch {
    return false
  }
}

/** true se rclone risponde. Un "sì" vale finché un brano non fallisce, un "no" per 30 secondi. */
export async function localSourceUp(): Promise<boolean> {
  if (!enabled) return false
  if (status && (status.up || Date.now() - status.at < RECHECK_MS)) return status.up
  checking ??= probe().then((up) => {
    status = { up, at: Date.now() }
    checking = null
    return up
  })
  return checking
}

/** Un brano da rclone non è partito: alla prossima richiesta si ricontrolla se rclone c'è. */
export function forgetLocalSource() {
  status = null
}

export const isLocalUrl = (url: string) => url.startsWith(`${LOCAL_SOURCE}/`)

/** L'indirizzo del brano su rclone, o null se rclone non c'è o il brano non è nella libreria. */
export async function localUrl(trackId: number): Promise<string | null> {
  const library = libraryStore.get().library
  const path = library && trackPath(library, trackId)
  return path && (await localSourceUp()) ? `${LOCAL_SOURCE}/${path}` : null
}

/** pCloud ha rifiutato il link perché la richiesta viene da una pagina web. */
export const isRefererError = (error: unknown) =>
  error instanceof PCloudError && (error.code === 7010 || /referer/i.test(error.message))

/**
 * Perché il brano non si può suonare, detto semplice. `fatal` vuol dire che non partirà
 * nessun brano (inutile passare al successivo).
 */
export async function whyNotPlayable(item: QItem, needsTranscode: boolean): Promise<{ message: string; fatal: boolean }> {
  if (needsTranscode) {
    return {
      message: `Chrome non suona i file .${extensionOf(item.file)} e pCloud li converte solo per le sue app.`,
      fatal: false,
    }
  }
  if (isAndroidBrowser) {
    return {
      message: 'In Chrome pCloud non lascia suonare i brani: sul telefono usa l\'app musicx per Android.',
      fatal: true,
    }
  }
  if (!enabled) {
    return { message: 'pCloud non ha dato il brano a musicx ("Invalid link referer").', fatal: true }
  }
  if ((await access()) === 'denied') {
    return {
      message: 'Chrome non lascia parlare musicx con rclone: riattiva il permesso "rete locale" nelle impostazioni del sito.',
      fatal: true,
    }
  }
  if (!(await localSourceUp())) {
    return { message: 'Sul Mac i brani passano da rclone, che ora non risponde.', fatal: true }
  }
  return { message: `"${item.title}" non si trova su rclone: prova "Aggiorna la libreria".`, fatal: false }
}
