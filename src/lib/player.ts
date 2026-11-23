// Il lettore: un solo elemento <audio>, la coda, i comandi di sistema (Media Session).
// La Media Session è ciò che fa continuare la musica a schermo spento su Android e
// collega i tasti multimediali e il lock screen.
// Con "Trasmetti" il brano lo suona una cassa di casa (cast/remote.ts): la coda resta qui, l'elemento
// <audio> sta fermo e i comandi vanno alla cassa.

import { MediaSession as NativeSession } from '@capgo/capacitor-media-session'
import { NATIVE_EXT } from '../config'
import { canSave, discardBroken, playableUrl, savedOf, saveTrack, trimCache } from './audioStore'
import { CAST_EXT, mimeOf } from './cast/dlna'
import { castStore, remote, type CastTarget, type Track } from './cast/remote'
import { storageKey } from './env'
import { extensionOf } from './library'
import { forgetLocalSource, isLocalUrl, isRefererError, localUrl, whyNotPlayable } from './localSource'
import { isNativeApp } from './native'
import { isOnline } from './network'
import { audioLink, fileLink, PCloudError } from './pcloud'
import {
  appendToQueue,
  emptyQueue,
  insertNext,
  nextIndex,
  nextRepeat,
  previousIndex,
  removeAt,
  replaceQueue,
  toggleShuffle as toggleQueueShuffle,
  type QItem,
  type QueueState,
} from './queue'
import type { Route } from './router'
import { createStore } from './store'

export interface PlayerState extends QueueState {
  /** L'intenzione: true anche mentre il brano sta ancora caricando. */
  playing: boolean
  loading: boolean
  error: string | null
  /** La pagina da cui è partita la coda (playlist, cartella, preferiti…): il lettore ci riporta. */
  source: Route | null
}

export const playerStore = createStore<PlayerState>({ ...emptyQueue, playing: false, loading: false, error: null, source: null })

/** Separato dallo stato del lettore perché cambia più volte al secondo. */
export const progressStore = createStore({ position: 0, duration: 0 })

const audio = new Audio()
audio.preload = 'auto'

/** 0 = primo tentativo, 1 = link appena rigenerato, 2 = transcodifica mp3 di pCloud. */
type Stage = 0 | 1 | 2

const LINK_TTL_MS = 20 * 60_000
const MAX_FAILURES = 3
const PERSIST_LIMIT = 3000

const links = new Map<string, { url: string; at: number }>()
let loadSequence = 0
let stage: Stage = 0
let transcoding = false
let failures = 0
/** Posizione da ripristinare appena il brano è caricato. */
let resumeAt = 0
/** true da quando si cambia brano a quando il nuovo è pronto. */
let switching = false
/** Il brano corrente suona da un file salvato sul dispositivo. */
let playingSaved = false

const currentItem = (): QItem | undefined => {
  const state = playerStore.get()
  return state.items[state.index]
}

const patch = (changes: Partial<PlayerState>) => playerStore.set((state) => ({ ...state, ...changes }))

const linkKey = (item: QItem, transcode: boolean) => `${item.id}:${transcode ? 'mp3' : 'file'}`

async function resolveLink(item: QItem, transcode: boolean): Promise<string> {
  const key = linkKey(item, transcode)
  const cached = links.get(key)
  if (cached && Date.now() - cached.at < LINK_TTL_MS) return cached.url
  // Sul Mac il file originale arriva da rclone; i link di pCloud servono solo dove funzionano.
  const local = transcode ? null : await localUrl(item.id)
  const url = local ?? (transcode ? await audioLink(item.id) : await fileLink(item.id))
  links.set(key, { url, at: Date.now() })
  return url
}

const needsTranscode = (item: QItem) => !NATIVE_EXT.has(extensionOf(item.file))

