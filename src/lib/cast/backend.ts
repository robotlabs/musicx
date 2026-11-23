// Come la pagina arriva alle casse. Una pagina https non può parlare in http con la rete di casa né
// cercarci le casse, quindi passa da qualcuno che può:
//  - sul Mac il servizio locale di musicx (helper/cast.mjs), lo stesso di "Da YouTube";
//  - nell'app Android il lato nativo: CapacitorHttp per le richieste, il plugin MusicCast
//    (android/.../MusicCastPlugin.java) per cercare le casse e trovare l'IP dei server di pCloud.
// Tutto il resto (SOAP, MusicCast, coda) è uguale per i due e sta negli altri file di questa cartella.

import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core'
import { authStore } from '../auth'
import { isNativeApp } from '../native'
import { audioLink, fileLink } from '../pcloud'
import { findHelper, helperBase, youtubeHere } from '../youtube'

/** Una cassa vista in rete: `location` è la sua descrizione UPnP, se si conosce. */
export interface Candidate {
  ip: string
  location: string | null
}

export interface HttpRequest {
  method?: 'GET' | 'POST'
  url: string
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
}

export interface HttpReply {
  status: number
  text: string
}

export interface CastBackend {
  /** Perché qui non si può trasmettere (con cosa fare), o null se si può. */
  problem(): Promise<string | null>
  discover(): Promise<Candidate[]>
  http(request: HttpRequest): Promise<HttpReply>
  /** Il link pCloud del brano nella forma che la cassa suona: http://<IP del server>/… */
  link(fileid: number, transcode: boolean): Promise<string>
}

// --- Mac ---

async function askHelper<T>(path: string, body?: unknown): Promise<T> {
  const base = await helperBase()
  if (!base) throw new Error('Il servizio di musicx sul Mac non risponde.')
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = (await response.json()) as T & { error?: string }
  if (!response.ok) throw new Error(data.error ?? `Il servizio ha risposto ${response.status}.`)
  return data
}

const macBackend: CastBackend = {
  async problem() {
    const helper = await findHelper()
    if (!helper) return 'Il servizio di musicx sul Mac non risponde. Si installa dal Terminale con ./helper/install.sh'
    if (!helper.cast)
      return 'Il servizio di musicx sul Mac è di una versione vecchia. Si aggiorna dal Terminale con ./helper/install.sh'
    return null
  },
  async discover() {
    return (await askHelper<{ devices: Candidate[] }>('/cast/discover')).devices
  },
  http: (request) => askHelper<HttpReply>('/cast/http', request),
  async link(fileid, transcode) {
    const auth = authStore.get().auth
    if (!auth) throw new Error('Accesso a pCloud richiesto.')
    return (await askHelper<{ url: string }>('/cast/link', { ...auth, fileid, transcode })).url
  },
}

// --- Android ---

interface MusicCastPlugin {
  discover(options: { timeoutMs: number }): Promise<{ devices: Candidate[] }>
  resolve(options: { host: string }): Promise<{ ip: string }>
}

const NativeCast = registerPlugin<MusicCastPlugin>('MusicCast')

const androidBackend: CastBackend = {
  async problem() {
    if (!Capacitor.isPluginAvailable('MusicCast')) return "Per trasmettere serve la versione nuova dell'app."
    return null
  },
  async discover() {
    return (await NativeCast.discover({ timeoutMs: 2500 })).devices
  },
  async http({ method = 'GET', url, headers = {}, body, timeoutMs = 8000 }) {
    const response = await CapacitorHttp.request({
      method,
      url,
      // Le casse chiudono la connessione dopo ogni risposta: niente riuso.
      headers: { ...headers, Connection: 'close' },
      data: body,
      responseType: 'text',
      connectTimeout: timeoutMs,
      readTimeout: timeoutMs,
    })
    return { status: response.status, text: typeof response.data === 'string' ? response.data : JSON.stringify(response.data) }
  },
  async link(fileid, transcode) {
    // Il link lo chiede il telefono (lato nativo), quindi vale per l'IP pubblico di casa, lo stesso delle casse.
    const url = new URL(transcode ? await audioLink(fileid, 320) : await fileLink(fileid))
    const { ip } = await NativeCast.resolve({ host: url.hostname })
    return `http://${ip}${url.pathname}${url.search}`
  },
}

// --- Scelta ---

let override: CastBackend | null = null

/** Solo per lo sviluppo e i test: casse finte. */
export function setCastBackend(next: CastBackend | null) {
  override = next
}

/** Nell'app Android installata manca il pezzo nativo per le casse: serve l'APK nuovo. */
export const needsNewApp = () => !override && isNativeApp && !Capacitor.isPluginAvailable('MusicCast')

/** Il modo di arrivare alle casse da qui, o null dove non si può (Chrome sul telefono, iPhone). */
export function castBackend(): CastBackend | null {
  if (override) return override
  if (isNativeApp) return androidBackend
  if (youtubeHere()) return macBackend
  return null
}
