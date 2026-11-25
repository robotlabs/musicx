// Le pagine dei tag: "Tag" (tutti) e un tag solo, con le sue cartelle, playlist e brani e tutta la
// musica da suonare insieme. Più i tag in testa alle pagine di cartelle e playlist.

import { useEffect, useMemo } from 'react'
import { libraryStore, queueItems, toQueueItem, tracksUnder, type Library } from '../lib/library'
import { playerStore } from '../lib/player'
import { loadPlaylist, playlistsStore, type Playlist, type PlaylistTrack } from '../lib/playlists'
import type { QItem } from '../lib/queue'
import { navigate, routeHref, type Route } from '../lib/router'
import { useStore } from '../lib/store'
import { deleteTag, findTag, loadTags, removeTag, renameTag, tagKey, tagStore, tagsOf, type Tag, type TagTarget } from '../lib/tags'
import { openTrackMenu, queueMenuItems } from './actions'
import { Icon } from './icons'
import { Notice, TrackRow } from './parts'
import { playItems, playShuffled } from './play'
import { useSelection } from './selection'
import { askText, confirmAction, openMenu, toast, type MenuItem } from './sheets'
import { errorText, tracksLabel } from './text'

const tagRoute = (name: string): Route => ({ name: 'tag', tag: name })
const report = (task: Promise<unknown>) => void task.catch((error: unknown) => toast(errorText(error)))

/** I tag di una cartella o playlist, in testa alla sua pagina: un clic porta al tag. */
export function TagChips({ target }: { target: TagTarget }) {
  const tags = useStore(tagStore, (state) => state.tags)
  const mine = useMemo(() => tagsOf(tags, target), [tags, target.kind, target.id])
  if (!mine.length) return null
  return (
    <div className="tag-chips">
      {mine.map((tag) => (
        <a key={tag.name} className="tag-chip" href={routeHref(tagRoute(tag.name))}>
          <Icon name="tag" size={12} />
          {tag.name}
        </a>
      ))}
    </div>
  )
}

interface Resolved {
  folders: { id: number; name: string; total: number }[]
  playlists: Playlist[]
  tracks: QItem[]
  /** Tutta la musica del tag, senza doppioni, nell'ordine in cui le cose sono state aggiunte. */
  all: QItem[]
}

/** Quello che c'è davvero dietro un tag (cose cancellate nel frattempo si saltano). */
function resolve(tag: Tag, library: Library | null, lists: Playlist[], listTracks: Record<number, PlaylistTrack[] | undefined>): Resolved {
  const result: Resolved = { folders: [], playlists: [], tracks: [], all: [] }
  const seen = new Set<number>()
  const add = (items: QItem[]) => {
    for (const item of items) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      result.all.push(item)
    }
  }
  for (const item of tag.items) {
    if (item.kind === 'folder') {
      const folder = library?.folders.get(item.id)
      if (!folder || !library) continue
      result.folders.push({ id: folder.id, name: folder.name, total: folder.total })
      add(queueItems(library, tracksUnder(library, folder.id)))
    } else if (item.kind === 'playlist') {
      const list = lists.find((entry) => entry.id === item.id)
      if (!list) continue
      result.playlists.push(list)
      add(listTracks[list.id] ?? [])
    } else {
      const track = library?.tracks.get(item.id)
      if (!track || !library) continue
      const queued = toQueueItem(library, track)
      result.tracks.push(queued)
      add([queued])
    }
  }
  return result
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

function summary(tag: Tag) {
  const count = (kind: TagTarget['kind']) => tag.items.filter((item) => item.kind === kind).length
  return [
    count('folder') && plural(count('folder'), 'cartella', 'cartelle'),
    count('playlist') && plural(count('playlist'), 'playlist', 'playlist'),
    count('track') && plural(count('track'), 'brano', 'brani'),
  ]
    .filter(Boolean)
    .join(' · ')
}

