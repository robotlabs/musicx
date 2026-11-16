// Tag ID3 degli mp3: legge titolo, artista, album e numero di traccia e li riscrive senza toccare
// l'audio. Tutti gli altri campi del tag (copertina, anno, genere, commenti…) restano com'erano.
// Riferimenti: id3.org/id3v2.3.0, id3.org/id3v2.4.0-structure, id3.org/ID3v1.

export interface Tags {
  title?: string
  artist?: string
  album?: string
  /** Numero di traccia come lo scrive il tag: "3" o "3/12". */
  track?: string
}

/** I campi da cambiare; una stringa vuota toglie il campo. */
export type TagChanges = { [K in keyof Tags]?: string }

export class TagError extends Error {
  name = 'TagError'
}

const FRAME_OF: Record<keyof Tags, string> = { title: 'TIT2', artist: 'TPE1', album: 'TALB', track: 'TRCK' }

/**
 * ID3v2.2 (nomi di tre lettere, lo scriveva il vecchio iTunes: circa un file su cinque nella libreria)
 * si riscrive in v2.3. Questi frame hanno lo stesso contenuto nelle due versioni, cambia solo il nome;
 * la copertina (PIC) va convertita a parte. Quelli non elencati (rari) si perdono.
 */
const FROM_V22: Record<string, string> = {
  TT1: 'TIT1', TT2: 'TIT2', TT3: 'TIT3', TP1: 'TPE1', TP2: 'TPE2', TP3: 'TPE3', TP4: 'TPE4',
  TAL: 'TALB', TRK: 'TRCK', TPA: 'TPOS', TYE: 'TYER', TDA: 'TDAT', TIM: 'TIME', TRD: 'TRDA',
  TCO: 'TCON', TCM: 'TCOM', TXT: 'TEXT', TCR: 'TCOP', TPB: 'TPUB', TEN: 'TENC', TSS: 'TSSE',
  TLA: 'TLAN', TBP: 'TBPM', TKE: 'TKEY', TMT: 'TMED', TOT: 'TOAL', TOA: 'TOPE', TOL: 'TOLY',
  TOR: 'TORY', TOF: 'TOFN', TFT: 'TFLT', TLE: 'TLEN', TSI: 'TSIZ', TRC: 'TSRC', TXX: 'TXXX',
  COM: 'COMM', ULT: 'USLT', WXX: 'WXXX', CNT: 'PCNT', POP: 'POPM', UFI: 'UFID',
}

/** PIC (v2.2) → APIC (v2.3): il formato di tre lettere ("JPG") diventa un tipo MIME. */
function pictureFromV22(data: Uint8Array): Uint8Array | null {
  if (data.length < 5) return null
  const format = ascii(data, 1, 3).toUpperCase()
  const mime = format === 'PNG' ? 'image/png' : format === 'JPG' || format === 'JPE' ? 'image/jpeg' : `image/${format.toLowerCase()}`
  const out = new Uint8Array(data.length - 3 + mime.length + 1)
  out[0] = data[0]
  out.set([...mime].map((char) => char.charCodeAt(0)), 1)
  out.set(data.subarray(4), 1 + mime.length + 1)
  return out
}

interface Frame {
  id: string
  flags: Uint8Array
  data: Uint8Array
}

interface ParsedTag {
  /** Versione da riscrivere: 4 resta 4, il resto diventa 3. */
  version: 3 | 4
  frames: Frame[]
  /** Dove finisce il tag, cioè dove comincia l'audio. */
  end: number
}

const syncsafe = (bytes: Uint8Array, at: number) =>
  ((bytes[at] & 0x7f) << 21) | ((bytes[at + 1] & 0x7f) << 14) | ((bytes[at + 2] & 0x7f) << 7) | (bytes[at + 3] & 0x7f)

const uint32 = (bytes: Uint8Array, at: number) =>
  ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0

const ascii = (bytes: Uint8Array, at: number, length: number) => String.fromCharCode(...bytes.subarray(at, at + length))

/** Toglie la "desincronizzazione" (FF 00 → FF) usata da alcuni tag v2.2 e v2.3. */
function resync(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length)
  let length = 0
  for (let i = 0; i < bytes.length; i++) {
    out[length++] = bytes[i]
    if (bytes[i] === 0xff && bytes[i + 1] === 0x00) i++
  }
  return out.subarray(0, length)
}

const hasId3 = (bytes: Uint8Array) => bytes.length >= 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33

