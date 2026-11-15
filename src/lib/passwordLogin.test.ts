import { beforeEach, describe, expect, it } from 'vitest'
import { authStore, setMemoryAuth } from './auth'
import { completeLogin, LoginError, passwordLogin, setLoginTransport, type LoginTransport } from './passwordLogin'

type Call = { host: string; method: string; params: Record<string, string | number> }

function fakePcloud(handler: (call: Call) => { result: number; [key: string]: unknown }) {
  const calls: Call[] = []
  const transport: LoginTransport = async (host, method, params) => {
    const call = { host, method, params }
    calls.push(call)
    return handler(call) as Awaited<ReturnType<LoginTransport>>
  }
  setLoginTransport(transport)
  return calls
}

beforeEach(() => setMemoryAuth(null))

describe('passwordLogin', () => {
  it('saves a session token on success', async () => {
    const calls = fakePcloud(() => ({ result: 0, auth: 'tok' }))
    expect(await passwordLogin('me@example.com', 'pw')).toEqual({ done: true })
    expect(authStore.get().auth).toEqual({ token: 'tok', host: 'api.pcloud.com', kind: 'session' })
    expect(calls[0]).toMatchObject({ method: 'userinfo', params: { username: 'me@example.com', password: 'pw', getauth: 1 } })
  })

  it('tries the other region when the first says login failed', async () => {
    const calls = fakePcloud(({ host }) => (host === 'eapi.pcloud.com' ? { result: 0, auth: 'eu' } : { result: 2000 }))
    await passwordLogin('me@example.com', 'pw')
    expect(calls.map((call) => call.host)).toEqual(['api.pcloud.com', 'eapi.pcloud.com'])
    expect(authStore.get().auth?.host).toBe('eapi.pcloud.com')
  })

  it('reports wrong credentials after both regions refuse', async () => {
    fakePcloud(() => ({ result: 2000, error: 'Log in failed.' }))
    await expect(passwordLogin('me@example.com', 'bad')).rejects.toThrow('Email o password non corrette.')
    expect(authStore.get().auth).toBeNull()
  })

  it('does not retry on other errors', async () => {
    const calls = fakePcloud(() => ({ result: 4000 }))
    await expect(passwordLogin('me@example.com', 'pw')).rejects.toBeInstanceOf(LoginError)
    expect(calls).toHaveLength(1)
  })

  it('asks for the 2FA code and completes with tfa_login', async () => {
    const calls = fakePcloud(({ method, params }) => {
      if (method === 'userinfo') return { result: 2297, token: 'challenge', tfatype: 2 }
      if (method === 'tfa_login') return params.code === '123456' ? { result: 0, auth: 'tok' } : { result: 2064, error: 'Invalid code.' }
      return { result: 999 }
    })
    const step = await passwordLogin('me@example.com', 'pw')
    expect(step).toEqual({ done: false, challenge: { kind: 'tfa', host: 'api.pcloud.com', token: 'challenge', sms: false } })
    if (step.done) throw new Error('unreachable')

    await expect(completeLogin(step.challenge, '000000', 'me@example.com', 'pw')).rejects.toThrow('Codice non valido')
    expect(await completeLogin(step.challenge, '123456', 'me@example.com', 'pw')).toEqual({ done: true })
    expect(calls.at(-1)).toMatchObject({ method: 'tfa_login', params: { token: 'challenge', trustdevice: 1 } })
    expect(authStore.get().auth?.token).toBe('tok')
  })

  it('sends the SMS when the 2FA method is SMS', async () => {
    const calls = fakePcloud(({ method }) => (method === 'userinfo' ? { result: 2297, token: 't', tfatype: 1 } : { result: 0 }))
    const step = await passwordLogin('me@example.com', 'pw')
    expect(step).toMatchObject({ done: false, challenge: { sms: true } })
    expect(calls.map((call) => call.method)).toEqual(['userinfo', 'tfa_sendcodeviasms'])
  })

  it('handles the email code for a new device without resending on a wrong code', async () => {
    const calls = fakePcloud(({ method, params }) => {
      if (method === 'userinfo') return { result: 2306 }
      if (method === 'user/sendemailtfamail') return { result: 0 }
      if (method === 'login') return params.emailtfacode === '123456' ? { result: 0, auth: 'tok' } : { result: 2306 }
      return { result: 999 }
    })
    const step = await passwordLogin('me@example.com', 'pw')
    expect(step).toEqual({ done: false, challenge: { kind: 'email', host: 'api.pcloud.com' } })
    if (step.done) throw new Error('unreachable')

    await expect(completeLogin(step.challenge, '1', 'me@example.com', 'pw')).rejects.toThrow('non ha accettato il codice')
    expect(calls.filter((call) => call.method === 'user/sendemailtfamail')).toHaveLength(1)
    expect(await completeLogin(step.challenge, '123456', 'me@example.com', 'pw')).toEqual({ done: true })
  })
})
