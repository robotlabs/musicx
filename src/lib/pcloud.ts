// Client dell'API pCloud (https://docs.pcloud.com). Tutto passa da `call`, così il trasporto
// si può sostituire con quello finto usato in sviluppo e nei test.

import { authStore, expireAuth } from './auth'
import { isNativeApp, nativeGetJson } from './native'

export class PCloudError extends Error {
  constructor(
    public code: number,
    message: string,
  ) {
    super(message)
    this.name = 'PCloudError'
  }
}

export type Params = Record<string, string | number | undefined>
/** Un file da caricare (solo per `uploadfile`). */
export interface Upload {
  name: string
  data: Blob
}
export type Transport = (method: string, params: Params, timeoutMs: number, upload?: Upload) => Promise<unknown>

/** Codici con cui pCloud dice che il token non vale più. */
const AUTH_ERRORS = new Set([1000, 2000, 2094, 2095])

/** Metodi che pCloud rifiuta alle pagine web ("Referrer is restricted to pcloud.com"). */
const LINK_METHODS = new Set(['getfilelink', 'getaudiolink'])

const httpTransport: Transport = async (method, params, timeoutMs, upload) => {
  const auth = authStore.get().auth
  if (!auth) throw new PCloudError(1000, 'Accesso richiesto.')

  const query = new URLSearchParams()
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined) query.set(name, String(value))
  }
  // Il token va nei parametri e non in un header: l'API non ammette header extra via CORS.
  query.set(auth.kind === 'session' ? 'auth' : 'access_token', auth.token)

  const url = `https://${auth.host}/${method}?${query}`
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), timeoutMs)
  try {
    let reply: { status: number; data: { result: number; error?: string } }
    if (isNativeApp && LINK_METHODS.has(method)) {
      // Nell'app Android i link ai brani si chiedono dal lato nativo: alla pagina pCloud li rifiuta.
      reply = (await nativeGetJson(url, timeoutMs)) as typeof reply
    } else {
      const body = upload && new FormData()
      body?.append('file', upload!.data, upload!.name)
      const response = await fetch(url, {
        method: body ? 'POST' : 'GET',
        body,
        signal: abort.signal,
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      })
      reply = { status: response.status, data: response.ok ? await response.json() : { result: 0 } }
    }
    const { status, data } = reply
    if (status < 200 || status > 299) throw new PCloudError(status, `pCloud ha risposto ${status}.`)
    if (data.result !== 0) throw new PCloudError(data.result, data.error ?? `Errore pCloud ${data.result}.`)
    return data
  } catch (error) {
    if (error instanceof PCloudError) throw error
    if (abort.signal.aborted) throw new PCloudError(-2, 'pCloud non risponde (tempo scaduto).')
    throw new PCloudError(-1, 'Rete non raggiungibile.')
  } finally {
    clearTimeout(timer)
  }
}

let transport = httpTransport

export function setTransport(next: Transport) {
  transport = next
}

export async function call<T>(method: string, params: Params = {}, timeoutMs = 30_000, upload?: Upload): Promise<T> {
  try {
    return (await transport(method, params, timeoutMs, upload)) as T
  } catch (error) {
    if (error instanceof PCloudError && AUTH_ERRORS.has(error.code)) expireAuth()
    throw error
  }
}

/** Metadati di file e cartelle come li manda pCloud (solo i campi che usiamo). */
export interface RawMeta {
  /** Data di creazione (RFC 2822), come la dà pCloud. */
  created?: string
  name: string
  isfolder: boolean
  folderid?: number
  fileid?: number
  parentfolderid?: number
  contents?: RawMeta[]
  artist?: string
  album?: string
  title?: string
  /** Numero di traccia letto dal tag (pCloud lo manda come numero o come testo). */
  trackno?: number | string
  /** Solo dentro una playlist: posizione (da 1). */
  position?: number
  /** Impronta del contenuto (64 bit: in JavaScript arriva arrotondata, basta per trovare i doppioni). */
  hash?: number
  size?: number
}

/** Un cambiamento nell'account, come lo racconta `diff`. */
export interface DiffEntry {
  event: string
  diffid: number
  metadata?: RawMeta
}

export interface RawCollection {
  id: number
  name: string
  items: number
  system: boolean
  contents?: RawMeta[]
}

interface LinkResponse {
  hosts: string[]
  path: string
  /** Solo dal trasporto finto di sviluppo: un URL già pronto. */
  url?: string
}

const linkUrl = (link: LinkResponse) => link.url ?? `https://${link.hosts[0]}${link.path}`

/** Il numero dell'ultimo cambiamento nell'account: da lì `diffSince` racconta i successivi. */
export async function latestDiffId(): Promise<number> {
  return (await call<{ diffid: number }>('diff', { last: 0 })).diffid
}

/**
 * I cambiamenti dopo `diffid`. Con `block` la richiesta resta aperta finché ne arriva uno
 * (o scade `timeoutMs`): è così che la libreria si aggiorna da sola.
 */
export async function diffSince(diffid: number, block: boolean, timeoutMs: number) {
  return call<{ diffid: number; entries: DiffEntry[] }>('diff', { diffid, block: block ? 1 : undefined, limit: 2000 }, timeoutMs)
}

/** Sposta il file nel cestino di pCloud (da lì si può recuperare). */
export async function deleteFile(fileid: number): Promise<RawMeta> {
  return (await call<{ metadata: RawMeta }>('deletefile', { fileid })).metadata
}

/** L'intero albero sotto `path` in una chiamata sola (può metterci un po'). */
export async function listTree(path: string): Promise<RawMeta> {
  const data = await call<{ metadata: RawMeta }>('listfolder', { path, recursive: 1, noshares: 1 }, 300_000)
  return data.metadata
}

