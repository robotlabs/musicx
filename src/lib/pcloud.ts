// Client dell'API pCloud (https://docs.pcloud.com). Tutto passa da `call`, così il trasporto
// si può sostituire con quello finto usato in sviluppo e nei test.

import { authStore, expireAuth } from './auth'

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
export type Transport = (method: string, params: Params, timeoutMs: number) => Promise<unknown>

/** Codici con cui pCloud dice che il token non vale più. */
const AUTH_ERRORS = new Set([1000, 2000, 2094, 2095])

const httpTransport: Transport = async (method, params, timeoutMs) => {
  const auth = authStore.get().auth
  if (!auth) throw new PCloudError(1000, 'Accesso richiesto.')

  const query = new URLSearchParams()
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined) query.set(name, String(value))
  }
  // Il token va nei parametri e non in un header: l'API non ammette header extra via CORS.
  query.set(auth.kind === 'session' ? 'auth' : 'access_token', auth.token)

  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), timeoutMs)
  try {
    const response = await fetch(`https://${auth.host}/${method}?${query}`, {
      signal: abort.signal,
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    })
    if (!response.ok) throw new PCloudError(response.status, `pCloud ha risposto ${response.status}.`)
    const data = (await response.json()) as { result: number; error?: string }
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

export async function call<T>(method: string, params: Params = {}, timeoutMs = 30_000): Promise<T> {
  try {
    return (await transport(method, params, timeoutMs)) as T
  } catch (error) {
    if (error instanceof PCloudError && AUTH_ERRORS.has(error.code)) expireAuth()
    throw error
  }
}

/** Metadati di file e cartelle come li manda pCloud (solo i campi che usiamo). */
export interface RawMeta {
  name: string
  isfolder: boolean
  folderid?: number
  fileid?: number
  parentfolderid?: number
  contents?: RawMeta[]
  artist?: string
  album?: string
  title?: string
  /** Solo dentro una playlist: posizione (da 1). */
  position?: number
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

/** L'intero albero sotto `path` in una chiamata sola (può metterci un po'). */
export async function listTree(path: string): Promise<RawMeta> {
  const data = await call<{ metadata: RawMeta }>('listfolder', { path, recursive: 1, noshares: 1 }, 300_000)
  return data.metadata
}

/** Link al file originale. Vale qualche ora e solo dall'indirizzo IP che l'ha chiesto. */
export async function fileLink(fileid: number): Promise<string> {
  return linkUrl(await call<LinkResponse>('getfilelink', { fileid }))
}

/** Link allo stesso brano transcodificato in mp3 da pCloud (per i formati che il browser non suona). */
export async function audioLink(fileid: number, kbps = 256): Promise<string> {
  return linkUrl(await call<LinkResponse>('getaudiolink', { fileid, abitrate: kbps }))
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