async function load(options: { autoplay: boolean; at?: number; stage?: Stage }) {
  const sequence = ++loadSequence
  const item = currentItem()
  if (!item) return unload()

  stage = options.stage ?? 0
  transcoding = stage === 2 || needsTranscode(item)
  resumeAt = options.at ?? 0
  switching = true
  patch({ playing: options.autoplay, loading: true })
  progressStore.set({ position: resumeAt, duration: 0 })
  showMetadata(item)
  if (remote.active) return loadRemote(sequence, item, options)

  try {
    // Scaricato o precaricato: parte subito e anche senza rete.
    const saved = transcoding ? null : await playableUrl(item.id)
    if (sequence !== loadSequence) return
    playingSaved = saved !== null
    if (!saved && !isOnline()) return skipToSaved()
    const url = saved ?? (await resolveLink(item, transcoding))
    if (sequence !== loadSequence) return
    audio.src = url
    if (options.autoplay) await audio.play()
  } catch (error) {
    if (sequence !== loadSequence) return
    if (isRefererError(error)) {
      const reason = await whyNotPlayable(item, needsTranscode(item))
      if (sequence !== loadSequence) return
      return reason.fatal ? stop(reason.message) : giveUp(reason.message)
    }
    if (error instanceof PCloudError) return giveUp(error.message)
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      // Il browser vuole un gesto dell'utente prima di suonare.
      patch({ playing: false, loading: false })
    }
    // Gli altri rifiuti di play() arrivano anche come evento 'error' dell'elemento audio.
  }
}

function unload() {
  loadSequence += 1
  switching = false
  if (remote.active) void remote.stopPlayback()
  audio.removeAttribute('src')
  audio.load()
  patch({ playing: false, loading: false })
  progressStore.set({ position: 0, duration: 0 })
  if (hasWebSession()) navigator.mediaSession.metadata = null
}

/** Il file non si è lasciato suonare: riprova con un link fresco, poi transcodificato. */
function onMediaError(message: string) {
  const item = currentItem()
  if (!item) return
  if (playingSaved) {
    // Il file salvato è rovinato: si butta e si riprende il brano da pCloud.
    playingSaved = false
    discardBroken(item.id)
    return void load({ autoplay: playerStore.get().playing, at: audio.currentTime || resumeAt, stage: 0 })
  }
  links.delete(linkKey(item, transcoding))
  // rclone spento, o permesso di Chrome tolto: si ricontrolla prima di riprovare.
  if (isLocalUrl(audio.src)) forgetLocalSource()
  const at = audio.currentTime || resumeAt
  const autoplay = playerStore.get().playing
  if (stage === 0) return void load({ autoplay, at, stage: 1 })
  if (stage === 1 && !transcoding) return void load({ autoplay, at, stage: 2 })
  giveUp(message)
}

/** Si ferma e spiega perché. */
function stop(message: string) {
  switching = false
  patch({ playing: false, loading: false, error: message })
}

/** Brano irrecuperabile: passa al successivo, ma si ferma se falliscono in fila (es. rete assente). */
function giveUp(message: string) {
  failures += 1
  const state = playerStore.get()
  const next = nextIndex(state, false)
  if (failures >= MAX_FAILURES || next === null || next === state.index || !state.playing) return stop(message)
  patch({ index: next, error: message })
  void load({ autoplay: true })
}

function mediaErrorMessage(): string {
  const title = currentItem()?.title ?? 'il brano'
  return audio.error?.code === MediaError.MEDIA_ERR_NETWORK
    ? `Connessione persa durante "${title}".`
    : `Impossibile riprodurre "${title}".`
}

/** Senza rete suonano solo i brani salvati sul dispositivo: si passa al prossimo che c'è. */
function skipToSaved() {
  const state = playerStore.get()
  let index = state.index
  for (let step = 0; step < state.items.length; step++) {
    const next = nextIndex({ ...state, index }, false)
    if (next === null || next === state.index) break
    index = next
    if (savedOf(state.items[index].id)) {
      patch({ index, error: null })
      return void load({ autoplay: state.playing })
    }
  }
  stop('Sei offline e nella coda non ci sono brani scaricati su questo dispositivo.')
}

