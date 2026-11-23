#!/usr/bin/env node
// Servizio locale di musicx sul Mac per "Da YouTube": cerca un brano su YouTube, ne scarica l'audio,
// lo converte in mp3 con tag e copertina e lo dà alla pagina, che poi lo carica su pCloud.
// Usa yt-dlp e ffmpeg (Homebrew). Nessuna dipendenza npm: si lancia con node e basta.
// Fa anche da ponte per "Trasmetti" verso le casse di casa (cast.mjs, percorsi /cast/...).
//
// Ascolta solo su 127.0.0.1. Porta preferita 8621; se è occupata da un'altra copia di questo servizio
// esce senza fare niente (c'è già), se è occupata da altro prova le successive fino alla 8630. La
// pagina lo trova provando quelle porte (GET /health). Con MUSICX_HELPER_DEV=1 (per provare una copia
// nuova accanto a quella installata) non esce: prende la prima porta libera.
//
// Risponde solo al sito di musicx e allo sviluppo in locale (Origin), così un'altra pagina web non
// può usarlo.

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { castLink, discover, lanHttp } from './cast.mjs'

const VERSION = 2
const DEV = process.env.MUSICX_HELPER_DEV === '1'
const FIRST_PORT = 8621
const LAST_PORT = 8630
const WORK = join(tmpdir(), 'musicx-helper')
const KEEP_MS = 30 * 60_000
/**
 * YouTube a volte chiede di accedere ("Sign in to confirm you're not a bot"): con MUSICX_YT_COOKIES=chrome
 * (o safari, firefox…) yt-dlp usa l'accesso a YouTube di quel browser. Si attiva con install.sh --cookies.
 */
const COOKIES = process.env.MUSICX_YT_COOKIES || null
/** Solo per provare l'app: invece di scaricare da YouTube genera qualche secondo di tono. */
const FAKE_DOWNLOAD = process.env.MUSICX_HELPER_FAKE_DOWNLOAD === '1'

const allowedOrigin = (origin) =>
  origin === 'https://robotlabs.github.io' || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin ?? '')

const log = (...parts) => console.log(new Date().toISOString(), ...parts)

/** Esegue un programma e ne restituisce l'uscita; `onLine` riceve le righe mentre arrivano. */
function run(command, args, onLine) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const lines = (chunk, sink) => {
      const text = chunk.toString()
      sink(text)
      if (onLine) for (const line of text.split(/\r?\n/)) if (line.trim()) onLine(line)
    }
    child.stdout.on('data', (chunk) => lines(chunk, (text) => (out += text)))
    child.stderr.on('data', (chunk) => lines(chunk, (text) => (err += text)))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(out)
      else reject(new Error((err.trim().split('\n').pop() || `${command} è uscito con ${code}`).replace(/^ERROR:\s*/, '')))
    })
  })
}

// --- Ricerca ---

async function search(query) {
  const out = await run('yt-dlp', [`ytsearch12:${query}`, '--flat-playlist', '-J', '--no-warnings'])
  const data = JSON.parse(out)
  return (data.entries ?? [])
    .filter((entry) => entry.id && entry.title)
    .map((entry) => ({
      id: entry.id,
      title: entry.title,
      channel: entry.channel ?? entry.uploader ?? '',
      duration: entry.duration ?? null,
      thumbnail: `https://i.ytimg.com/vi/${entry.id}/mqdefault.jpg`,
    }))
}

/** Titolo, artista, album, numero e copertina "giusti" dal catalogo di iTunes (gratuito, senza chiave). */
async function lookup(query) {
  const url = `https://itunes.apple.com/search?${new URLSearchParams({ term: query, entity: 'song', limit: '8', country: 'IT' })}`
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error(`iTunes ha risposto ${response.status}`)
  const data = await response.json()
  return (data.results ?? []).map((item) => ({
    artist: item.artistName,
    title: item.trackName,
    album: item.collectionName,
    track: item.trackNumber ?? null,
    year: item.releaseDate ? String(item.releaseDate).slice(0, 4) : null,
    cover: item.artworkUrl100 ? String(item.artworkUrl100).replace('100x100bb', '600x600bb') : null,
  }))
}

// --- Download ---

/** Lavori in corso o pronti: id → stato. */
const jobs = new Map()

