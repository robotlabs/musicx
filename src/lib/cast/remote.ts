// La cassa che suona al posto del dispositivo, come Spotify Connect: musicx le dà il link pCloud del
// brano e lei lo prende da sola; da qui partono solo i comandi (DLNA AVTransport) e si guarda come va.
//
// Il brano dopo si prepara sulla cassa (SetNextAVTransportURI): così passa da sola al successivo anche
// se il telefono dorme. Se la cassa non lo sa fare, a fine brano si manda il successivo da qui.
// Le altre stanze (MusicCast) si collegano alla cassa che suona appena parte la musica.

import { createStore } from '../store'
import { castBackend, type CastBackend } from './backend'
import type { Device } from './devices'
import { didl, hms, sameUrl, seconds, soapFault, soapRequest, soapValues, type Service, type TrackMeta } from './dlna'
import { linkRooms, newGroupId, roomStatus, setRoomVolume, unlinkRooms } from './musiccast'

export interface CastTarget {
  /** La cassa che suona. */
  device: Device
  /** Le altre stanze collegate (solo MusicCast). */
  rooms: Device[]
}

interface CastState {
  target: CastTarget | null
  status: 'off' | 'connecting' | 'on'
  /** L'ultimo problema da far vedere (stanze non collegate, cassa persa). */
  error: string | null
}

export const castStore = createStore<CastState>({ target: null, status: 'off', error: null })

export interface Track {
  id: number
  url: string
  meta: TrackMeta
}

/** Cosa racconta la cassa al lettore. */
export interface RemoteEvents {
  /** Il brano caricato è partito davvero. */
  playing(): void
  /** `duration` è 0 se la cassa non la sa. */
  progress(position: number, duration: number): void
  /** La cassa è passata da sola al brano preparato (`id`). */
  advanced(id: number): void
  /** Brano finito e niente di preparato. */
  ended(): void
  /** La cassa non riesce a suonare il brano. */
  failed(message: string): void
  /** Messa in pausa o fatta ripartire da fuori (app Yamaha, telecomando). */
  paused(): void
  resumed(): void
  /** La cassa è passata ad altro (Spotify, spenta) o non risponde più: si torna a questo dispositivo. */
  lost(message: string): void
}

type Want = 'play' | 'pause' | 'stop'

const POLL_PLAYING_MS = 1000
const POLL_IDLE_MS = 3000
/** Se dopo tanto il brano non è ancora partito, la cassa non lo suona. */
const START_TIMEOUT_MS = 15_000
/** Fermo a meno di tanto dalla fine = finito (la cassa non dà sempre la posizione esatta). */
const END_MARGIN_S = 8
const MAX_POLL_FAILURES = 8
/** Ogni quanti giri si chiede alla MusicCast se sta ancora suonando musicx. */
const INPUT_CHECK_EVERY = 5

class Remote {
  events: RemoteEvents | null = null
  private backend: CastBackend | null = null
  private target: CastTarget | null = null
  private groupId = ''
  /** Stanze da collegare appena la musica parte. */
  private roomsToLink: Device[] = []
  private current: Track | null = null
  private next: Track | null = null
  private nextSupported = true
  private want: Want = 'stop'
  private sawPlaying = false
  private loadedAt = 0
  private stoppedPolls = 0
  private foreignPolls = 0
  private lastPosition = 0
  private pendingSeek = 0
  private pollFailures = 0
  private polls = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private chain: Promise<unknown> = Promise.resolve()
  private pending = 0
  /** Cresce a ogni comando: una lettura iniziata prima di un comando non vale più. */
  private commands = 0
  private links = new Map<string, { url: string; at: number }>()
  /** Durata del brano corrente, se la sa il lettore (la cassa spesso no). */
  durationHint = 0

  get active() {
    return this.target !== null
  }

  get device() {
    return this.target?.device ?? null
  }

  /** C'è un brano caricato sulla cassa (si può fare play/pausa senza ricaricarlo). */
  get loaded() {
    return this.current !== null
  }

  // --- Collegamento ---

  async connect(target: CastTarget) {
    const backend = castBackend()
    if (!backend) throw new Error('Da qui non si può trasmettere.')
    this.backend = backend
    this.target = target
    this.groupId = target.rooms.length ? newGroupId() : ''
    this.roomsToLink = target.device.yamaha ? [...target.rooms] : []
    this.reset()
    castStore.set({ target, status: 'connecting', error: null })
    this.schedule(POLL_IDLE_MS)
  }

