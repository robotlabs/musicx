import { PCLOUD_CLIENT_ID } from '../config'
import { createStore } from './store'

export interface Auth {
  token: string
  /** Server API dell'account: eapi.pcloud.com (Europa) o api.pcloud.com (USA). */
  host: string
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
    return saved && typeof saved.token === 'string' && API_HOSTS.has(saved.host) ? saved : null
  } catch {
    return null
  }
}

export const authStore = createStore<AuthState>({ auth: loadAuth(), notice: null })

/** L'indirizzo a cui pCloud rimanda dopo l'accesso: va registrato identico nell'app pCloud. */
export const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, '')

export const loginConfigured = () => PCLOUD_CLIENT_ID !== ''

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
  const auth = { token, host }
  localStorage.setItem(AUTH_KEY, JSON.stringify(auth))
  authStore.set({ auth, notice: null })
}

export function clearAuth(notice: string | null = null) {
  localStorage.removeItem(AUTH_KEY)
  authStore.set({ auth: null, notice })
}

/** pCloud ha rifiutato il token (scaduto o revocato). */
export const expireAuth = () => clearAuth('La sessione pCloud è scaduta: accedi di nuovo.')

/** Solo per la modalità finta di sviluppo: sessione in memoria, mai salvata. */
export function setMemoryAuth(auth: Auth) {
  authStore.set({ auth, notice: null })
}