async function download(job, request) {
  const dir = join(WORK, job.id)
  await mkdir(dir, { recursive: true })
  job.dir = dir
  const audio = join(dir, 'audio.mp3')

  // 1. Audio migliore disponibile, convertito in mp3 VBR alta qualità.
  job.state = 'download'
  if (FAKE_DOWNLOAD) {
    await run('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=6', '-c:a', 'libmp3lame', '-q:a', '2', audio])
  } else {
    await run(
      'yt-dlp',
      [
        ...(COOKIES ? ['--cookies-from-browser', COOKIES] : []),
        '-f', 'bestaudio/best',
        '-x', '--audio-format', 'mp3', '--audio-quality', '0',
        '--no-playlist', '--newline', '--no-warnings',
        '-o', join(dir, 'audio.%(ext)s'),
        `https://www.youtube.com/watch?v=${request.videoId}`,
      ],
      (line) => {
        const percent = /\[download\]\s+([\d.]+)%/.exec(line)
        if (percent) job.progress = Number(percent[1])
        if (line.startsWith('[ExtractAudio]')) job.state = 'convert'
      },
    ).catch((error) => {
      if (/not a bot|Sign in to confirm/i.test(error.message) && !COOKIES) {
        throw new Error(
          'YouTube chiede di accedere ("non sono un robot"). Si risolve facendo usare a musicx l\'accesso a YouTube di Chrome: ./helper/install.sh --cookies chrome',
        )
      }
      throw error
    })
  }

  // 2. Copertina: quella del catalogo se c'è, altrimenti il fotogramma di YouTube ritagliato quadrato.
  job.state = 'tag'
  let cover = null
  const coverUrl = request.cover || `https://i.ytimg.com/vi/${request.videoId}/hqdefault.jpg`
  try {
    const response = await fetch(coverUrl, { signal: AbortSignal.timeout(15_000) })
    if (response.ok) {
      cover = join(dir, 'cover.jpg')
      await writeFile(cover, Buffer.from(await response.arrayBuffer()))
    }
  } catch {
    // Senza copertina va bene lo stesso.
  }

  // 3. Tag ID3 e copertina con ffmpeg (l'audio non si ricodifica).
  const out = join(dir, 'out.mp3')
  const tags = { title: request.title, artist: request.artist, album: request.album, track: request.track, date: request.year }
  const args = ['-y', '-i', audio]
  if (cover) args.push('-i', cover, '-map', '0:a', '-map', '1:v', '-c:v', 'mjpeg', '-disposition:v', 'attached_pic')
  if (cover && !request.cover) args.push('-vf', 'crop=ih:ih')
  args.push('-c:a', 'copy', '-id3v2_version', '3', '-map_metadata', '-1')
  for (const [key, value] of Object.entries(tags)) if (value) args.push('-metadata', `${key}=${value}`)
  if (cover) args.push('-metadata:s:v', 'title=Album cover', '-metadata:s:v', 'comment=Cover (front)')
  args.push(out)
  await run('ffmpeg', args)

  job.file = out
  job.size = (await stat(out)).size
  job.state = 'ready'
  job.progress = 100
}

function startJob(request) {
  if (!/^[\w-]{6,20}$/.test(request.videoId ?? '')) throw new Error('Video non valido.')
  const job = { id: randomUUID(), state: 'queued', progress: 0, error: null, file: null, size: 0, dir: null, at: Date.now() }
  jobs.set(job.id, job)
  download(job, request).catch((error) => {
    job.state = 'error'
    job.error = error.message
    log('download non riuscito', request.videoId, error.message)
  })
  return job
}

async function forgetJob(id) {
  const job = jobs.get(id)
  jobs.delete(id)
  if (job?.dir) await rm(job.dir, { recursive: true, force: true })
}

setInterval(() => {
  for (const job of jobs.values()) if (Date.now() - job.at > KEEP_MS) void forgetJob(job.id)
}, 60_000).unref()

// --- HTTP ---

const versions = { ytdlp: null, ffmpeg: false }

function send(response, status, body, headers = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers })
  response.end(JSON.stringify(body))
}

async function readJson(request) {
  let text = ''
  for await (const chunk of request) {
    text += chunk
    if (text.length > 100_000) throw new Error('Richiesta troppo grande.')
  }
  return JSON.parse(text || '{}')
}

