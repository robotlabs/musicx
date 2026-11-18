// "Da YouTube" (solo Mac): scrivi il titolo, scegli il video, controlla artista e titolo (dal catalogo
// di iTunes), e il brano finisce in mp3 nella cartella dell'artista su pCloud.

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { libraryStore, toQueueItem, type Library } from '../lib/library'
import type { Step } from '../lib/move'
import { applyLocalEvents } from '../lib/liveLibrary'
import { createFolder, listFolder, uploadFile } from '../lib/pcloud'
import { playItems } from '../lib/player'
import { navigate } from '../lib/router'
import { useStore } from '../lib/store'
import {
  artistFolder,
  findHelper,
  forgetJob,
  guessFromTitle,
  jobFile,
  jobStatus,
  lookupSong,
  safeName,
  searchVideos,
  startDownload,
  type HelperInfo,
  type JobStatus,
  type SongInfo,
  type Video,
} from '../lib/youtube'
import { Icon } from './icons'
import { chooseFolder, stepsTo } from './moveTo'
import { Notice } from './parts'
import { errorText } from './text'

const clock = (seconds: number | null) =>
  seconds === null ? '' : `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`

/** Dove va il brano: una cartella che c'è, o una nuova da creare. */
type Destination = { kind: 'existing'; trail: Step[] } | { kind: 'new'; parent: Step[]; name: string }

const pathText = (trail: Step[]) => trail.map((step) => step.name).join(' ▸ ')

function destinationFor(library: Library, artist: string): Destination {
  const existing = artistFolder(library, artist)
  if (existing !== null) return { kind: 'existing', trail: stepsTo(library, existing) }
  return { kind: 'new', parent: stepsTo(library, library.rootId), name: safeName(artist) || 'Da YouTube' }
}

type Stage =
  | { step: 'form' }
  | { step: 'working'; job: JobStatus | null; uploading: boolean }
  | { step: 'done'; fileId: number; folderId: number; name: string; where: string }
  | { step: 'failed'; message: string }

const stageText = (job: JobStatus | null, uploading: boolean) => {
  if (uploading) return 'Carico su pCloud…'
  switch (job?.state) {
    case 'download':
      return `Scarico da YouTube… ${Math.round(job.progress)}%`
    case 'convert':
      return 'Converto in mp3…'
    case 'tag':
      return 'Scrivo titolo, artista e copertina…'
    default:
      return 'Comincio…'
  }
}

/** Carica il file pronto su pCloud (creando la cartella dell'artista se serve) e lo mette nell'indice. */
async function upload(jobId: string, info: SongInfo, destination: Destination) {
  const data = await jobFile(jobId)
  let folderId: number
  let where: string
  if (destination.kind === 'new') {
    const parentId = destination.parent[destination.parent.length - 1].id
    const made = await createFolder(parentId, destination.name)
    folderId = made.folderid!
    where = pathText([...destination.parent, { id: folderId, name: destination.name }])
    applyLocalEvents([{ event: 'createfolder', diffid: 0, metadata: { ...made, parentfolderid: made.parentfolderid ?? parentId } }])
  } else {
    folderId = destination.trail[destination.trail.length - 1].id
    where = pathText(destination.trail)
  }
  // Un file con lo stesso nome lo sostituirebbe: si aggiunge un numero.
  const taken = new Set(((await listFolder(folderId)).contents ?? []).map((entry) => entry.name.toLocaleLowerCase('it')))
  const base = safeName(`${info.artist} - ${info.title}`) || 'Da YouTube'
  let name = `${base}.mp3`
  for (let n = 2; taken.has(name.toLocaleLowerCase('it')); n++) name = `${base} (${n}).mp3`
  const meta = await uploadFile(folderId, name, data)
  applyLocalEvents([{ event: 'createfile', diffid: 0, metadata: { ...meta, parentfolderid: meta.parentfolderid ?? folderId } }])
  void forgetJob(jobId)
  return { fileId: meta.fileid!, folderId, name, where }
}

