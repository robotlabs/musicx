// Nell'app Android l'interfaccia sta dentro l'APK, così si apre anche senza rete. Quando c'è rete
// controlla se sul sito ce n'è una più nuova (version.json, scritto dalla build): la scarica nei file
// dell'app e poi la usa da lì, con lo stesso meccanismo degli aggiornamenti "live" di Capacitor
// (WebView.setServerBasePath). Un APK nuovo riparte sempre dalla versione che ha dentro.
//
// Tutto passa dal lato nativo: dentro l'app l'indirizzo del sito è servito dai file locali.

import { Capacitor, WebView } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { FileTransfer } from '@capacitor/file-transfer'
import { isNativeApp, nativeGetJson } from './native'

const SITE = 'https://robotlabs.github.io/musicx/'
const PENDING_KEY = 'musicx.web-pending'
/** La versione a cui si è già provato a passare all'avvio: se non è servito, non si riprova all'infinito. */
const TRIED_KEY = 'musicx.web-tried'
const WEB_DIR = 'web'

/** L'app con l'interfaccia dentro l'APK (quella vecchia la carica dal sito, sotto /musicx/). */
export const bundledApp = isNativeApp && typeof location !== 'undefined' && !location.pathname.startsWith('/musicx')

const ready = () => bundledApp && Capacitor.isPluginAvailable('FileTransfer') && Capacitor.isPluginAvailable('Filesystem')

interface Manifest {
  version: string
  files: string[]
}

const dirOf = (version: string) => `${WEB_DIR}/${version}`

/** Scarica la versione del sito se è diversa da quella che gira. true se ce n'è una pronta. */
export async function downloadAppUpdate(running: string): Promise<boolean> {
  if (!ready()) return false
  const { status, data } = await nativeGetJson(`${SITE}version.json?t=${Date.now()}`, 15_000)
  const manifest = data as Manifest | null
  if (status !== 200 || !manifest?.version || !Array.isArray(manifest.files)) return false
  if (manifest.version === running) return false
  if (localStorage.getItem(PENDING_KEY) === manifest.version) return true
  if (!manifest.files.includes('index.html') || manifest.files.some((file) => file.includes('..'))) return false

  const base = dirOf(manifest.version)
  for (const file of manifest.files) {
    const path = `${base}/${file}`
    await Filesystem.mkdir({ directory: Directory.Data, path: path.slice(0, path.lastIndexOf('/')), recursive: true }).catch(() => {})
    const { uri } = await Filesystem.getUri({ directory: Directory.Data, path })
    await FileTransfer.downloadFile({ url: SITE + file, path: uri, connectTimeout: 20_000, readTimeout: 30_000 })
  }
  localStorage.setItem(PENDING_KEY, manifest.version)
  return true
}

/** Passa alla versione scaricata: la pagina si ricarica da lì. */
export async function applyAppUpdate() {
  const version = localStorage.getItem(PENDING_KEY)
  if (!version || !ready()) return location.reload()
  const { uri } = await Filesystem.getUri({ directory: Directory.Data, path: dirOf(version) })
  await WebView.setServerBasePath({ path: decodeURI(uri.replace(/^file:\/\//, '')) })
}

/**
 * All'avvio dell'app. Se gira da una versione scaricata la rende quella di partenza anche ai prossimi
 * avvii e butta le vecchie. Se ce n'è una scaricata più nuova di quella che gira, ci passa subito
 * (non suona ancora niente): in quel caso restituisce true e la pagina si sta ricaricando.
 */
export async function startAppUpdates(running: string | null): Promise<boolean> {
  if (!ready() || !running) return false
  try {
    const pending = localStorage.getItem(PENDING_KEY)
    if (pending && pending !== running) {
      if (localStorage.getItem(TRIED_KEY) !== pending) {
        localStorage.setItem(TRIED_KEY, pending)
        await applyAppUpdate()
        return true
      }
      localStorage.removeItem(PENDING_KEY)
    }
    const { path } = await WebView.getServerBasePath()
    if (path.includes(`/${WEB_DIR}/`)) await WebView.persistServerBasePath()
    // Via le versioni scaricate che non servono più.
    const keep = path.includes(`/${WEB_DIR}/`) ? path.slice(path.lastIndexOf('/') + 1) : null
    const { files } = await Filesystem.readdir({ directory: Directory.Data, path: WEB_DIR }).catch(() => ({ files: [] }))
    for (const entry of files) {
      if (entry.name !== keep) await Filesystem.rmdir({ directory: Directory.Data, path: dirOf(entry.name), recursive: true }).catch(() => {})
    }
    if (pending === running) localStorage.removeItem(PENDING_KEY)
  } catch {
    // Un aggiornamento mancato non deve impedire di aprire l'app.
  }
  return false
}
