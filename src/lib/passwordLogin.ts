// Accesso con email e password, direttamente all'API di pCloud: non richiede un'app pCloud
// approvata. La password va solo a pCloud (POST su HTTPS) e non viene salvata; sul dispositivo
// resta il token di sessione, che "Esci da pCloud" invalida.
//
// Il primo passo è documentato (`userinfo` con `getauth`). I passi extra (codice 2FA, codice via
// email per confermare un dispositivo nuovo) non lo sono: seguono il sito di pCloud, come fa
// github.com/StarHack/go-pcloud (pcloud/login.go). Se pCloud li cambia, il messaggio di errore
// arriva comunque a schermo.

import { saveAuth } from './auth'

/** Prima il server USA, poi quello europeo: un account vive su uno solo dei due. */
const HOSTS = ['api.pcloud.com', 'eapi.pcloud.com']
const HOST_KEY = 'musicx.login-host'
const DEVICE_KEY = 'musicx.device-id'
const ONE_YEAR = 365 * 24 * 60 * 60

/** Codici di pCloud usati qui. */
const LOGIN_FAILED = 2000
const TOO_MANY_TRIES = 4000
const TFA_REQUIRED = 2297
const EMAIL_CODE_REQUIRED = new Set([1022, 2306, 2360])
const SMS = 1

export type Challenge =
  | { kind: 'tfa'; host: string; token: string; sms: boolean }
  | { kind: 'email'; host: string }

export type LoginStep = { done: true } | { done: false; challenge: Challenge }

export class LoginError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LoginError'
  }
}

interface Reply {
  result: number
  error?: string
  auth?: string
  token?: string
  tfatype?: number
  verifytoken?: string
}

type LoginParams = Record<string, string | number>
export type LoginTransport = (host: string, method: string, params: LoginParams) => Promise<Reply>

const httpPost: LoginTransport = async (host, method, params) => {
  const body = new URLSearchParams()
  for (const [name, value] of Object.entries(params)) body.set(name, String(value))
  let response: Response
  try {
    response = await fetch(`https://${host}/${method}`, {
      method: 'POST',
      body,
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    })
  } catch {
    throw new LoginError('Rete non raggiungibile.')
  }
  if (!response.ok) throw new LoginError(`pCloud ha risposto ${response.status}.`)
  return (await response.json()) as Reply
}

let post = httpPost

/** Solo per la modalità finta di sviluppo. */
export function setLoginTransport(next: LoginTransport) {
  post = next
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Senza storage si accede lo stesso: si perde solo il "dispositivo fidato".
  }
}

/** Identificativo stabile di questo browser, così pCloud lo riconosce come dispositivo fidato. */
function deviceId(): string {
  let id = read(DEVICE_KEY)
  if (!id) {
    id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')
    write(DEVICE_KEY, id)
  }
  return id
}

/** Il nome con cui la sessione compare tra i dispositivi nelle impostazioni di pCloud. */
function deviceName(): string {
  const agent = navigator.userAgent
  return `musicx (${/Android/i.test(agent) ? 'Android' : /Mac/i.test(agent) ? 'Mac' : 'browser'})`
}

const device = () => ({ device: deviceName(), deviceid: deviceId(), getauth: 1, authexpire: ONE_YEAR })

const credentials = (email: string, password: string) => ({ username: email, password, logout: 1, ...device() })

function failure(reply: Reply | null): LoginError {
  if (!reply) return new LoginError('Accesso non riuscito.')
  if (reply.result === LOGIN_FAILED) return new LoginError('Email o password non corrette.')
  if (reply.result === TOO_MANY_TRIES) return new LoginError('Troppi tentativi da questa rete: riprova tra un po\'.')
  return new LoginError(`${reply.error ?? 'Accesso non riuscito.'} (pCloud ${reply.result})`)
}

function finish(host: string, token: string): LoginStep {
  write(HOST_KEY, host)
  saveAuth({ token, host, kind: 'session' })
  return { done: true }
}

/** Interpreta la risposta di un tentativo: fatto, serve un codice, oppure niente da fare qui. */
async function next(host: string, email: string, reply: Reply): Promise<LoginStep | null> {
  if (reply.result === 0 && reply.auth) return finish(host, reply.auth)
  if (reply.result === TFA_REQUIRED && reply.token) {
    const sms = reply.tfatype === SMS
    if (sms) {
      const sent = await post(host, 'tfa_sendcodeviasms', { token: reply.token })
      if (sent.result !== 0) throw failure(sent)
    }
    return { done: false, challenge: { kind: 'tfa', host, token: reply.token, sms } }
  }
  if (EMAIL_CODE_REQUIRED.has(reply.result)) {
    const sent = reply.verifytoken
      ? await post(host, 'sendverificationemail', { verifytoken: reply.verifytoken })
      : await post(host, 'user/sendemailtfamail', { email, language: 'it', os: 4 })
    if (sent.result !== 0 && sent.result !== 2360) throw failure(sent)
    return { done: false, challenge: { kind: 'email', host } }
  }
  return null
}

export async function passwordLogin(email: string, password: string): Promise<LoginStep> {
  const remembered = read(HOST_KEY)
  const hosts = remembered && HOSTS.includes(remembered) ? [remembered, ...HOSTS.filter((h) => h !== remembered)] : HOSTS
  let last: Reply | null = null
  for (const host of hosts) {
    last = await post(host, 'userinfo', credentials(email, password))
    const step = await next(host, email, last)
    if (step) return step
    // "Accesso fallito" può voler dire anche che l'account sta sull'altro server: si prova lì.
    if (last.result !== LOGIN_FAILED) break
  }
  throw failure(last)
}

/** Secondo passo, con il codice ricevuto (app di autenticazione, SMS o email). */
export async function completeLogin(challenge: Challenge, code: string, email: string, password: string): Promise<LoginStep> {
  const { host } = challenge
  const reply =
    challenge.kind === 'tfa'
      ? await post(host, 'tfa_login', { token: challenge.token, code, trustdevice: 1, ...device() })
      : await post(host, 'login', {
          ...credentials(email, password),
          emailtfacode: code,
          code,
          trusted: 1,
          trustdevice: 1,
          language: 'it',
          os: 4,
          osversion: '0.0.0',
        })
  if (reply.result === 0 && reply.auth) return finish(host, reply.auth)
  // Dopo il codice email può ancora servire quello 2FA.
  if (reply.result === TFA_REQUIRED) {
    const step = await next(host, email, reply)
    if (step) return step
  }
  // Se pCloud chiede di nuovo il codice, quello scritto non andava: niente nuova email.
  if (EMAIL_CODE_REQUIRED.has(reply.result)) throw new LoginError('pCloud non ha accettato il codice: controlla l\'ultima email e riprova.')
  if (challenge.kind === 'tfa' && reply.result !== TOO_MANY_TRIES) {
    throw new LoginError(`Codice non valido o scaduto (pCloud ${reply.result}). Riprova, o "Annulla" per ricominciare.`)
  }
  throw failure(reply)
}