/** Quanti brani successivi si tengono pronti sul dispositivo, come fa Spotify. */
const PREFETCH_COUNT = 2
/** Si aspetta un po' prima di precaricare, per non rubare banda al brano appena partito. */
const PREFETCH_DELAY_MS = 3000
let prefetchRun = 0

/** I prossimi brani nell'ordine in cui suoneranno (senza quello corrente). */
function upcoming(count: number): QItem[] {
  const state = playerStore.get()
  const result: QItem[] = []
  let index = state.index
  while (result.length < count) {
    const next = nextIndex({ ...state, index }, true)
    if (next === null || next === state.index || next === index) break
    index = next
    result.push(state.items[index])
  }
  return result
}

/** Prepara il brano successivo: il link subito, poi i file dei prossimi brani sul dispositivo. */
function preloadNext() {
  const next = upcoming(1)[0]
  if (next && !savedOf(next.id)) void resolveLink(next, needsTranscode(next)).catch(() => {})
  const run = ++prefetchRun
  setTimeout(() => void prefetch(run), PREFETCH_DELAY_MS)
}

async function prefetch(run: number) {
  if (!canSave()) return
  const items = upcoming(PREFETCH_COUNT).filter((item) => !needsTranscode(item))
  for (const item of items) {
    if (run !== prefetchRun || !isOnline()) return
    if (!savedOf(item.id)) await saveTrack(item.id, item.file, 'cache')
  }
  const current = currentItem()
  await trimCache(new Set([...items.map((item) => item.id), ...(current ? [current.id] : [])]))
}

function syncProgress() {
  progressStore.set({
    position: audio.currentTime,
    duration: Number.isFinite(audio.duration) ? audio.duration : 0,
  })
}

/** Gli eventi dell'elemento audio contano solo quando suona lui (non mentre si trasmette). */
function onAudio(type: keyof HTMLMediaElementEventMap, listener: () => void) {
  audio.addEventListener(type, () => {
    if (!remote.active) listener()
  })
}

onAudio('loadedmetadata', () => {
  if (resumeAt > 0 && Number.isFinite(audio.duration)) {
    audio.currentTime = Math.min(resumeAt, Math.max(audio.duration - 1, 0))
  }
  resumeAt = 0
})
onAudio('durationchange', syncProgress)
onAudio('timeupdate', syncProgress)
onAudio('seeked', showPosition)
onAudio('waiting', () => patch({ loading: true }))
onAudio('canplay', () => {
  switching = false
  patch({ loading: false })
})
onAudio('playing', () => {
  switching = false
  failures = 0
  patch({ playing: true, loading: false, error: null })
  showPosition()
  preloadNext()
})
onAudio('play', () => patch({ playing: true }))
onAudio('pause', () => {
  // Pausa arrivata da fuori (cuffie staccate, notifica di sistema). Durante un cambio brano non conta.
  if (!audio.ended && !switching) patch({ playing: false })
})
onAudio('ended', onTrackEnd)
onAudio('error', () => {
  if (!audio.error || audio.error.code === MediaError.MEDIA_ERR_ABORTED) return
  onMediaError(mediaErrorMessage())
})

/** Brano finito: si passa al successivo, se c'è. */
function onTrackEnd() {
  const next = nextIndex(playerStore.get(), true)
  if (next === null) {
    patch({ playing: false })
    return
  }
  patch({ index: next })
  void load({ autoplay: true })
}

/** Dove è arrivato il brano corrente, che suoni qui o sulla cassa. */
const currentPosition = () => (remote.active ? progressStore.get().position : audio.currentTime)

// --- Trasmetti ---

