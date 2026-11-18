import { PCLOUD_CLIENT_ID, PCLOUD_REDIRECT_URI } from '../config'
import { createStore } from './store'

export interface Auth {
  token: string
  /** Server API dell'account: eapi.pcloud.com (Europa) o api.pcloud.com (USA). */
  host: string
  /**
   * Da dove viene il token: `oauth` (app pCloud approvata, parametro `access_token`)
   * o `session` (accesso con email e password, parametro `auth`).
   */
  kind: 'oauth' | 'session'
}

interface AuthState {
  auth: Auth | null
  /** Messaggio da mostrare nella schermata di accesso. */
  notice: string | null
}

const AUTH_KEY = 'musicx.auth'
const STATE_KEY = 'musicx.oauth-state'
const API_HOSTS = new Set(['api.pcloud.com', 'eapi.pcloud.com'])

function loadAuth(): Auth | null {
  try {
    const saved = JSON.parse(localStorage.getItem(AUTH_KEY) ?? 'null')
    if (!saved || typeof saved.token !== 'string' || !API_HOSTS.has(saved.host)) return null
    return { token: saved.token, host: saved.host, kind: saved.kind === 'session' ? 'session' : 'oauth' }
  } catch {
    return null
  }
}

export const authStore = createStore<AuthState>({ auth: loadAuth(), notice: null })

/** Nella modalità finta di sviluppo la sessione non si salva, per non toccare quella vera. */
let memoryOnly = false

export function saveAuth(auth: Auth) {
  if (!memoryOnly) localStorage.setItem(AUTH_KEY, JSON.stringify(auth))
  authStore.set({ auth, notice: null })
}

/** L'indirizzo a cui pCloud rimanda dopo l'accesso: va registrato identico nell'app pCloud. */
export const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, '')

export const loginConfigured = () => PCLOUD_CLIENT_ID !== '' && redirectUri() === PCLOUD_REDIRECT_URI

function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Manda alla pagina di accesso di pCloud (OAuth, flusso "token"). */
export function startLogin() {
  const state = randomState()
  localStorage.setItem(STATE_KEY, state)
  const query = new URLSearchParams({
    client_id: PCLOUD_CLIENT_ID,
    response_type: 'token',
    redirect_uri: redirectUri(),
    state,
  })
  location.assign(`https://my.pcloud.com/oauth2/authorize?${query}`)
}

/** Il server API dell'account secondo pCloud (1 = USA, 2 = Europa). */
const hostOf = (locationid: unknown) => (Number(locationid) === 2 ? 'eapi.pcloud.com' : 'api.pcloud.com')

/** Una richiesta che aspetta il token finché l'accesso non è fatto (o pCloud chiude la connessione). */
async function waitForToken(host: string, requestId: string, signal: AbortSignal): Promise<Auth> {
  const query = new URLSearchParams({ client_id: PCLOUD_CLIENT_ID, request_id: requestId })
  const response = await fetch(`https://${host}/oauth2_token?${query}`, { signal })
  const data = (await response.json()) as { result?: number; access_token?: string; locationid?: number }
  if (data.result !== 0 || !data.access_token) throw new Error(`pCloud: ${data.result}`)
  return { token: data.access_token, host: hostOf(data.locationid), kind: 'oauth' }
}

/**
 * Nell'app Android: la pagina di accesso di pCloud si apre in Chrome (il guscio apre lì gli indirizzi
 * esterni) e l'app aspetta il token da pCloud, senza bisogno di tornare a un indirizzo registrato.
 * È il metodo "poll_token" che usa l'SDK JavaScript ufficiale di pCloud. Finisce con l'accesso
 * fatto, o con un errore se `signal` lo interrompe o passa troppo tempo.
 */
export async function appLogin(signal: AbortSignal): Promise<void> {
  const requestId = randomState() + randomState()
  const query = new URLSearchParams({ client_id: PCLOUD_CLIENT_ID, response_type: 'poll_token', request_id: requestId })
  location.assign(`https://my.pcloud.com/oauth2/authorize?${query}`)

  const deadline = Date.now() + 15 * 60_000
  while (!signal.aborted && Date.now() < deadline) {
    // Non si sa in quale regione è l'account: si aspetta su entrambi i server, vince chi risponde.
    const round = new AbortController()
    const stop = () => round.abort()
    signal.addEventListener('abort', stop)
    try {
      const auth = await Promise.any(['api.pcloud.com', 'eapi.pcloud.com'].map((host) => waitForToken(host, requestId, round.signal)))
      saveAuth(auth)
      return
    } catch {
      // Connessione chiusa (app in sottofondo, rete cambiata) o accesso non ancora fatto: si riprova.
      await new Promise((resolve) => setTimeout(resolve, 2000))
    } finally {
      round.abort()
      signal.removeEventListener('abort', stop)
    }
  }
  throw new Error(signal.aborted ? 'Accesso annullato.' : 'Tempo scaduto: riprova.')
}

/**
 * Da chiamare all'avvio: se stiamo tornando da pCloud, il token è nel frammento dell'URL.
 * Viene accettato solo se `state` è quello generato da questa app e l'host è di pCloud.
 */
export function consumeLoginRedirect() {
  if (!location.hash.includes('access_token=')) return
  const params = new URLSearchParams(location.hash.slice(1))
  history.replaceState(null, '', location.pathname + location.search)

  const expected = localStorage.getItem(STATE_KEY)
  localStorage.removeItem(STATE_KEY)
  const token = params.get('access_token')
  const host = params.get('hostname') ?? ''
  if (!token || !expected || params.get('state') !== expected || !API_HOSTS.has(host)) {
    authStore.set({ auth: null, notice: 'Accesso non riuscito, riprova.' })
    return
  }
  saveAuth({ token, host, kind: 'oauth' })
}

export function clearAuth(notice: string | null = null) {
  if (!memoryOnly) localStorage.removeItem(AUTH_KEY)
  authStore.set({ auth: null, notice })
}

/** pCloud ha rifiutato il token (scaduto o revocato). */
export const expireAuth = () => clearAuth('La sessione pCloud è scaduta: accedi di nuovo.')

/** Solo per la modalità finta di sviluppo: sessione in memoria (o nessuna), mai salvata. */
export function setMemoryAuth(auth: Auth | null) {
  memoryOnly = true
  authStore.set({ auth, notice: null })
}