/** Riga di un tag (pagina Tag e ricerca). */
export function TagRow({ tag }: { tag: Tag }) {
  return (
    <li className="row">
      <a className="row-main" href={routeHref(tagRoute(tag.name))}>
        <span className="row-icon folder">
          <Icon name="tag" size={18} />
        </span>
        <span className="row-text">
          <span className="row-title">{tag.name}</span>
          <span className="row-sub">{summary(tag)}</span>
        </span>
      </a>
    </li>
  )
}

export function TagsView() {
  const { tags, loaded, error } = useStore(tagStore)
  useEffect(() => {
    void loadTags()
  }, [])
  return (
    <>
      <header className="view-head">
        <h1>Tag</h1>
        <p className="dim">{tags.length ? plural(tags.length, 'tag', 'tag') : loaded ? 'Ancora nessun tag' : 'Leggo i tag…'}</p>
      </header>
      {error && <Notice title="Non riesco a leggere i tag" body={error} action={{ label: 'Riprova', run: () => void loadTags() }} />}
      {loaded && !error && !tags.length && (
        <Notice
          title="Ancora nessun tag"
          body='Dal menu ⋯ di una cartella, di una playlist o di un brano scegli "Tag…" e scrivine uno (es. "cena", "corsa"). Poi lo ritrovi qui e nella ricerca, con tutta la sua musica.'
        />
      )}
      <ul className="rows">
        {tags.map((tag) => (
          <TagRow key={tag.name} tag={tag} />
        ))}
      </ul>
    </>
  )
}

