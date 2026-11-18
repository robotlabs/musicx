// Nell'app Android l'interfaccia sta dentro l'APK, così si apre anche senza rete. Quando c'è rete
// controlla se sul sito ce n'è una più nuova (version.json, scritto dalla build): la scarica nei file
// dell'app e poi la usa da lì, con lo stesso meccanismo degli aggiornamenti "live" di Capacitor
// (WebView.setServerBasePath). Tutto passa dal lato nativo: dentro l'app l'indirizzo del sito è
// servito dai file locali.
//
// Lo stato sta solo nei file (localStorage nell'app può perdere le ultime scritture se l'app viene
// chiusa di forza): web/<versione>.part mentre si scarica, web/<versione> quando è completa, e dentro
// "from" con la versione da cui si partiva. Una versione si usa solo se parte da quella che gira:
// dopo un APK nuovo (che riparte dalla sua) una versione scaricata prima non torna mai indietro.

import { Capacitor, WebView } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { FileTransfer } from '@capacitor/file-transfer'
import { isNativeApp, nativeGetJson } from './native'

const SITE = 'https://robotlabs.github.io/musicx/'
const WEB_DIR = 'web'
const PART = '.part'
const FROM_FILE = 'from'
const TRIED_FILE = 'tried'
const directory = Directory.Data

/** L'app con l'interfaccia dentro l'APK (quella vecchia la carica dal sito, sotto /musicx/). */
export const bundledApp = isNativeApp && typeof location !== 'undefined' && !location.pathname.startsWith('/musicx')

const ready = () => bundledApp && Capacitor.isPluginAvailable('FileTransfer') && Capacitor.isPluginAvailable('Filesystem')

interface Manifest {
  version: string
  files: string[]
}

const dirOf = (version: string) => `${WEB_DIR}/${version}`
const lastPart = (path: string) => path.replace(/\/+$/, '').split('/').pop() ?? ''

async function versions(): Promise<string[]> {
  try {
    const { files } = await Filesystem.readdir({ directory, path: WEB_DIR })
    return files.filter((entry) => entry.type === 'directory').map((entry) => entry.name)
  } catch {
    return []
  }
}

async function readText(path: string): Promise<string | null> {
  try {
    const { data } = await Filesystem.readFile({ directory, path, encoding: Encoding.UTF8 })
    return typeof data === 'string' ? data : await data.text()
  } catch {
    return null
  }
}

const writeText = (path: string, data: string) => Filesystem.writeFile({ directory, path, data, encoding: Encoding.UTF8, recursive: true })

const removeVersion = (name: string) => Filesystem.rmdir({ directory, path: dirOf(name), recursive: true }).catch(() => {})

/** La versione scaricata pronta per chi gira ora, se c'è. */
async function readyFor(running: string): Promise<string | null> {
  for (const name of await versions()) {
    if (name.endsWith(PART) || name === running) continue
    if ((await readText(`${dirOf(name)}/${FROM_FILE}`)) === running) return name
  }
  return null
}

/** Scarica la versione del sito se è diversa da quella che gira. true se ce n'è una pronta. */
export async function downloadAppUpdate(running: string): Promise<boolean> {
  if (!ready()) return false
  if (await readyFor(running)) return true
  const { status, data } = await nativeGetJson(`${SITE}version.json?t=${Date.now()}`, 15_000)
  const manifest = data as Manifest | null
  if (status !== 200 || !manifest?.version || !Array.isArray(manifest.files) || manifest.version === running) return false
  if (!manifest.files.includes('index.html') || manifest.files.some((file) => file.includes('..'))) return false

  const part = dirOf(manifest.version + PART)
  await Filesystem.rmdir({ directory, path: part, recursive: true }).catch(() => {})
  for (const file of manifest.files) {
    const path = `${part}/${file}`
    await Filesystem.mkdir({ directory, path: path.slice(0, path.lastIndexOf('/')), recursive: true }).catch(() => {})
    const { uri } = await Filesystem.getUri({ directory, path })
    await FileTransfer.downloadFile({ url: SITE + file, path: uri, connectTimeout: 20_000, readTimeout: 30_000 })
  }
  await writeText(`${part}/${FROM_FILE}`, running)
  await removeVersion(manifest.version)
  await Filesystem.rename({ directory, toDirectory: directory, from: part, to: dirOf(manifest.version) })
  return true
}

async function switchTo(version: string) {
  const { uri } = await Filesystem.getUri({ directory, path: dirOf(version) })
  await WebView.setServerBasePath({ path: decodeURI(uri.replace(/^file:\/\//, '')).replace(/\/+$/, '') })
}

/** "Aggiorna": passa alla versione scaricata, la pagina si ricarica da lì. */
export async function applyAppUpdate(running: string | null) {
  const version = running && ready() ? await readyFor(running) : null
  if (version) await switchTo(version)
  else location.reload()
}

/**
 * All'avvio dell'app. Se gira da una versione scaricata la rende quella di partenza anche ai prossimi
 * avvii e butta le altre. Se ce n'è una scaricata pronta, ci passa subito (non suona ancora niente):
 * in quel caso restituisce true e la pagina si sta ricaricando. Se quella versione era già stata
 * provata e non è partita, la butta invece di riprovare all'infinito.
 */
export async function startAppUpdates(running: string | null): Promise<boolean> {
  if (!ready() || !running) return false
  try {
    const next = await readyFor(running)
    if (next) {
      const tried = `${dirOf(next)}/${TRIED_FILE}`
      if ((await readText(tried)) === null) {
        await writeText(tried, running)
        await switchTo(next)
        return true
      }
      await removeVersion(next)
    }
    const { path } = await WebView.getServerBasePath()
    const current = path.includes(`/${WEB_DIR}/`) ? lastPart(path) : null
    if (current) await WebView.persistServerBasePath()
    for (const name of await versions()) if (name !== current) await removeVersion(name)
  } catch {
    // Un aggiornamento mancato non deve impedire di aprire l'app.
  }
  return false
}