/** Durate già lette (la cassa spesso non la dice): servono alla barra e per capire quando un brano è finito. */
const durations = new Map<number, number>()

const castTranscodes = (item: QItem) => !CAST_EXT.has(extensionOf(item.file))

async function castTrack(item: QItem, transcode: boolean): Promise<Track> {
  return {
    id: item.id,
    url: await remote.link(item.id, transcode),
    meta: {
      title: item.title,
      artist: item.sub,
      mime: transcode ? 'audio/mpeg' : mimeOf(extensionOf(item.file)),
      duration: durations.get(item.id),
    },
  }
}

async function loadRemote(sequence: number, item: QItem, options: { autoplay: boolean; at?: number }) {
  switching = false
  transcoding = stage === 2 || castTranscodes(item)
  try {
    const track = await castTrack(item, transcoding)
    if (sequence !== loadSequence) return
    await remote.load(track, { at: options.at ?? 0, autoplay: options.autoplay })
    if (sequence !== loadSequence) return
    // In pausa non c'è altro da aspettare; altrimenti "Carico…" finché la cassa non parte.
    if (!options.autoplay) patch({ loading: false })
    void probeDuration(item)
  } catch (error) {
    if (sequence !== loadSequence || !remote.active) return
    onRemoteError(error instanceof Error ? error.message : String(error))
  }
}

/** La cassa non ha suonato il brano: link nuovo, poi l'mp3 di pCloud, poi il successivo. */
function onRemoteError(message: string) {
  const item = currentItem()
  if (!item) return
  remote.forgetLink(item.id, transcoding)
  const at = progressStore.get().position
  const autoplay = playerStore.get().playing
  if (stage === 0) return void load({ autoplay, at, stage: 1 })
  if (stage === 1 && !transcoding) return void load({ autoplay, at, stage: 2 })
  giveUp(message)
}

/** Legge la durata del brano dal file (le prime decine di KB), senza suonarlo. */
async function probeDuration(item: QItem) {
  let duration = durations.get(item.id) ?? 0
  if (!duration) {
    try {
      const transcode = needsTranscode(item)
      const url = (transcode ? null : await playableUrl(item.id)) ?? (await resolveLink(item, transcode))
      duration = await new Promise<number>((resolve) => {
        const probe = new Audio()
        probe.preload = 'metadata'
        probe.muted = true
        const done = (value: number) => {
          clearTimeout(timer)
          probe.removeAttribute('src')
          probe.load()
          resolve(Number.isFinite(value) ? value : 0)
        }
        const timer = setTimeout(() => done(0), 20_000)
        probe.addEventListener('loadedmetadata', () => done(probe.duration), { once: true })
        probe.addEventListener('error', () => done(0), { once: true })
        probe.src = url
      })
    } catch {
      return
    }
    if (!duration) return
    durations.set(item.id, duration)
    if (durations.size > 1000) durations.delete(durations.keys().next().value!)
  }
  if (!remote.active || currentItem()?.id !== item.id) return
  if (!remote.durationHint) remote.durationHint = duration
  progressStore.set((progress) => ({ ...progress, duration: progress.duration || duration }))
}

let nextRun = 0
let nextTimer = 0

/** Prepara sulla cassa il brano che viene dopo, così ci passa da sola (anche a telefono spento). */
function syncNext() {
  clearTimeout(nextTimer)
  nextTimer = window.setTimeout(() => {
    if (!remote.active || !remote.loaded) return
    const next = upcoming(1)[0] ?? null
    if ((next?.id ?? null) === remote.nextId) return
    const run = ++nextRun
    void (async () => {
      try {
        const track = next ? await castTrack(next, castTranscodes(next)) : null
        if (run === nextRun && remote.active) await remote.setNext(track)
      } catch {
        // Niente di preparato: a fine brano il successivo lo manda il lettore.
      }
    })()
  }, 300)
}