/**
 * Link al file originale. Vale qualche ora e solo dall'indirizzo IP che l'ha chiesto.
 * `download` lo chiede per scaricarlo (riscriverne i tag) invece che per ascoltarlo.
 */
export async function fileLink(fileid: number, download = false): Promise<string> {
  return linkUrl(await call<LinkResponse>('getfilelink', { fileid, forcedownload: download ? 1 : undefined }))
}

/** Link allo stesso brano transcodificato in mp3 da pCloud (per i formati che il browser non suona). */
export async function audioLink(fileid: number, kbps = 256): Promise<string> {
  return linkUrl(await call<LinkResponse>('getaudiolink', { fileid, abitrate: kbps }))
}

/**
 * Carica un file nella cartella. Se ce n'è già uno con lo stesso nome lo sostituisce tenendo lo
 * stesso fileid (quindi resta nelle playlist) e pCloud conserva la versione vecchia tra le revisioni.
 * pCloud rilegge subito i tag: i metadati restituiti hanno già titolo, artista e album nuovi.
 */
export async function uploadFile(folderid: number, name: string, data: Uint8Array, type = 'audio/mpeg'): Promise<RawMeta> {
  const reply = await call<{ metadata: RawMeta[] }>('uploadfile', { folderid, nopartial: 1 }, 300_000, {
    name,
    data: new Blob([data as Uint8Array<ArrayBuffer>], { type }),
  })
  return reply.metadata[0]
}

/**
 * Rinomina un file restando nella sua cartella (stesso fileid). Attenzione: se esiste già un file
 * con quel nome pCloud lo sostituisce, quindi chi chiama deve controllare prima.
 */
export async function renameFile(fileid: number, toname: string): Promise<RawMeta> {
  return (await call<{ metadata: RawMeta }>('renamefile', { fileid, toname })).metadata
}

/** Il contenuto di una cartella (senza entrare nelle sottocartelle); con `foldersOnly` niente file. */
export async function listFolder(folderid: number, foldersOnly = false): Promise<RawMeta> {
  return (await call<{ metadata: RawMeta }>('listfolder', { folderid, nofiles: foldersOnly ? 1 : undefined, noshares: 1 })).metadata
}

/**
 * Sposta un file in un'altra cartella. È sempre lo stesso file (stesso fileid), quindi resta nelle
 * playlist. Attenzione: se là c'è già un file con quel nome pCloud lo sostituisce, quindi chi
 * chiama deve controllare prima.
 */
export async function moveFile(fileid: number, tofolderid: number): Promise<RawMeta> {
  return (await call<{ metadata: RawMeta }>('renamefile', { fileid, tofolderid })).metadata
}

/** Sposta una cartella con tutto quello che contiene (se là ce n'è già una con quel nome pCloud dice di no). */
export async function moveFolder(folderid: number, tofolderid: number): Promise<RawMeta> {
  return (await call<{ metadata: RawMeta }>('renamefolder', { folderid, tofolderid })).metadata
}

/** Manda nel cestino una cartella vuota. */
export async function deleteFolder(folderid: number): Promise<void> {
  await call('deletefolder', { folderid })
}

/** Crea una cartella; se ce n'è già una con quel nome restituisce quella. */
export async function createFolder(folderid: number, name: string): Promise<RawMeta> {
  return (await call<{ metadata: RawMeta }>('createfolderifnotexists', { folderid, name })).metadata
}

export async function accountEmail(): Promise<string> {
  return (await call<{ email: string }>('userinfo')).email
}

/** Invalida su pCloud il token di un accesso con password. Quello OAuth si revoca dalle impostazioni di pCloud. */
export async function endSession(): Promise<void> {
  if (authStore.get().auth?.kind !== 'session') return
  await call('logout', {}, 5_000).catch(() => {})
}

// --- Playlist: sono le "collection" native di pCloud, le stesse dell'app ufficiale. ---

/** La documentazione mostra `collection` a volte come oggetto e a volte come lista di uno. */
const single = (value: RawCollection | RawCollection[]) => (Array.isArray(value) ? value[0] : value)

type CollectionResponse = { collection: RawCollection | RawCollection[] }

export interface LinkResult {
  result: number
  fileid: number | string
}

export const collections = {
  async list(): Promise<RawCollection[]> {
    return (await call<{ collections: RawCollection[] }>('collection_list', { type: 1 })).collections
  },
  async details(id: number): Promise<RawCollection> {
    return single((await call<CollectionResponse>('collection_details', { collectionid: id }, 60_000)).collection)
  },
  async create(name: string): Promise<RawCollection> {
    return single((await call<CollectionResponse>('collection_create', { name, type: 1 })).collection)
  },
  async rename(id: number, name: string): Promise<void> {
    await call('collection_rename', { collectionid: id, name })
  },
  async remove(id: number): Promise<void> {
    await call('collection_delete', { collectionid: id })
  },
  /** Aggiunge in coda; pCloud non ammette doppioni nella stessa playlist. */
  async link(id: number, fileIds: number[]): Promise<LinkResult[]> {
    const data = await call<{ linkresult?: LinkResult[] | false }>(
      'collection_linkfiles',
      { collectionid: id, fileids: fileIds.join(',') },
      60_000,
    )
    return data.linkresult || []
  },
  /** Per id del file: dentro una playlist è univoco, quindi non dipende dalle posizioni. */
  async unlink(id: number, fileId: number): Promise<void> {
    await call('collection_unlinkfiles', { collectionid: id, fileids: fileId })
  },
  async move(id: number, fileId: number, from: number, to: number): Promise<void> {
    await call('collection_move', { collectionid: id, item: from, fileid: fileId, position: to })
  },
}