function parseTag(bytes: Uint8Array): ParsedTag | null {
  if (!hasId3(bytes)) return null
  const major = bytes[3]
  const flags = bytes[5]
  const size = syncsafe(bytes, 6)
  const end = 10 + size + (major === 4 && flags & 0x10 ? 10 : 0)
  if (major < 2 || major > 4) throw new TagError(`Tag ID3v2.${major} sconosciuto: non lo tocco.`)
  if (end > bytes.length) throw new TagError('Il tag ID3 del file è rovinato: non lo tocco.')
  if (major === 2 && flags & 0x40) throw new TagError('Tag ID3v2.2 compresso: non lo so riscrivere.')

  let body = bytes.subarray(10, 10 + size)
  if (major < 4 && flags & 0x80) body = resync(body)
  let at = 0
  if (major > 2 && flags & 0x40) at = major === 3 ? 4 + uint32(body, 0) : syncsafe(body, 0)

  const frames: Frame[] = []
  while (at < body.length) {
    if (major === 2) {
      if (at + 6 > body.length || body[at] === 0) break
      const id = ascii(body, at, 3)
      const length = (body[at + 3] << 16) | (body[at + 4] << 8) | body[at + 5]
      if (at + 6 + length > body.length) break
      const data = body.slice(at + 6, at + 6 + length)
      const converted = FROM_V22[id]
      const picture = id === 'PIC' ? pictureFromV22(data) : null
      if (converted) frames.push({ id: converted, flags: new Uint8Array(2), data })
      else if (picture) frames.push({ id: 'APIC', flags: new Uint8Array(2), data: picture })
      at += 6 + length
    } else {
      if (at + 10 > body.length || body[at] === 0) break
      const id = ascii(body, at, 4)
      if (!/^[A-Z0-9]{4}$/.test(id)) break
      const length = major === 4 ? syncsafe(body, at + 4) : uint32(body, at + 4)
      if (at + 10 + length > body.length) break
      frames.push({ id, flags: body.slice(at + 8, at + 10), data: body.slice(at + 10, at + 10 + length) })
      at += 10 + length
    }
  }
  return { version: major === 4 ? 4 : 3, frames, end }
}

// --- Testo dei campi ---

function decodeText(data: Uint8Array): string {
  if (!data.length) return ''
  const encoding = data[0]
  const raw = data.subarray(1)
  let text: string
  if (encoding === 1 || encoding === 2) {
    let littleEndian = encoding === 1
    let start = 0
    if (raw[0] === 0xff && raw[1] === 0xfe) {
      littleEndian = true
      start = 2
    } else if (raw[0] === 0xfe && raw[1] === 0xff) {
      littleEndian = false
      start = 2
    }
    text = new TextDecoder(littleEndian ? 'utf-16le' : 'utf-16be').decode(raw.subarray(start, start + ((raw.length - start) & ~1)))
  } else {
    text = new TextDecoder(encoding === 3 ? 'utf-8' : 'latin1').decode(raw)
  }
  // Più valori (v2.4) sono separati da zeri: li mostriamo uniti.
  return text
    .split('\0')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' / ')
}

const isLatin1 = (text: string) => [...text].every((char) => char.charCodeAt(0) <= 0xff)

function encodeText(text: string, version: 3 | 4): Uint8Array {
  if (isLatin1(text)) return Uint8Array.from([0, ...[...text].map((char) => char.charCodeAt(0))])
  if (version === 4) return Uint8Array.from([3, ...new TextEncoder().encode(text)])
  // v2.3 non conosce l'UTF-8: UTF-16 con BOM.
  const out = new Uint8Array(3 + text.length * 2)
  out.set([1, 0xff, 0xfe])
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    out[3 + i * 2] = code & 0xff
    out[4 + i * 2] = code >> 8
  }
  return out
}

// --- ID3v1: gli ultimi 128 byte del file ---

const V1_SIZE = 128
const V1_FIELDS: Record<'title' | 'artist' | 'album', number> = { title: 3, artist: 33, album: 63 }

const hasV1 = (bytes: Uint8Array) =>
  bytes.length >= V1_SIZE && ascii(bytes, bytes.length - V1_SIZE, 3) === 'TAG'

function readV1(bytes: Uint8Array): Tags {
  const tag = bytes.subarray(bytes.length - V1_SIZE)
  const field = (at: number) => new TextDecoder('latin1').decode(tag.subarray(at, at + 30)).split('\0')[0].trim() || undefined
  const track = tag[125] === 0 && tag[126] ? String(tag[126]) : undefined
  return { title: field(3), artist: field(33), album: field(63), track }
}

