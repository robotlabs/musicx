// Import delle playlist esportate da iTunes (File ▸ Libreria ▸ Esporta playlist: un .xml in formato
// plist). I percorsi dentro sono quelli del vecchio Mac, quindi i brani si ritrovano nella libreria
// di pCloud così, in ordine: dimensione del file (iTunes la scrive, ed è quasi sempre unica; a
// parità vince il nome), nome del file, coda del percorso, artista e titolo.

import { findSong } from './duplicates'
import type { Library, Track } from './library'
import { matchM3u } from './m3u'

export interface ItunesTrack {
  name?: string
  artist?: string
  album?: string
  size?: number
  /** Percorso del file sul vecchio Mac (file://localhost/Users/...). */
  location?: string
}

export interface ItunesPlaylist {
  name: string
  tracks: ItunesTrack[]
}

type Value = string | number | boolean | Value[] | { [key: string]: Value }

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const unescape = (text: string) =>
  text.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (whole, code: string) => {
    if (code[0] === '#') return String.fromCodePoint(code[1].toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1)))
    return entities[code.toLowerCase()] ?? whole
  })

/** Un lettore plist minimo: dict, array, key, string, integer, real, date, true, false. */
function parsePlist(text: string): Value {
  const tags = /<(\/?)(dict|array|key|string|integer|real|date|data|true|false)(\s*\/)?>/g
  const stack: (Value[] | { [key: string]: Value })[] = []
  const keys: (string | null)[] = []
  let root: Value | undefined
  let pendingKey: string | null = null
  const put = (value: Value) => {
    const top = stack[stack.length - 1]
    if (!top) root = value
    else if (Array.isArray(top)) top.push(value)
    else if (pendingKey !== null) {
      top[pendingKey] = value
      pendingKey = null
    }
  }
  for (let match = tags.exec(text); match; match = tags.exec(text)) {
    const [, closing, tag, selfClosing] = match
    if (tag === 'true' || tag === 'false') {
      if (!closing) put(tag === 'true')
      continue
    }
    if (tag === 'dict' || tag === 'array') {
      if (selfClosing) put(tag === 'dict' ? {} : [])
      else if (!closing) {
        keys.push(pendingKey)
        pendingKey = null
        stack.push(tag === 'dict' ? {} : [])
      } else {
        const done = stack.pop()!
        pendingKey = keys.pop() ?? null
        put(done)
      }
      continue
    }
    if (closing || selfClosing) continue
    const end = text.indexOf(`</${tag}>`, tags.lastIndex)
    if (end < 0) break
    const content = unescape(text.slice(tags.lastIndex, end))
    tags.lastIndex = end + tag.length + 3
    if (tag === 'key') pendingKey = content
    else if (tag === 'integer' || tag === 'real') put(Number(content))
    else put(content)
  }
  return root ?? {}
}

const asDict = (value: Value | undefined) =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as { [key: string]: Value }) : {}

/** Le playlist del file, con i loro brani in ordine. Quelle di sistema di iTunes (Libreria, Musica…) no. */
export function parseItunes(text: string): ItunesPlaylist[] {
  const root = asDict(parsePlist(text))
  const tracks = asDict(root.Tracks)
  const lists = Array.isArray(root.Playlists) ? root.Playlists : []
  return lists
    .map(asDict)
    .filter((list) => !list.Master && list['Distinguished Kind'] === undefined && list.Visible !== false)
    .map((list) => ({
      name: String(list.Name ?? 'Playlist'),
      tracks: (Array.isArray(list['Playlist Items']) ? list['Playlist Items'] : []).flatMap((item) => {
        const track = asDict(tracks[String(asDict(item)['Track ID'])])
        if (!Object.keys(track).length) return []
        return [
          {
            name: track.Name === undefined ? undefined : String(track.Name),
            artist: track.Artist === undefined ? undefined : String(track.Artist),
            album: track.Album === undefined ? undefined : String(track.Album),
            size: typeof track.Size === 'number' ? track.Size : undefined,
            location: track.Location === undefined ? undefined : String(track.Location),
          },
        ]
      }),
    }))
    .filter((list) => list.tracks.length > 0)
}

const fileNameOf = (location: string | undefined) => {
  if (!location) return ''
  const last = location.split('/').pop() ?? ''
  try {
    return decodeURIComponent(last).normalize('NFC').toLocaleLowerCase('it')
  } catch {
    return last.toLocaleLowerCase('it')
  }
}

export interface ItunesMatch {
  trackIds: number[]
  /** "Artista — Titolo" dei brani che non si trovano. */
  missing: string[]
}

export function matchItunes(library: Library, tracks: ItunesTrack[]): ItunesMatch {
  const bySize = new Map<number, Track[]>()
  const byName = new Map<string, Track[]>()
  for (const track of library.tracks.values()) {
    if (track.size !== undefined) bySize.set(track.size, [...(bySize.get(track.size) ?? []), track])
    const name = track.name.normalize('NFC').toLocaleLowerCase('it')
    byName.set(name, [...(byName.get(name) ?? []), track])
  }
  const found: number[] = []
  const seen = new Set<number>()
  const missing: string[] = []
  for (const wanted of tracks) {
    const name = fileNameOf(wanted.location)
    const sameName = (candidates: Track[] | undefined) =>
      candidates?.find((track) => track.name.normalize('NFC').toLocaleLowerCase('it') === name)
    const sized = wanted.size === undefined ? undefined : bySize.get(wanted.size)
    let match = sameName(sized) ?? (sized?.length === 1 ? sized[0] : undefined) ?? (name ? byName.get(name)?.[0] : undefined)
    if (!match && wanted.location) {
      const id = matchM3u(library, [wanted.location]).trackIds[0]
      match = id === undefined ? undefined : library.tracks.get(id)
    }
    if (!match && wanted.name) match = findSong(library, wanted.artist ?? '', wanted.name)[0]
    if (!match) missing.push([wanted.artist, wanted.name].filter(Boolean).join(' — ') || name || '?')
    else if (!seen.has(match.id)) {
      seen.add(match.id)
      found.push(match.id)
    }
  }
  return { trackIds: found, missing }
}
