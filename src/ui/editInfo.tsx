// "Modifica info": titolo, artista, album, numero di traccia e nome del file di un brano, oppure
// artista e album di tanti brani insieme (una cartella, o una selezione sul Mac).

import { useRef, useState, type FormEvent } from 'react'
import { libraryStore, numberInName, stripExtension, trackTitle } from '../lib/library'
import { useStore } from '../lib/store'
import { canWriteTags, saveManyInfo, saveTrackInfo, type InfoChange } from '../lib/trackInfo'
import { finePointer } from './drag'
import { closeSheet, showSheet, toast } from './sheets'
import { errorText, tracksLabel } from './text'

type Field = 'title' | 'artist' | 'album' | 'track' | 'name'

const LABELS: Record<Field, string> = {
  title: 'Titolo',
  artist: 'Artista',
  album: 'Album',
  track: 'Numero traccia',
  name: 'Nome del file',
}

/** Apre il modulo per i brani indicati (quelli fuori dalla libreria vengono ignorati). */
export function editTracksInfo(ids: number[]) {
  const library = libraryStore.get().library
  const known = ids.filter((id) => library?.tracks.has(id))
  if (!known.length) return toast('Questi brani non sono nella libreria.')
  showSheet(<InfoForm ids={known} />)
}

function InfoForm({ ids }: { ids: number[] }) {
  const library = useStore(libraryStore, (state) => state.library)
  const tracks = ids.flatMap((id) => library?.tracks.get(id) ?? [])
  const single = tracks.length === 1 ? tracks[0] : null
  const writable = tracks.filter((track) => canWriteTags(track.name)).length

  // Il valore comune a tutti i brani, o null se sono diversi.
  const common = (key: Exclude<Field, 'name'>) => {
    const values = new Set(tracks.map((track) => track[key] ?? ''))
    return values.size === 1 ? [...values][0] : null
  }
  const fields: Field[] = single ? ['title', 'artist', 'album', 'track', 'name'] : ['artist', 'album']
  const initial = useRef<Record<Field, string> | null>(null)
  initial.current ??= {
    title: common('title') ?? '',
    artist: common('artist') ?? '',
    album: common('album') ?? '',
    track: common('track') ?? '',
    name: single ? stripExtension(single.name) : '',
  }
  // Un brano senza numero di traccia nel tag ma con il numero nel nome ("Track-06"): il numero si
  // propone già, così rinominando il file l'ordine dell'album non si perde.
  const suggested = single && !single.track && canWriteTags(single.name) ? numberInName(single.name) : undefined
  const [values, setValues] = useState(() => ({ ...initial.current!, track: suggested ? String(suggested) : initial.current!.track }))
  const [touched, setTouched] = useState<ReadonlySet<Field>>(() => new Set(suggested ? ['track'] : []))
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const stop = useRef(false)

  const tagsLocked = writable === 0
  const placeholder = (field: Field) => {
    if (!single && common(field as Exclude<Field, 'name'>) === null) return 'Diversi: lascia vuoto per non cambiarli'
    if (single && field === 'title') return `Senza titolo: si vede "${trackTitle(single)}"`
    return ''
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const change: InfoChange = {}
    for (const field of touched) {
      const value = values[field].trim()
      if (value === initial.current![field].trim()) continue
      // Nei campi con valori diversi, lasciarli vuoti vuol dire non cambiarli.
      if (!single && !value) continue
      change[field] = value
    }
    if (!Object.keys(change).length) return closeSheet()
    setError(null)
    stop.current = false

    if (single) {
      setBusy({ done: 0, total: 1 })
      try {
        await saveTrackInfo(single.id, change)
        closeSheet()
        toast('Salvato.')
      } catch (problem) {
        setError(errorText(problem))
        setBusy(null)
      }
      return
    }

    const result = await saveManyInfo(ids, change, (done, total) => setBusy({ done, total }), () => stop.current)
    const parts = [result.saved ? `${tracksLabel(result.saved)} aggiornati` : 'Nessun brano aggiornato']
    if (result.skipped) parts.push(`${result.skipped} non mp3 saltati`)
    if (result.failed) parts.push(`${result.failed} non riusciti: ${errorText(result.firstError)}`)
    closeSheet()
    toast(`${parts.join(', ')}.`)
  }

  const title = single ? 'Modifica info' : `Modifica ${tracksLabel(tracks.length)}`
  return (
    <form className="dialog info-form" onSubmit={(event) => void submit(event)}>
      <div className="sheet-title">{title}</div>
      {single && <p className="info-file">{single.name}</p>}
      {fields.map((field) => {
        const locked = field !== 'name' && tagsLocked
        return (
          <label key={field} className="field">
            <span>{LABELS[field]}</span>
            <span className={field === 'name' ? 'field-file' : undefined}>
              <input
                value={values[field]}
                placeholder={placeholder(field)}
                disabled={locked || busy !== null}
                inputMode={field === 'track' ? 'numeric' : undefined}
                autoFocus={finePointer && field === fields[0] && !locked}
                onChange={(event) => {
                  const value = event.target.value
                  setValues((current) => ({ ...current, [field]: value }))
                  setTouched((current) => new Set(current).add(field))
                }}
              />
              {field === 'name' && single && <em>{single.name.slice(stripExtension(single.name).length)}</em>}
            </span>
          </label>
        )
      })}
      {tagsLocked && (
        <p className="info-note">
          {single ? 'Questo file non è un mp3: per ora posso cambiare solo il nome.' : 'Nessuno di questi file è un mp3: per ora non posso cambiarne i tag.'}
        </p>
      )}
      {!single && writable > 0 && writable < tracks.length && (
        <p className="info-note">{tracks.length - writable} file non sono mp3 e verranno saltati.</p>
      )}
      {!single && writable > 0 && (
        <p className="info-note">Si cambiano solo i campi che modifichi. I titoli si cambiano brano per brano.</p>
      )}
      {error && <p className="info-error">{error}</p>}
      <div className="dialog-actions">
        {busy && !single ? (
          <>
            <span className="info-progress">
              Salvo {Math.min(busy.done + 1, busy.total)} di {busy.total}…
            </span>
            <button type="button" onClick={() => (stop.current = true)}>
              Ferma
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={closeSheet} disabled={busy !== null}>
              Annulla
            </button>
            <button type="submit" className="primary" disabled={busy !== null || (tagsLocked && !single)}>
              {busy ? 'Salvo…' : 'Salva'}
            </button>
          </>
        )}
      </div>
    </form>
  )
}