/** La cassa è passata da sola al brano preparato. */
function advanceTo(id: number) {
  const state = playerStore.get()
  let index = nextIndex(state, true)
  if (index === null || state.items[index]?.id !== id) index = state.items.findIndex((item) => item.id === id)
  if (index === null || index < 0) return
  const item = state.items[index]
  loadSequence += 1
  stage = 0
  transcoding = castTranscodes(item)
  failures = 0
  patch({ index, playing: true, loading: false, error: null })
  progressStore.set({ position: 0, duration: durations.get(id) ?? 0 })
  showMetadata(item)
  void probeDuration(item)
  syncNext()
}

let lastRemoteSave = 0

remote.events = {
  playing() {
    failures = 0
    patch({ playing: true, loading: false, error: null })
    syncNext()
  },
  progress(position, duration) {
    progressStore.set((progress) => ({
      position,
      duration: duration || progress.duration || remote.durationHint,
    }))
    showPosition()
    if (Date.now() - lastRemoteSave > 5000) {
      lastRemoteSave = Date.now()
      save()
    }
  },
  advanced: advanceTo,
  ended: onTrackEnd,
  failed: onRemoteError,
  paused: () => patch({ playing: false }),
  resumed: () => patch({ playing: true, loading: false }),
  lost: () => patch({ playing: false, loading: false }),
}

// Cambia la coda (aggiunti, tolti, casuale): il brano preparato sulla cassa va rifatto.
playerStore.subscribe(() => {
  if (remote.active) syncNext()
})

/**
 * Sposta la musica su una cassa, dal punto in cui è (`null`: di nuovo su questo dispositivo).
 * Se la cassa è la stessa cambiano solo le stanze collegate.
 */
export async function castTo(target: CastTarget | null) {
  const current = castStore.get().target
  if (target && current && target.device.ip === current.device.ip) return remote.setRooms(target.rooms)
  const wasPlaying = playerStore.get().playing
  const at = currentPosition() || progressStore.get().position
  if (remote.active) await remote.disconnect()
  if (target) {
    // Qui si ferma; la musica riparte sulla cassa.
    loadSequence += 1
    switching = false
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
    await remote.connect(target)
  }
  if (!currentItem()) return
  failures = 0
  patch({ error: null })
  void load({ autoplay: wasPlaying, at })
}

// --- Media Session ---
// Nel browser la gestisce Chrome. Nell'app Android la fa il plugin nativo, che mostra i comandi
// su notifica e schermata di blocco e, mentre c'è musica, tiene viva l'app a schermo spento.

const artwork = () => [{ src: new URL('./icons/icon-512.png', document.baseURI).href, sizes: '512x512', type: 'image/png' }]

const hasWebSession = () => !isNativeApp && 'mediaSession' in navigator

function showMetadata(item: QItem) {
  const metadata = { title: item.title, artist: item.sub, artwork: artwork() }
  if (isNativeApp) void NativeSession.setMetadata(metadata).catch(() => {})
  else if (hasWebSession()) navigator.mediaSession.metadata = new MediaMetadata(metadata)
}

function showPosition() {
  const { position, duration } = remote.active ? progressStore.get() : { position: audio.currentTime, duration: audio.duration }
  if (!Number.isFinite(duration) || duration <= 0) return
  const state = {
    duration,
    position: Math.min(position, duration),
    playbackRate: remote.active ? 1 : audio.playbackRate,
  }
  if (isNativeApp) return void NativeSession.setPositionState(state).catch(() => {})
  if (!hasWebSession()) return
  try {
    navigator.mediaSession.setPositionState(state)
  } catch {
    // Alcuni browser rifiutano stati di posizione che considerano incoerenti: non è grave.
  }
}

type SessionAction = 'play' | 'pause' | 'previoustrack' | 'nexttrack' | 'seekto' | 'seekbackward' | 'seekforward'
type SessionHandler = (details: { seekTime?: number | null; seekOffset?: number }) => void