  /** Torna a suonare sul dispositivo: ferma la cassa e scollega le stanze. */
  async disconnect() {
    const { target, backend } = this
    if (!target || !backend) return
    this.stopPolling()
    this.target = null
    castStore.set({ target: null, status: 'off', error: null })
    const linked = target.rooms.filter((room) => !this.roomsToLink.includes(room))
    this.reset()
    await this.call(target.device, 'AVTransport', 'Stop').catch(() => {})
    if (target.device.yamaha && linked.length) await unlinkRooms(backend, target.device, linked, null)
  }

  /** Cambia le stanze collegate senza fermare la musica. */
  async setRooms(rooms: Device[]) {
    const { target, backend } = this
    if (!target || !backend || !target.device.yamaha) return
    const was = new Set(target.rooms.map((room) => room.ip))
    const now = new Set(rooms.map((room) => room.ip))
    const added = rooms.filter((room) => !was.has(room.ip))
    const removed = target.rooms.filter((room) => !now.has(room.ip))
    this.target = { ...target, rooms }
    castStore.set((state) => ({ ...state, target: this.target }))
    if (!this.groupId) this.groupId = newGroupId()
    const linkedRemoved = removed.filter((room) => !this.roomsToLink.includes(room))
    this.roomsToLink = this.roomsToLink.filter((room) => now.has(room.ip))
    try {
      if (linkedRemoved.length) await unlinkRooms(backend, target.device, linkedRemoved, rooms.length ? this.groupId : null)
      if (this.sawPlaying) await linkRooms(backend, target.device, added, this.groupId)
      else this.roomsToLink.push(...added)
    } catch (error) {
      castStore.set((state) => ({ ...state, error: `Stanze non collegate: ${errorMessage(error)}` }))
    }
  }

  // --- Brani ---

  /** Il link del brano per la cassa (pCloud, con l'IP numerico). Si tiene 20 minuti. */
  async link(fileid: number, transcode: boolean): Promise<string> {
    const key = `${fileid}:${transcode}`
    const cached = this.links.get(key)
    if (cached && Date.now() - cached.at < 20 * 60_000) return cached.url
    const backend = this.backend ?? castBackend()
    if (!backend) throw new Error('Da qui non si può trasmettere.')
    const url = await backend.link(fileid, transcode)
    this.links.set(key, { url, at: Date.now() })
    return url
  }

  forgetLink(fileid: number, transcode: boolean) {
    this.links.delete(`${fileid}:${transcode}`)
  }

  async load(track: Track, options: { at: number; autoplay: boolean }) {
    const device = this.device
    if (!device) return
    this.current = track
    this.next = null
    this.want = options.autoplay ? 'play' : 'pause'
    this.sawPlaying = false
    this.loadedAt = Date.now()
    this.stoppedPolls = 0
    this.foreignPolls = 0
    this.lastPosition = options.at
    this.pendingSeek = options.at > 1 ? options.at : 0
    this.durationHint = track.meta.duration ?? 0
    this.commands += 1
    await this.call(device, 'AVTransport', 'SetAVTransportURI', {
      CurrentURI: track.url,
      CurrentURIMetaData: didl(track.url, track.meta),
    })
    if (options.autoplay) await this.call(device, 'AVTransport', 'Play', { Speed: 1 })
    this.schedule(500)
  }

  /** Prepara sulla cassa il brano dopo (null: niente). */
  async setNext(track: Track | null) {
    const device = this.device
    if (!device || !this.nextSupported || !this.current) return
    if ((track?.url ?? null) === (this.next?.url ?? null)) return
    this.next = track
    try {
      await this.call(device, 'AVTransport', 'SetNextAVTransportURI', {
        NextURI: track?.url ?? '',
        NextURIMetaData: track ? didl(track.url, track.meta) : '',
      })
    } catch {
      // Cassa che non lo sa fare: a fine brano il successivo lo manda il lettore.
      if (track) this.nextSupported = false
      this.next = null
    }
  }

  /** L'id del brano preparato sulla cassa, se c'è. */
  get nextId() {
    return this.next?.id ?? null
  }