export function TagView({ name }: { name: string }) {
  const tag = useStore(tagStore, (state) => state.tags.find((entry) => tagKey(entry.name) === tagKey(name)))
  const loaded = useStore(tagStore, (state) => state.loaded)
  const library = useStore(libraryStore, (state) => state.library)
  const lists = useStore(playlistsStore, (state) => state.lists)
  const listTracks = useStore(playlistsStore, (state) => state.tracks)
  const current = useStore(playerStore, (state) => state.items[state.index]?.id)
  const playing = useStore(playerStore, (state) => state.playing)

  useEffect(() => {
    void loadTags()
  }, [])

  // Le playlist del tag: i loro brani si leggono da pCloud (se non ci sono già).
  const playlistIds = (tag?.items ?? []).filter((item) => item.kind === 'playlist').map((item) => item.id)
  const missing = playlistIds.filter((id) => !listTracks[id]).join(',')
  useEffect(() => {
    for (const id of missing ? missing.split(',').map(Number) : []) void loadPlaylist(id).catch(() => {})
  }, [missing])

  const found = useMemo(() => (tag ? resolve(tag, library, lists, listTracks) : null), [tag, library, lists, listTracks])
  const selection = useSelection(found?.tracks ?? [], name)

  if (!tag || !found) {
    if (!loaded) return <Notice loading title="Leggo i tag…" />
    return (
      <Notice
        title="Tag non trovato"
        body="Forse è stato tolto da tutto o rinominato."
        action={{ label: 'Tutti i tag', run: () => navigate({ name: 'tags' }) }}
      />
    )
  }

  const own = tag.name
  const untag = (target: TagTarget): MenuItem => ({
    label: `Togli il tag "${own}"`,
    icon: 'close',
    onSelect: () => report(removeTag(own, [target])),
  })

  const openTagMenu = () =>
    openMenu(
      own,
      [
        ...queueMenuItems(found.all),
        {
          label: 'Rinomina tag',
          icon: 'edit',
          onSelect: async () => {
            const next = await askText('Rinomina tag', { initial: own, confirm: 'Rinomina' })
            if (!next) return
            try {
              await renameTag(own, next)
              const renamed = findTag(next)
              if (renamed) navigate(tagRoute(renamed.name), { replace: true })
            } catch (error) {
              toast(errorText(error))
            }
          },
        },
        {
          label: 'Elimina tag',
          icon: 'trash',
          danger: true,
          onSelect: async () => {
            const sure = await confirmAction(`Eliminare il tag "${own}"?`, 'Sparisce da cartelle, playlist e brani. La musica resta dov\'è.', 'Elimina')
            if (!sure) return
            navigate({ name: 'tags' }, { replace: true })
            report(deleteTag(own))
          },
        },
      ],
      summary(tag),
    )

  const groupMenu = (title: string, items: QItem[], target: TagTarget, route: Route) =>
    openMenu(
      title,
      [
        { label: 'Riproduci', icon: 'play', onSelect: () => playItems(items, 0, route) },
        { label: 'Riproduci in ordine casuale', icon: 'shuffle', onSelect: () => playShuffled(items, route) },
        ...queueMenuItems(items),
        untag(target),
      ],
      tracksLabel(items.length),
    )

  return (
    <>
      <nav className="crumbs" aria-label="Percorso">
        <span>
          <a href={routeHref({ name: 'tags' })}>Tag</a>
          <Icon name="chevron" size={14} />
        </span>
      </nav>
      <header className="view-head">
        <h1>{own}</h1>
        <p className="dim">
          {[summary(tag), found.all.length && tracksLabel(found.all.length) + ' in tutto'].filter(Boolean).join(' · ')}
        </p>
        <div className="head-actions">
          {found.all.length > 0 && (
            <>
              <button className="pill primary" onClick={() => playItems(found.all)}>
                <Icon name="play" size={16} /> Riproduci
              </button>
              <button className="pill" onClick={() => playShuffled(found.all)}>
                <Icon name="shuffle" size={16} /> Casuale
              </button>
            </>
          )}
          <button className="icon-button" aria-label="Altre azioni" onClick={openTagMenu}>
            <Icon name="more" />
          </button>
        </div>
      </header>

      {found.folders.length > 0 && (
        <>
          <h2 className="section">Cartelle</h2>
          <ul className="rows">
            {found.folders.map((folder) => (
              <li className="row" key={folder.id}>
                <a className="row-main" href={routeHref({ name: 'folder', id: folder.id })}>
                  <span className="row-icon folder">
                    <Icon name="folder" size={18} />
                  </span>
                  <span className="row-text">
                    <span className="row-title">{folder.name}</span>
                    <span className="row-sub">{tracksLabel(folder.total)}</span>
                  </span>
                </a>
                <button
                  className="icon-button"
                  aria-label={`Azioni per ${folder.name}`}
                  onClick={() =>
                    groupMenu(
                      folder.name,
                      library ? queueItems(library, tracksUnder(library, folder.id)) : [],
                      { kind: 'folder', id: folder.id },
                      { name: 'folder', id: folder.id },
                    )
                  }
                >
                  <Icon name="more" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {found.playlists.length > 0 && (
        <>
          <h2 className="section">Playlist</h2>
          <ul className="rows">
            {found.playlists.map((list) => (
              <li className="row" key={list.id}>
                <a className="row-main" href={routeHref({ name: 'playlist', id: list.id })}>
                  <span className="row-icon folder">
                    <Icon name="list" size={18} />
                  </span>
                  <span className="row-text">
                    <span className="row-title">{list.title}</span>
                    <span className="row-sub">{[list.group, tracksLabel(list.count)].filter(Boolean).join(' · ')}</span>
                  </span>
                </a>
                <button
                  className="icon-button"
                  aria-label={`Azioni per ${list.title}`}
                  onClick={() => groupMenu(list.title, listTracks[list.id] ?? [], { kind: 'playlist', id: list.id }, { name: 'playlist', id: list.id })}
                >
                  <Icon name="more" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {found.tracks.length > 0 && (
        <>
          <h2 className="section">Brani</h2>
          <ul className="rows">
            {found.tracks.map((item, index) => (
              <TrackRow
                key={item.id}
                item={item}
                active={item.id === current}
                playing={playing}
                onPlay={() => playItems(found.tracks, index)}
                drag={() => selection.dragFrom(index)}
                selected={selection.rows.has(index)}
                onSelect={selection.select && ((event) => selection.select?.(index, event))}
                onMenu={() =>
                  openTrackMenu(item, {
                    parent: library?.tracks.get(item.id)?.parent,
                    extra: [untag({ kind: 'track', id: item.id })],
                    selected: selection.selectedWith(index)?.map((row) => found.tracks[row]),
                  })
                }
              />
            ))}
          </ul>
        </>
      )}
    </>
  )
}
