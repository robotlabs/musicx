import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setCastBackend } from './backend'
import { describe as describeDevice, type Device } from './devices'
import { fakeCastBackend } from './fakeCast'
import { castStore, remote, type RemoteEvents, type Track } from './remote'

const TRACK_SECONDS = 20

function track(id: number): Track {
  return { id, url: `http://10.0.0.1/fake/${id}.mp3`, meta: { title: `t${id}`, artist: 'a', mime: 'audio/mpeg', duration: TRACK_SECONDS } }
}

/** Registra gli eventi che la cassa manda al lettore. */
function recorder() {
  const log: string[] = []
  const events: RemoteEvents = {
    playing: () => log.push('playing'),
    progress: () => {},
    advanced: (id) => log.push(`advanced ${id}`),
    ended: () => log.push('ended'),
    failed: (message) => log.push(`failed ${message}`),
    paused: () => log.push('paused'),
    resumed: () => log.push('resumed'),
    lost: (message) => log.push(`lost ${message}`),
  }
  return { log, events }
}

async function setup(options: { supportsNext?: boolean } = {}) {
  const fake = fakeCastBackend(TRACK_SECONDS, options)
  setCastBackend(fake.backend)
  const devices: Device[] = []
  for (const candidate of await fake.backend.discover()) devices.push((await describeDevice(fake.backend, candidate))!)
  const { log, events } = recorder()
  remote.events = events
  return { fake, devices, log }
}

const wait = (ms: number) => vi.advanceTimersByTimeAsync(ms)

describe('trasmissione a una cassa', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(async () => {
    const done = remote.disconnect()
    await wait(2000)
    await done
    setCastBackend(null)
    vi.useRealTimers()
  })

  it('trova le casse anche senza SSDP e ne legge nome e indirizzi', async () => {
    const discovered = setup()
    await wait(1000)
    const { devices } = await discovered
    expect(devices.map((device) => [device.name, device.avTransport, device.yamaha])).toEqual([
      ['Soggiorno', 'http://192.168.1.100:49154/AVTransport/ctrl', true],
      ['Camera', 'http://192.168.1.122:49154/AVTransport/ctrl', true],
    ])
  })

  it('suona, passa da sola al brano preparato e poi finisce', async () => {
    const ready = setup()
    await wait(1000)
    const { fake, devices, log } = await ready
    await remote.connect({ device: devices[0], rooms: [] })
    const loading = remote.load(track(1), { at: 0, autoplay: true })
    await wait(500)
    await loading
    await wait(2000)
    expect(log).toEqual(['playing'])
    expect(castStore.get().status).toBe('on')
    expect(fake.speakers.get('192.168.1.100')!.input).toBe('server')

    const next = remote.setNext(track(2))
    await wait(200)
    await next
    await wait(TRACK_SECONDS * 1000)
    expect(log).toEqual(['playing', 'advanced 2'])

    // Il secondo finisce senza altro preparato.
    await wait(TRACK_SECONDS * 1000 + 3000)
    expect(log).toEqual(['playing', 'advanced 2', 'ended'])
  })

  it('senza SetNextAVTransportURI avvisa a fine brano', async () => {
    const ready = setup({ supportsNext: false })
    await wait(1000)
    const { devices, log } = await ready
    await remote.connect({ device: devices[0], rooms: [] })
    const loading = remote.load(track(1), { at: 0, autoplay: true })
    await wait(500)
    await loading
    const next = remote.setNext(track(2))
    await wait(200)
    await next
    expect(remote.nextId).toBeNull()
    await wait(TRACK_SECONDS * 1000 + 4000)
    expect(log).toEqual(['playing', 'ended'])
  })

  it('riprende dal punto giusto e segue pausa e ripresa da fuori', async () => {
    const ready = setup()
    await wait(1000)
    const { fake, devices, log } = await ready
    await remote.connect({ device: devices[0], rooms: [] })
    const loading = remote.load(track(1), { at: 12, autoplay: true })
    await wait(500)
    await loading
    await wait(3000)
    const speaker = fake.speakers.get('192.168.1.100')!
    // Il salto al punto di partenza si fa appena la cassa suona.
    expect(speaker.offset).toBeGreaterThanOrEqual(12)

    // Pausa dall'app Yamaha.
    Object.assign(speaker, { offset: 14, state: 'PAUSED_PLAYBACK' })
    await wait(2000)
    expect(log).toEqual(['playing', 'paused'])
    Object.assign(speaker, { state: 'PLAYING', startedAt: Date.now() })
    await wait(4000)
    expect(log).toEqual(['playing', 'paused', 'resumed'])
  })

  it('se sulla cassa parte altro, torna qui', async () => {
    const ready = setup()
    await wait(1000)
    const { fake, devices, log } = await ready
    await remote.connect({ device: devices[0], rooms: [] })
    const loading = remote.load(track(1), { at: 0, autoplay: true })
    await wait(500)
    await loading
    await wait(2000)
    fake.speakers.get('192.168.1.100')!.input = 'spotify'
    await wait(8000)
    expect(log).toEqual(['playing', 'lost Soggiorno ora suona altro.'])
    expect(remote.active).toBe(false)
    expect(castStore.get()).toMatchObject({ status: 'off', error: 'Soggiorno ora suona altro.' })
  })

  it('collega le altre stanze appena la musica parte', async () => {
    const ready = setup()
    await wait(1000)
    const { fake, devices } = await ready
    await remote.connect({ device: devices[0], rooms: [devices[1]] })
    expect(fake.speakers.get('192.168.1.122')!.input).toBe('spotify')
    const loading = remote.load(track(1), { at: 0, autoplay: true })
    await wait(500)
    await loading
    await wait(3000)
    expect(fake.speakers.get('192.168.1.122')).toMatchObject({ power: 'on', input: 'mc_link' })
  })
})