  async play() {
    const device = this.device
    if (!device || !this.current) return
    this.want = 'play'
    this.stoppedPolls = 0
    if (!this.sawPlaying) this.loadedAt = Date.now()
    this.commands += 1
    await this.call(device, 'AVTransport', 'Play', { Speed: 1 })
    this.schedule(500)
  }

  async pause() {
    const device = this.device
    if (!device || !this.current) return
    this.want = 'pause'
    this.commands += 1
    await this.call(device, 'AVTransport', 'Pause').catch(() => {})
  }

  async seek(position: number) {
    const device = this.device
    if (!device || !this.current) return
    this.lastPosition = position
    this.commands += 1
    if (!this.sawPlaying) {
      this.pendingSeek = position
      return
    }
    await this.call(device, 'AVTransport', 'Seek', { Unit: 'REL_TIME', Target: hms(position) }).catch(() => {})
  }

  /** Ferma il brano (coda vuota), restando collegati alla cassa. */
  async stopPlayback() {
    const device = this.device
    this.current = null
    this.next = null
    this.want = 'stop'
    this.commands += 1
    if (device) await this.call(device, 'AVTransport', 'Stop').catch(() => {})
  }

  // --- Volume ---

  async volume(device: Device): Promise<{ value: number; max: number }> {
    const backend = this.backend ?? castBackend()
    if (!backend) throw new Error('Da qui non si può trasmettere.')
    if (device.yamaha) {
      const status = await roomStatus(backend, device)
      return { value: status.volume, max: status.maxVolume }
    }
    const reply = await this.call(device, 'RenderingControl', 'GetVolume', { Channel: 'Master' })
    return { value: Number(reply.CurrentVolume) || 0, max: 100 }
  }

  async setVolume(device: Device, value: number) {
    const backend = this.backend ?? castBackend()
    if (!backend) return
    if (device.yamaha) await setRoomVolume(backend, device, value)
    else await this.call(device, 'RenderingControl', 'SetVolume', { Channel: 'Master', DesiredVolume: Math.round(value) })
  }

  // --- Sotto ---

  private reset() {
    this.current = null
    this.next = null
    this.nextSupported = true
    this.want = 'stop'
    this.sawPlaying = false
    this.pollFailures = 0
    this.polls = 0
    this.durationHint = 0
  }

  /** I comandi alla cassa vanno uno alla volta: alcune non reggono richieste sovrapposte. */
  private run<T>(task: () => Promise<T>): Promise<T> {
    this.pending += 1
    const result = this.chain.then(task, task)
    this.chain = result.catch(() => {}).finally(() => (this.pending -= 1))
    return result
  }

  private call(device: Device, service: Service, action: string, args: Record<string, string | number> = {}) {
    return this.run(async () => {
      const backend = this.backend ?? castBackend()
      const url = service === 'AVTransport' ? device.avTransport : device.renderingControl
      if (!backend || !url) throw new Error(`${device.name} non accetta questo comando.`)
      const request = soapRequest(service, action, args)
      const reply = await backend.http({ method: 'POST', url, headers: request.headers, body: request.body })
      const fault = soapFault(reply.text)
      if (reply.status !== 200 || fault) throw new Error(`${device.name}: ${fault ?? `risposta ${reply.status}`}`)
      return soapValues(reply.text)
    })
  }

  private schedule(delay = this.want === 'play' ? POLL_PLAYING_MS : POLL_IDLE_MS) {
    clearTimeout(this.timer)
    if (!this.target) return
    this.timer = setTimeout(() => void this.poll(), delay)
  }

  private stopPolling() {
    clearTimeout(this.timer)
    this.timer = undefined
  }

  private async poll() {
    const device = this.device
    if (!device) return
    // Un comando in corso: si guarda al giro dopo.
    if (this.pending > 0) return this.schedule(300)
    const commands = this.commands
    try {
      const transport = await this.call(device, 'AVTransport', 'GetTransportInfo')
      const position = await this.call(device, 'AVTransport', 'GetPositionInfo')
      if (this.device !== device) return
      this.pollFailures = 0
      // Nel frattempo è partito un comando (pausa, salto…): questa lettura è vecchia.
      if (commands === this.commands) this.react(transport.CurrentTransportState ?? '', position)
      if (this.device === device && device.yamaha && this.sawPlaying && ++this.polls % INPUT_CHECK_EVERY === 0) {
        await this.checkInput(device)
      }
    } catch {
      if (this.device === device && ++this.pollFailures >= MAX_POLL_FAILURES) return this.lose(`${device.name} non risponde più.`)
    }
    if (this.device === device) this.schedule()
  }