function bindMediaSession() {
  const handlers: [SessionAction, SessionHandler][] = [
    ['play', () => resume()],
    ['pause', () => pause()],
    ['previoustrack', () => previous()],
    ['nexttrack', () => next()],
    ['seekto', (details) => typeof details.seekTime === 'number' && seek(details.seekTime)],
    ['seekbackward', (details) => seek(currentPosition() - (details.seekOffset ?? 10))],
    ['seekforward', (details) => seek(currentPosition() + (details.seekOffset ?? 10))],
  ]
  if (!isNativeApp) {
    if (!hasWebSession()) return
    for (const [action, handler] of handlers) {
      try {
        navigator.mediaSession.setActionHandler(action, handler as MediaSessionActionHandler)
      } catch {
        // Azione non supportata da questo browser.
      }
    }
    return
  }

  // Il servizio nativo nasce solo quando la musica parte, e i comandi registrati prima a volte non
  // gli arrivano (nell'emulatore: notifica con il solo "play"). Si registrano di nuovo appena c'è.
  const registerHandlers = () => {
    for (const [action, handler] of handlers) void NativeSession.setActionHandler({ action }, handler).catch(() => {})
  }
  registerHandlers()
  // Lo stato lo dice il lettore, non l'elemento audio: durante un cambio brano resta "playing",
  // così il servizio nativo non si ferma tra un brano e l'altro a schermo spento.
  let shown = ''
  const sync = () => {
    const state = playerStore.get()
    const playbackState = state.playing ? 'playing' : state.items.length ? 'paused' : 'none'
    if (playbackState === shown) return
    const starting = playbackState !== 'none' && (shown === '' || shown === 'none')
    shown = playbackState
    void NativeSession.setPlaybackState({ playbackState }).catch(() => {})
    if (starting) setTimeout(registerHandlers, 1500)
  }
  playerStore.subscribe(sync)
  sync()
}

// --- Comandi ---

function resume() {
  if (!currentItem()) return
  // Niente di caricato (ripresa dopo il riavvio) o ultimo tentativo fallito: si ricarica da capo.
  if (!(remote.active ? remote.loaded : audio.src) || playerStore.get().error) {
    failures = 0
    patch({ error: null })
    return void load({ autoplay: true, at: progressStore.get().position })
  }
  patch({ playing: true })
  if (remote.active) remote.play().catch(() => patch({ playing: false }))
  else audio.play().catch(() => patch({ playing: false }))
}

function pause() {
  if (remote.active) void remote.pause()
  else audio.pause()
  patch({ playing: false })
}

export function toggle() {
  if (playerStore.get().playing) pause()
  else resume()
}

/** Sostituisce la coda e suona dal brano `start`. `source` è la pagina da cui parte. */
export function playItems(items: QItem[], start = 0, source: Route | null = null) {
  if (!items.length) return
  playerStore.set((state) => ({ ...state, ...replaceQueue(state, items, start), error: null, source }))
  failures = 0
  void load({ autoplay: true })
}

/** Sostituisce la coda e la suona in ordine casuale. */
export function playShuffled(items: QItem[], source: Route | null = null) {
  if (!items.length) return
  patch({ shuffle: true })
  playItems(items, Math.floor(Math.random() * items.length), source)
}

export function playNext(items: QItem[]) {
  const wasEmpty = !currentItem()
  playerStore.set((state) => ({ ...state, ...insertNext(state, items) }))
  if (wasEmpty) void load({ autoplay: true })
}

export function enqueue(items: QItem[]) {
  const wasEmpty = !currentItem()
  playerStore.set((state) => ({ ...state, ...appendToQueue(state, items) }))
  if (wasEmpty) void load({ autoplay: true })
}

export function jumpTo(index: number) {
  if (!playerStore.get().items[index]) return
  patch({ index, error: null })
  failures = 0
  void load({ autoplay: true })
}

