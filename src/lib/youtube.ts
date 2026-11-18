// "Da YouTube", solo sul Mac: la pagina parla col servizio locale (helper/youtube-helper.mjs), che
// cerca su YouTube, scarica l'audio e lo converte in mp3 con tag e copertina; poi la pagina lo carica
// su pCloud, nella cartella dell'artista.

import { normalize, type Library } from './library'

const FIRST_PORT = 8621
const LAST_PORT = 8630

/** Sul Mac (non sul telefono, dove il servizio non c'è). */
export const youtubeHere = () =>
  typeof navigator !== 'undefined' && /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints < 2

export interface HelperInfo {
  base: string
  ytdlp: string | null
  ffmpeg: boolean
  cookies: string | null
}

let found: HelperInfo | null = null

/** Il servizio sul Mac, se risponde (prova le porte su cui può essere). */
export async function findHelper(): Promise<HelperInfo | null> {
  if (found) {
    try {
      await health(found.base)
      return found
    } catch {
      found = null
    }
  }
  const ports = Array.from({ length: LAST_PORT - FIRST_PORT + 1 }, (_, i) => FIRST_PORT + i)
  const answers = await Promise.all(
    ports.map(async (port) => {
      const base = `http://127.0.0.1:${port}`
      try {
        return { base, ...(await health(base)) }
      } catch {
        return null
      }
    }),
  )
  found = answers.find((answer) => answer !== null) ?? null
  return found
}

async function health(base: string): Promise<Omit<HelperInfo, 'base'>> {
  const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2500) })
  const data = (await response.json()) as { app?: string } & Omit<HelperInfo, 'base'>
  if (data.app !== 'musicx-helper') throw new Error('non è il servizio di musicx')
  return { ytdlp: data.ytdlp ?? null, ffmpeg: !!data.ffmpeg, cookies: data.cookies ?? null }
}

async function ask<T>(path: string, init?: RequestInit): Promise<T> {
  const helper = found ?? (await findHelper())
  if (!helper) throw new Error('Il servizio YouTube sul Mac non risponde.')
  const response = await fetch(`${helper.base}${path}`, init)
  const data = (await response.json()) as T & { error?: string }
  if (!response.ok) throw new Error(data.error ?? `Il servizio ha risposto ${response.status}.`)
  return data
}

export interface Video {
  id: string
  title: string
  channel: string
  duration: number | null
  thumbnail: string
}

export interface SongInfo {
  artist: string
  title: string
  album?: string | null
  track?: number | null
  year?: string | null
  cover?: string | null
}

export const searchVideos = async (query: string) => (await ask<{ results: Video[] }>(`/search?q=${encodeURIComponent(query)}`)).results

/** Artista, titolo, album, numero e copertina "giusti" dal catalogo di iTunes. */
export const lookupSong = async (query: string) => (await ask<{ results: SongInfo[] }>(`/lookup?q=${encodeURIComponent(query)}`)).results

export const startDownload = async (videoId: string, info: SongInfo) =>
  (
    await ask<{ id: string }>('/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId, ...info }),
    })
  ).id

export interface JobStatus {
  state: 'queued' | 'download' | 'convert' | 'tag' | 'ready' | 'error'
  progress: number
  error: string | null
  size: number
}

export const jobStatus = (id: string) => ask<JobStatus>(`/jobs/${id}`)

export async function jobFile(id: string): Promise<Uint8Array> {
  const helper = found ?? (await findHelper())
  if (!helper) throw new Error('Il servizio YouTube sul Mac non risponde.')
  const response = await fetch(`${helper.base}/jobs/${id}/file`)
  if (!response.ok) throw new Error(`Il file non è arrivato (${response.status}).`)
  return new Uint8Array(await response.arrayBuffer())
}

export const forgetJob = (id: string) => ask(`/jobs/${id}`, { method: 'DELETE' }).catch(() => {})

// --- Nomi ---

/** Artista e titolo dal titolo del video: "Artista - Titolo (Official Video)". */
export function guessFromTitle(videoTitle: string, channel: string): { artist: string; title: string } {
  const cleaned = videoTitle
    .replace(/[([](?:[^)\]]*\b(?:official|video|audio|lyrics?|testo|visuali[sz]er|hd|hq|4k|remaster(?:ed)?|live|clip)\b[^)\]]*)[)\]]/gi, ' ')
    .replace(/\s*\|.*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
  const parts = cleaned.split(/\s+[-–—]\s+|\s*[-–—]\s*(?=[A-ZÀ-Ý])/)
  if (parts.length >= 2) return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() }
  return { artist: channel.replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim(), title: cleaned }
}

/** Un nome di file accettato da pCloud e dal Finder. */
export const safeName = (text: string) =>
  text
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')

const plain = (text: string) => normalize(text).replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * La cartella dell'artista nella libreria, se c'è: prima una cartella che si chiama come lui (meglio
 * se appena sotto la radice), poi quella con più brani suoi (dal tag). null se non c'è.
 */
export function artistFolder(library: Library, artist: string): number | null {
  const wanted = plain(artist)
  if (!wanted) return null
  const named = [...library.folders.values()].filter((folder) => folder.id !== library.rootId && plain(folder.name) === wanted)
  if (named.length) {
    return named.sort((a, b) => Number(b.parent === library.rootId) - Number(a.parent === library.rootId) || b.total - a.total)[0].id
  }
  const counts = new Map<number, number>()
  for (const track of library.tracks.values()) {
    if (track.artist && plain(track.artist) === wanted) counts.set(track.parent, (counts.get(track.parent) ?? 0) + 1)
  }
  let best: number | null = null
  for (const [folder, count] of counts) if (best === null || count > counts.get(best)!) best = folder
  return best
}