async function handle(request, response) {
  const origin = request.headers.origin
  const cors = allowedOrigin(origin)
    ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Private-Network': 'true' }
    : {}
  const url = new URL(request.url, 'http://127.0.0.1')

  if (request.method === 'OPTIONS') {
    response.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET, POST, DELETE', 'Access-Control-Allow-Headers': 'Content-Type' })
    return response.end()
  }
  if (url.pathname === '/health') {
    return send(
      response,
      200,
      { app: 'musicx-helper', version: VERSION, ...versions, cookies: COOKIES, fake: FAKE_DOWNLOAD, cast: true },
      cors,
    )
  }
  // Tutto il resto solo dalle pagine di musicx (o senza Origin, dal Terminale).
  if (origin && !allowedOrigin(origin)) return send(response, 403, { error: 'Origine non ammessa.' })

  try {
    if (request.method === 'GET' && url.pathname === '/search') {
      return send(response, 200, { results: await search(url.searchParams.get('q') ?? '') }, cors)
    }
    if (request.method === 'GET' && url.pathname === '/lookup') {
      return send(response, 200, { results: await lookup(url.searchParams.get('q') ?? '') }, cors)
    }
    // --- Trasmetti ---
    if (request.method === 'GET' && url.pathname === '/cast/discover') {
      return send(response, 200, { devices: await discover() }, cors)
    }
    if (request.method === 'POST' && url.pathname === '/cast/http') {
      return send(response, 200, await lanHttp(await readJson(request)), cors)
    }
    if (request.method === 'POST' && url.pathname === '/cast/link') {
      try {
        return send(response, 200, await castLink(await readJson(request)), cors)
      } catch (error) {
        return send(response, 502, { error: error.message, code: error.code ?? null }, cors)
      }
    }
    if (request.method === 'POST' && url.pathname === '/jobs') {
      const job = startJob(await readJson(request))
      return send(response, 200, { id: job.id }, cors)
    }
    const match = /^\/jobs\/([\w-]+)(\/file)?$/.exec(url.pathname)
    const job = match && jobs.get(match[1])
    if (match && !job) return send(response, 404, { error: 'Lavoro non trovato.' }, cors)
    if (job && request.method === 'GET' && !match[2]) {
      return send(response, 200, { state: job.state, progress: job.progress, error: job.error, size: job.size }, cors)
    }
    if (job && request.method === 'GET' && match[2] && job.state === 'ready') {
      response.writeHead(200, { ...cors, 'Content-Type': 'audio/mpeg', 'Content-Length': job.size })
      return createReadStream(job.file).pipe(response)
    }
    if (job && request.method === 'DELETE') {
      await forgetJob(job.id)
      return send(response, 200, { ok: true }, cors)
    }
    return send(response, 404, { error: 'Non trovato.' }, cors)
  } catch (error) {
    return send(response, 500, { error: error.message }, cors)
  }
}

/** Una copia di questo servizio risponde già su quella porta? */
async function ours(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) })
    return (await response.json()).app === 'musicx-helper'
  } catch {
    return false
  }
}

function listen(port) {
  return new Promise((resolve, reject) => {
    const server = createServer((request, response) => void handle(request, response))
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

async function main() {
  try {
    versions.ytdlp = (await run('yt-dlp', ['--version'])).trim()
  } catch {
    log('yt-dlp non trovato: brew install yt-dlp')
  }
  try {
    await run('ffmpeg', ['-version'])
    versions.ffmpeg = true
  } catch {
    log('ffmpeg non trovato: brew install ffmpeg')
  }
  await mkdir(WORK, { recursive: true })
  for (let port = FIRST_PORT; port <= LAST_PORT; port++) {
    try {
      await listen(port)
      log(`musicx-helper pronto su http://127.0.0.1:${port} (yt-dlp ${versions.ytdlp ?? 'mancante'})`)
      return
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error
      if (!DEV && (await ours(port))) {
        log(`musicx-helper è già in ascolto su http://127.0.0.1:${port}: esco.`)
        process.exit(0)
      }
      log(`porta ${port} occupata da altro, provo la successiva`)
    }
  }
  log(`nessuna porta libera tra ${FIRST_PORT} e ${LAST_PORT}`)
  process.exit(1)
}

void main()