export function next() {
  const index = nextIndex(playerStore.get(), false)
  if (index !== null) jumpTo(index)
}

export function previous() {
  const index = previousIndex(playerStore.get())
  if (currentPosition() > 3 || index === null) seek(0)
  else jumpTo(index)
}

export function seek(seconds: number) {
  const position = Math.max(0, seconds)
  if (remote.active) {
    const { duration } = progressStore.get()
    const target = duration ? Math.min(position, duration - 1) : position
    progressStore.set((progress) => ({ ...progress, position: target }))
    void remote.seek(target)
  } else if (audio.src && Number.isFinite(audio.duration)) audio.currentTime = Math.min(position, audio.duration)
  else progressStore.set((progress) => ({ ...progress, position }))
}

export function removeFromQueue(position: number) {
  const before = playerStore.get()
  const wasCurrent = position === before.index
  playerStore.set((state) => ({ ...state, ...removeAt(state, position) }))
  if (wasCurrent) void load({ autoplay: before.playing })
}

export function clearQueue() {
  playerStore.set((state) => ({ ...state, items: [], index: -1, original: null, error: null, source: null }))
  unload()
}

/** Cambia come si vedono dei brani già in coda (dopo aver modificato titolo, artista o nome del file). */
export function updateQueueItems(update: (item: QItem) => QItem) {
  const fix = (items: QItem[]) => items.map(update)
  playerStore.set((state) => ({ ...state, items: fix(state.items), original: state.original && fix(state.original) }))
  const item = currentItem()
  if (item) showMetadata(item)
}

export const toggleShuffle = () => playerStore.set((state) => ({ ...state, ...toggleQueueShuffle(state) }))
export const cycleRepeat = () => patch({ repeat: nextRepeat(playerStore.get().repeat) })

// --- Ripresa tra una sessione e l'altra ---

interface Saved {
  items: QItem[]
  index: number
  shuffle: boolean
  repeat: QueueState['repeat']
  position: number
  source?: Route | null
}

function save() {
  const state = playerStore.get()
  const keep = state.items.length <= PERSIST_LIMIT
  const saved: Saved = {
    items: keep ? state.items : [],
    index: keep ? state.index : -1,
    shuffle: state.shuffle,
    repeat: state.repeat,
    position: keep ? progressStore.get().position : 0,
    source: keep ? state.source : null,
  }
  try {
    localStorage.setItem(storageKey('player'), JSON.stringify(saved))
  } catch {
    // Spazio esaurito: si perde solo la ripresa.
  }
}

let started = false

/** Da chiamare una volta dopo l'accesso: ripristina la coda (in pausa) e collega i comandi di sistema. */
export function initPlayer() {
  if (started) return
  started = true
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey('player')) ?? 'null') as Saved | null
    if (saved && Array.isArray(saved.items)) {
      const index = saved.items.length ? Math.min(Math.max(saved.index, 0), saved.items.length - 1) : -1
      patch({ items: saved.items, index, shuffle: !!saved.shuffle, repeat: saved.repeat ?? 'off', source: saved.source ?? null })
      progressStore.set({ position: saved.position || 0, duration: 0 })
      const item = currentItem()
      if (item) showMetadata(item)
    }
  } catch {
    // Stato salvato illeggibile: si parte da zero.
  }
  bindMediaSession()

  let timer = 0
  playerStore.subscribe(() => {
    clearTimeout(timer)
    timer = window.setTimeout(save, 400)
  })
  let lastSave = 0
  audio.addEventListener('timeupdate', () => {
    if (Date.now() - lastSave < 5000) return
    lastSave = Date.now()
    save()
  })
  window.addEventListener('pagehide', save)
}

/** All'uscita dall'account: ferma tutto e dimentica la coda. */
export function resetPlayer() {
  void remote.disconnect()
  clearQueue()
  links.clear()
  localStorage.removeItem(storageKey('player'))
}