  private async checkInput(device: Device) {
    const backend = this.backend
    if (!backend || !this.current) return
    const status = await roomStatus(backend, device).catch(() => null)
    if (!status || this.device !== device) return
    if (status.power !== 'on') return this.lose(`${device.name} si è spenta.`)
    if (status.input !== 'server') return this.lose(`${device.name} ora suona altro.`)
  }

  private react(state: string, info: Record<string, string>) {
    const uri = info.TrackURI ?? ''
    const position = seconds(info.RelTime)
    const reported = seconds(info.TrackDuration)
    if (reported) this.durationHint = reported

    // La cassa è passata da sola al brano preparato.
    if (this.next && uri && sameUrl(uri, this.next.url)) {
      const id = this.next.id
      this.current = this.next
      this.next = null
      this.sawPlaying = true
      this.stoppedPolls = 0
      this.lastPosition = position
      this.durationHint = reported || this.current.meta.duration || 0
      this.events?.advanced(id)
      this.events?.progress(position, reported)
      return
    }
    if (!this.current) return
    // Un altro indirizzo per tre giri di fila: qualcuno le ha mandato altro.
    if (uri && !sameUrl(uri, this.current.url)) {
      if (++this.foreignPolls >= 3) this.lose(`${this.device?.name ?? 'La cassa'} ora suona altro.`)
      return
    }
    this.foreignPolls = 0

    switch (state) {
      case 'PLAYING':
        this.stoppedPolls = 0
        if (!this.sawPlaying) {
          this.sawPlaying = true
          // "Collegata" quando la musica parte davvero.
          if (castStore.get().status === 'connecting') castStore.set((current) => ({ ...current, status: 'on' }))
          this.events?.playing()
          void this.linkPendingRooms()
        }
        if (this.pendingSeek) {
          const at = this.pendingSeek
          this.pendingSeek = 0
          void this.seek(at)
        }
        if (this.want === 'pause') {
          this.want = 'play'
          this.events?.resumed()
        }
        this.lastPosition = position
        this.events?.progress(position, reported)
        break
      case 'PAUSED_PLAYBACK':
        if (this.want === 'play' && this.sawPlaying) {
          this.want = 'pause'
          this.events?.paused()
        }
        this.lastPosition = position || this.lastPosition
        this.events?.progress(this.lastPosition, reported)
        break
      case 'STOPPED':
      case 'NO_MEDIA_PRESENT': {
        if (this.want !== 'play') break
        if (!this.sawPlaying) {
          if (Date.now() - this.loadedAt > START_TIMEOUT_MS) {
            this.want = 'stop'
            this.events?.failed(`${this.device?.name ?? 'La cassa'} non riesce a suonare "${this.current.meta.title}".`)
          }
          break
        }
        // Un giro fermo può essere il passaggio da un brano all'altro.
        if (++this.stoppedPolls < 2) break
        const duration = this.durationHint
        if (!duration || this.lastPosition >= duration - END_MARGIN_S) {
          this.want = 'stop'
          this.events?.ended()
        } else {
          // Fermata da fuori a metà brano: per musicx è una pausa.
          this.want = 'pause'
          this.sawPlaying = false
          this.pendingSeek = this.lastPosition
          this.events?.paused()
        }
        break
      }
    }
  }

  private async linkPendingRooms() {
    const { target, backend } = this
    if (!target || !backend || !this.roomsToLink.length) return
    const rooms = this.roomsToLink
    this.roomsToLink = []
    try {
      await linkRooms(backend, target.device, rooms, this.groupId)
    } catch (error) {
      castStore.set((state) => ({ ...state, error: `Stanze non collegate: ${errorMessage(error)}` }))
    }
  }

  private lose(message: string) {
    this.stopPolling()
    this.target = null
    this.reset()
    castStore.set({ target: null, status: 'off', error: message })
    this.events?.lost(message)
  }
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

export const remote = new Remote()
