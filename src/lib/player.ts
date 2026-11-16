// Il lettore: un solo elemento <audio>, la coda, i comandi di sistema (Media Session).
// La Media Session è ciò che fa continuare la musica a schermo spento su Android e
// collega i tasti multimediali e il lock screen.

import { NATIVE_EXT } from '../config'
import { storageKey } from './env'
import { extensionOf } from './library'
import { forgetLocalSource, isLocalUrl, isRefererError, localUrl, whyNotPlayable } from './localSource'
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
import { createStore } from './store'

export interface PlayerState extends QueueState {
  /** L'intenzione: true anche mentre il brano sta ancora caricando. */
  playing: boolean
  loading: boolean
  error: string | null
}

export const playerStore = createStore<PlayerState>({ ...emptyQueue, playing: false, loading: false, error: null })

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

  try {
    const url = await resolveLink(item, transcoding)
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
  audio.removeAttribute('src')
  audio.load()
  patch({ playing: false, loading: false })
  progressStore.set({ position: 0, duration: 0 })
  if ('mediaSession' in navigator) navigator.mediaSession.metadata = null
}

/** Il file non si è lasciato suonare: riprova con un link fresco, poi transcodificato. */
function onMediaError(message: string) {
  const item = currentItem()
  if (!item) return
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

/** Prepara in anticipo il link del brano successivo, così il cambio non aspetta la rete. */
function preloadNext() {
  const state = playerStore.get()
  const next = nextIndex(state, true)
  const item = next === null ? undefined : state.items[next]
  if (item && next !== state.index) void resolveLink(item, needsTranscode(item)).catch(() => {})
}

function syncProgress() {
  progressStore.set({
    position: audio.currentTime,
    duration: Number.isFinite(audio.duration) ? audio.duration : 0,
  })
}

audio.addEventListener('loadedmetadata', () => {
  if (resumeAt > 0 && Number.isFinite(audio.duration)) {
    audio.currentTime = Math.min(resumeAt, Math.max(audio.duration - 1, 0))
  }
  resumeAt = 0
})
audio.addEventListener('durationchange', syncProgress)
audio.addEventListener('timeupdate', syncProgress)
audio.addEventListener('seeked', showPosition)
audio.addEventListener('waiting', () => patch({ loading: true }))
audio.addEventListener('canplay', () => {
  switching = false
  patch({ loading: false })
})
audio.addEventListener('playing', () => {
  switching = false
  failures = 0
  patch({ playing: true, loading: false, error: null })
  showPosition()
  preloadNext()
})
audio.addEventListener('play', () => patch({ playing: true }))
audio.addEventListener('pause', () => {
  // Pausa arrivata da fuori (cuffie staccate, notifica di sistema). Durante un cambio brano non conta.
  if (!audio.ended && !switching) patch({ playing: false })
})
audio.addEventListener('ended', () => {
  const next = nextIndex(playerStore.get(), true)
  if (next === null) {
    patch({ playing: false })
    return
  }
  patch({ index: next })
  void load({ autoplay: true })
})
audio.addEventListener('error', () => {
  if (!audio.error || audio.error.code === MediaError.MEDIA_ERR_ABORTED) return
  onMediaError(mediaErrorMessage())
})

// --- Media Session ---

function showMetadata(item: QItem) {
  if (!('mediaSession' in navigator)) return
  navigator.mediaSession.metadata = new MediaMetadata({
    title: item.title,
    artist: item.sub,
    artwork: [{ src: new URL('./icons/icon-512.png', document.baseURI).href, sizes: '512x512', type: 'image/png' }],
  })
}

function showPosition() {
  if (!('mediaSession' in navigator) || !Number.isFinite(audio.duration) || audio.duration <= 0) return
  try {
    navigator.mediaSession.setPositionState({
      duration: audio.duration,
      position: Math.min(audio.currentTime, audio.duration),
      playbackRate: audio.playbackRate,
    })
  } catch {
    // Alcuni browser rifiutano stati di posizione che considerano incoerenti: non è grave.
  }
}

function bindMediaSession() {
  if (!('mediaSession' in navigator)) return
  const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
    ['play', () => resume()],
    ['pause', () => pause()],
    ['previoustrack', () => previous()],
    ['nexttrack', () => next()],
    ['seekto', (details) => details.seekTime !== undefined && seek(details.seekTime)],
    ['seekbackward', (details) => seek(audio.currentTime - (details.seekOffset ?? 10))],
    ['seekforward', (details) => seek(audio.currentTime + (details.seekOffset ?? 10))],
  ]
  for (const [action, handler] of handlers) {
    try {
      navigator.mediaSession.setActionHandler(action, handler)
    } catch {
      // Azione non supportata da questo browser.
    }
  }
}

// --- Comandi ---

function resume() {
  if (!currentItem()) return
  // Niente di caricato (ripresa dopo il riavvio) o ultimo tentativo fallito: si ricarica da capo.
  if (!audio.src || playerStore.get().error) {
    failures = 0
    patch({ error: null })
    return void load({ autoplay: true, at: progressStore.get().position })
  }
  patch({ playing: true })
  audio.play().catch(() => patch({ playing: false }))
}

function pause() {
  audio.pause()
  patch({ playing: false })
}

export function toggle() {
  if (playerStore.get().playing) pause()
  else resume()
}

/** Sostituisce la coda e suona dal brano `start`. */
export function playItems(items: QItem[], start = 0) {
  if (!items.length) return
  playerStore.set((state) => ({ ...state, ...replaceQueue(state, items, start), error: null }))
  failures = 0
  void load({ autoplay: true })
}

/** Sostituisce la coda e la suona in ordine casuale. */
export function playShuffled(items: QItem[]) {
  if (!items.length) return
  patch({ shuffle: true })
  playItems(items, Math.floor(Math.random() * items.length))
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
  if (audio.currentTime > 3 || index === null) seek(0)
  else jumpTo(index)
}

export function seek(seconds: number) {
  const position = Math.max(0, seconds)
  if (audio.src && Number.isFinite(audio.duration)) audio.currentTime = Math.min(position, audio.duration)
  else progressStore.set((progress) => ({ ...progress, position }))
}

export function removeFromQueue(position: number) {
  const before = playerStore.get()
  const wasCurrent = position === before.index
  playerStore.set((state) => ({ ...state, ...removeAt(state, position) }))
  if (wasCurrent) void load({ autoplay: before.playing })
}

export function clearQueue() {
  playerStore.set((state) => ({ ...state, items: [], index: -1, original: null, error: null }))
  unload()
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
      patch({ items: saved.items, index, shuffle: !!saved.shuffle, repeat: saved.repeat ?? 'off' })
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
  clearQueue()
  links.clear()
  localStorage.removeItem(storageKey('player'))
}