function Prepare({ video, query, library, onBack }: { video: Video; query: string; library: Library; onBack: () => void }) {
  const guess = useMemo(() => guessFromTitle(video.title, video.channel), [video])
  const [info, setInfo] = useState<SongInfo>({ artist: guess.artist, title: guess.title })
  const [matches, setMatches] = useState<SongInfo[] | null>(null)
  const [picked, setPicked] = useState<number | null>(null)
  const [destination, setDestination] = useState<Destination>(() => destinationFor(library, guess.artist))
  const [chosenByHand, setChosenByHand] = useState(false)
  const [stage, setStage] = useState<Stage>({ step: 'form' })
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => void (alive.current = false)
  }, [])

  // Il catalogo: la prima corrispondenza riempie i campi, le altre si possono scegliere.
  useEffect(() => {
    let current = true
    lookupSong(`${guess.artist} ${guess.title}`.trim() || query)
      .catch(() => lookupSong(query))
      .then((results) => {
        if (!current) return
        setMatches(results)
        if (results.length) choose(results[0], 0)
      })
      .catch(() => current && setMatches([]))
    return () => void (current = false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video])

  function choose(match: SongInfo, index: number | null) {
    setPicked(index)
    setInfo(match)
    if (!chosenByHand) setDestination(destinationFor(library, match.artist))
  }

  const set = (field: keyof SongInfo, value: string) => {
    setPicked(null)
    setInfo((current) => ({ ...current, [field]: field === 'track' ? Number.parseInt(value, 10) || null : value }))
    if (field === 'artist' && !chosenByHand) setDestination(destinationFor(library, value))
  }

  async function pickFolder() {
    const start = destination.kind === 'existing' ? destination.trail : destination.parent
    const trail = await chooseFolder('Dove lo metto?', { start, current: null, confirm: 'Scegli' })
    if (!trail) return
    setChosenByHand(true)
    setDestination({ kind: 'existing', trail })
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!info.artist.trim() || !info.title.trim()) return
    setStage({ step: 'working', job: null, uploading: false })
    try {
      const id = await startDownload(video.id, { ...info, artist: info.artist.trim(), title: info.title.trim() })
      let job: JobStatus
      for (;;) {
        job = await jobStatus(id)
        if (!alive.current) return
        if (job.state === 'ready' || job.state === 'error') break
        setStage({ step: 'working', job, uploading: false })
        await new Promise((resolve) => setTimeout(resolve, 700))
      }
      if (job.state === 'error') throw new Error(job.error ?? 'Download non riuscito.')
      setStage({ step: 'working', job, uploading: true })
      const result = await upload(id, info, destination)
      if (alive.current) setStage({ step: 'done', ...result })
    } catch (error) {
      if (alive.current) setStage({ step: 'failed', message: errorText(error) })
    }
  }

  const fileName = `${safeName(`${info.artist} - ${info.title}`) || '…'}.mp3`
  const where =
    destination.kind === 'existing' ? pathText(destination.trail) : `${pathText(destination.parent)} ▸ ${destination.name} (nuova cartella)`

  if (stage.step === 'done') {
    const play = () => {
      const library = libraryStore.get().library
      const track = library?.tracks.get(stage.fileId)
      if (library && track) playItems([toQueueItem(library, track)])
    }
    return (
      <section className="yt-panel">
        <h2>
          <Icon name="check" size={20} /> Aggiunto
        </h2>
        <p>
          <strong>{stage.name}</strong>
        </p>
        <p className="dim">in {stage.where}</p>
        <div className="head-actions">
          <button className="pill primary" onClick={play}>
            <Icon name="play" size={16} /> Riproduci
          </button>
          <button className="pill" onClick={() => navigate({ name: 'folder', id: stage.folderId })}>
            <Icon name="folder" size={16} /> Vai alla cartella
          </button>
          <button className="pill" onClick={onBack}>
            <Icon name="search" size={16} /> Cerca un altro
          </button>
        </div>
      </section>
    )
  }

  const working = stage.step === 'working'
  return (
    <form className="yt-panel" onSubmit={(event) => void submit(event)}>
      <div className="yt-video">
        <img src={video.thumbnail} alt="" width="160" height="90" />
        <div>
          <strong>{video.title}</strong>
          <p className="dim">
            {video.channel}
            {video.duration ? ` · ${clock(video.duration)}` : ''}
          </p>
        </div>
      </div>

      {matches === null && <p className="dim">Cerco titolo e copertina giusti…</p>}
      {matches && matches.length > 0 && (
        <div className="yt-matches" role="list" aria-label="Dal catalogo">
          {matches.slice(0, 5).map((match, index) => (
            <button
              type="button"
              key={`${match.artist}-${match.title}-${index}`}
              className={`yt-match${picked === index ? ' on' : ''}`}
              disabled={working}
              onClick={() => choose(match, index)}
            >
              {match.cover ? <img src={match.cover.replace('600x600bb', '100x100bb')} alt="" width="44" height="44" /> : <Icon name="music" />}
              <span>
                <strong>{match.title}</strong>
                <span className="dim">
                  {match.artist}
                  {match.album ? ` · ${match.album}` : ''}
                  {match.year ? ` (${match.year})` : ''}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="yt-fields">
        <label className="field">
          <span>Artista</span>
          <input value={info.artist} disabled={working} onChange={(event) => set('artist', event.target.value)} />
        </label>
        <label className="field">
          <span>Titolo</span>
          <input value={info.title} disabled={working} onChange={(event) => set('title', event.target.value)} />
        </label>
        <label className="field">
          <span>Album</span>
          <input value={info.album ?? ''} disabled={working} onChange={(event) => set('album', event.target.value)} />
        </label>
        <label className="field yt-small">
          <span>Traccia</span>
          <input value={info.track ?? ''} inputMode="numeric" disabled={working} onChange={(event) => set('track', event.target.value)} />
        </label>
        <label className="field yt-small">
          <span>Anno</span>
          <input value={info.year ?? ''} inputMode="numeric" disabled={working} onChange={(event) => set('year', event.target.value)} />
        </label>
      </div>

      <div className="yt-where">
        <Icon name="folder" size={18} />
        <span>
          <span>{where}</span>
          <span className="dim">{fileName}</span>
        </span>
        <button type="button" className="pill small" disabled={working} onClick={() => void pickFolder()}>
          Cambia…
        </button>
      </div>

      {working && (
        <div className="yt-progress" role="status">
          <span>{stageText(stage.job, stage.uploading)}</span>
          <progress max={100} value={stage.uploading ? 100 : (stage.job?.progress ?? 0)} />
        </div>
      )}
      {stage.step === 'failed' && <p className="login-notice">{stage.message}</p>}

      <div className="head-actions">
        <button className="pill primary" type="submit" disabled={working || !info.artist.trim() || !info.title.trim()}>
          <Icon name="download" size={16} /> {stage.step === 'failed' ? 'Riprova' : 'Scarica e aggiungi'}
        </button>
        <button className="pill" type="button" disabled={working} onClick={onBack}>
          Indietro
        </button>
      </div>
    </form>
  )
}

export function YouTubeView() {
  const library = useStore(libraryStore, (state) => state.library)
  const [helper, setHelper] = useState<HelperInfo | null | undefined>(undefined)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Video[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [video, setVideo] = useState<Video | null>(null)

  useEffect(() => {
    void findHelper().then(setHelper)
  }, [])

  async function search(event: FormEvent) {
    event.preventDefault()
    const text = query.trim()
    if (!text) return
    setSearching(true)
    setProblem(null)
    setVideo(null)
    try {
      setResults(await searchVideos(text))
    } catch (error) {
      setProblem(errorText(error))
    } finally {
      setSearching(false)
    }
  }

  if (helper === undefined) return <Notice loading title="Cerco il servizio YouTube sul Mac…" />
  if (helper === null) {
    return (
      <Notice
        title="Il servizio YouTube non è acceso"
        body="Sul Mac scarica e converte i brani un piccolo servizio di musicx. Si installa una volta, dal Terminale nella cartella di musicx: ./helper/install.sh (servono yt-dlp e ffmpeg: brew install yt-dlp ffmpeg)."
        action={{ label: 'Riprova', run: () => void findHelper().then(setHelper) }}
      />
    )
  }
  if (!library) return <Notice loading title="Leggo la libreria…" />

  return (
    <>
      <header className="view-head">
        <h1>Da YouTube</h1>
        <p className="dim">Scrivi il titolo: il brano finisce in mp3 nella cartella dell'artista, con titolo e copertina giusti.</p>
      </header>
      {video ? (
        <Prepare key={video.id} video={video} query={query} library={library} onBack={() => setVideo(null)} />
      ) : (
        <>
          <form className="yt-search" onSubmit={(event) => void search(event)}>
            <input
              type="search"
              value={query}
              placeholder="Titolo della canzone (e artista)"
              aria-label="Cerca su YouTube"
              autoFocus
              onChange={(event) => setQuery(event.target.value)}
            />
            <button className="pill primary" type="submit" disabled={searching || !query.trim()}>
              <Icon name="search" size={16} /> Cerca
            </button>
          </form>
          {searching && <Notice loading title="Cerco su YouTube…" />}
          {problem && <p className="login-notice">{problem}</p>}
          {!searching && results && results.length === 0 && <Notice title="Niente trovato" body="Prova con altre parole." />}
          {!searching && results && results.length > 0 && (
            <ul className="rows yt-results">
              {results.map((result) => (
                <li className="row" key={result.id}>
                  <button className="row-main" onClick={() => setVideo(result)}>
                    <img className="yt-thumb" src={result.thumbnail} alt="" width="96" height="54" loading="lazy" />
                    <span className="row-text">
                      <span className="row-title">{result.title}</span>
                      <span className="row-sub">
                        {result.channel}
                        {result.duration ? ` · ${clock(result.duration)}` : ''}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  )
}