/** Aggiorna il tag v1 se c'è, così chi legge solo quello vede gli stessi nomi. */
function writeV1(audio: Uint8Array, changes: TagChanges): Uint8Array {
  if (!hasV1(audio)) return audio
  const out = audio.slice()
  const tag = out.subarray(out.length - V1_SIZE)
  for (const key of ['title', 'artist', 'album'] as const) {
    const value = changes[key]
    if (value === undefined) continue
    const at = V1_FIELDS[key]
    tag.fill(0, at, at + 30)
    ;[...value].slice(0, 30).forEach((char, i) => {
      const code = char.charCodeAt(0)
      tag[at + i] = code <= 0xff ? code : 0x3f
    })
  }
  if (changes.track !== undefined) {
    const number = Number.parseInt(changes.track, 10)
    // v1.1: byte 125 a zero, byte 126 il numero (se non entra, si lascia vuoto).
    tag[125] = 0
    tag[126] = number > 0 && number < 256 ? number : 0
  }
  return out
}

// --- Lettura e scrittura ---

/** I campi che usiamo, dal tag v2 o, se manca, dal v1. */
export function readTags(bytes: Uint8Array): Tags {
  const parsed = parseTag(bytes)
  const v1 = hasV1(bytes) ? readV1(bytes) : {}
  const tags: Tags = {}
  for (const key of Object.keys(FRAME_OF) as (keyof Tags)[]) {
    const frame = parsed?.frames.find((entry) => entry.id === FRAME_OF[key])
    const value = frame ? decodeText(frame.data) : v1[key]
    if (value) tags[key] = value
  }
  return tags
}

/**
 * Un mp3 senza tag deve cominciare con un frame audio (al massimo dopo un po' di byte a zero, come
 * capita): altrimenti forse non è un mp3 e meglio non toccarlo.
 */
function startsWithAudioFrame(bytes: Uint8Array): boolean {
  let at = 0
  while (at < bytes.length && at < 65_536 && bytes[at] === 0) at++
  return at + 1 < bytes.length && bytes[at] === 0xff && (bytes[at + 1] & 0xe0) === 0xe0
}

/**
 * Il file con i campi cambiati. L'audio resta identico byte per byte; il tag v2 viene riscritto
 * (nella stessa versione se è v2.4, altrimenti v2.3) e il v1, se c'è, aggiornato.
 */
export function writeTags(bytes: Uint8Array, requested: TagChanges): Uint8Array {
  const changes: TagChanges = {}
  for (const key of Object.keys(FRAME_OF) as (keyof Tags)[]) {
    if (requested[key] !== undefined) changes[key] = requested[key].trim()
  }
  const parsed = parseTag(bytes)
  if (!parsed && !startsWithAudioFrame(bytes)) throw new TagError('Il file non sembra un mp3: non lo tocco.')
  const version = parsed?.version ?? 3
  const frames = [...(parsed?.frames ?? [])]

  for (const key of Object.keys(changes) as (keyof Tags)[]) {
    const value = changes[key]
    if (value === undefined) continue
    const id = FRAME_OF[key]
    const first = frames.findIndex((frame) => frame.id === id)
    const kept = frames.filter((frame) => frame.id !== id)
    if (value) {
      const frame = { id, flags: new Uint8Array(2), data: encodeText(value, version) }
      kept.splice(first === -1 ? kept.length : first, 0, frame)
    }
    frames.splice(0, frames.length, ...kept)
  }

  const padding = 512
  const bodyLength = frames.reduce((sum, frame) => sum + 10 + frame.data.length, 0) + padding
  const audio = writeV1(bytes.subarray(parsed?.end ?? 0), changes)
  const out = new Uint8Array(10 + bodyLength + audio.length)
  const putSize = (at: number, size: number, safe: boolean) =>
    out.set(
      safe
        ? [(size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f]
        : [(size >>> 24) & 0xff, (size >> 16) & 0xff, (size >> 8) & 0xff, size & 0xff],
      at,
    )

  out.set([0x49, 0x44, 0x33, version, 0, 0])
  putSize(6, bodyLength, true)
  let at = 10
  for (const frame of frames) {
    out.set([...frame.id].map((char) => char.charCodeAt(0)), at)
    putSize(at + 4, frame.data.length, version === 4)
    out.set(frame.flags, at + 8)
    out.set(frame.data, at + 10)
    at += 10 + frame.data.length
  }
  out.set(audio, 10 + bodyLength)

  // Prima di restituirlo, il file nuovo si rilegge: i campi devono essere quelli voluti e l'audio intatto.
  const check = parseTag(out)!
  const written = readTags(out)
  const audioIntact = out.length - check.end === audio.length
  const fieldsOk = (Object.keys(changes) as (keyof Tags)[]).every(
    (key) => changes[key] === undefined || (written[key] ?? '') === changes[key],
  )
  if (!audioIntact || !fieldsOk) throw new TagError('Riscrivendo il tag qualcosa non torna: il file non è stato toccato.')
  return out
}
