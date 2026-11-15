import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { MUSIC_ROOT } from '../config'
import { clearAuth } from '../lib/auth'
import { clearLibrary, initLibrary, libraryStore, refreshLibrary } from '../lib/library'
import { isOpen, loadOpenGroups, openGroupsStore, setGroupOpen, toggleGroup } from '../lib/openGroups'
import { accountEmail, endSession } from '../lib/pcloud'
import { initPlayer, playerStore, resetPlayer, toggle } from '../lib/player'
import { groupPlaylists, playlistsStore, refreshPlaylists, resetPlaylists, type Playlist } from '../lib/playlists'
import { navigate, routeHref, routeStore, type Route } from '../lib/router'
import { useStore } from '../lib/store'
import { FolderView } from './FolderView'
import { Icon, type IconName } from './icons'
import { PlayerBar } from './PlayerBar'
import { PlaylistsView } from './PlaylistsView'
import { PlaylistView } from './PlaylistView'
import { QueueView } from './QueueView'
import { SearchView } from './SearchView'
import { addTracksTo } from './actions'
import { dragStore, takeDrag, type DragPayload } from './dragTracks'
import { openCreateMenu, openGroupMenu } from './playlistActions'
import { confirmAction, createPlaylistFlow, openMenu, SheetHost, toast } from './sheets'
import { tracksLabel } from './text'

async function logout() {
  const sure = await confirmAction('Uscire da pCloud?', 'Su questo dispositivo dovrai accedere di nuovo. Musica e playlist restano su pCloud.', 'Esci')
  if (!sure) return
  resetPlayer()
  resetPlaylists()
  await clearLibrary()
  await endSession()
  clearAuth()
}

async function refresh() {
  toast('Aggiorno la libreria…')
  await Promise.all([refreshLibrary(), refreshPlaylists()])
  const { library, error } = libraryStore.get()
  toast(error ?? `Libreria aggiornata: ${tracksLabel(library?.tracks.size ?? 0)}.`)
}

/** Email dell'account, letta una volta all'avvio per mostrarla nel menu. */
let account: string | null = null

function openAppMenu() {
  const { library } = libraryStore.get()
  const updated = library ? new Date(library.builtAt).toLocaleString('it', { dateStyle: 'short', timeStyle: 'short' }) : null
  const details = [account, `cartella ${MUSIC_ROOT}`, updated && `aggiornata ${updated}`].filter(Boolean).join(' · ')
  openMenu(
    'musicx',
    [
      { label: 'Aggiorna la libreria da pCloud', icon: 'refresh', onSelect: () => void refresh() },
      { label: 'Esci da pCloud', icon: 'logout', danger: true, onSelect: () => void logout() },
    ],
    details,
  )
}

function SearchBox({ route }: { route: Route }) {
  const input = useRef<HTMLInputElement>(null)
  const searching = route.name === 'search'

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable]')
      if (typing) return
      if (event.key === '/') {
        event.preventDefault()
        input.current?.focus()
      } else if (event.key === ' ' && !(event.target instanceof HTMLElement && event.target.closest('button, a'))) {
        event.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="search">
      <Icon name="search" size={18} />
      <input
        ref={input}
        type="search"
        enterKeyHint="search"
        placeholder="Cerca brani, artisti, cartelle"
        aria-label="Cerca nella libreria"
        value={searching ? route.query : ''}
        // Entrare nella ricerca aggiunge una voce alla cronologia; digitare la sostituisce.
        onFocus={() => !searching && navigate({ name: 'search', query: '' })}
        onChange={(event) => navigate({ name: 'search', query: event.target.value }, { replace: searching })}
        onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
      />
    </div>
  )
}

const sections: { route: Route; label: string; icon: IconName; match: Route['name'][] }[] = [
  { route: { name: 'folder', id: null }, label: 'Libreria', icon: 'music', match: ['folder', 'search'] },
  { route: { name: 'playlists' }, label: 'Playlist', icon: 'list', match: ['playlists', 'playlist'] },
  { route: { name: 'queue' }, label: 'Coda', icon: 'queue', match: ['queue'] },
]

function SidePlaylists({ route }: { route: Route }) {
  const lists = useStore(playlistsStore, (state) => state.lists)
  const open = useStore(openGroupsStore)
  const { groups, loose } = useMemo(() => groupPlaylists(lists), [lists])
  const currentId = route.name === 'playlist' ? route.id : null
  const currentGroup = lists.find((list) => list.id === currentId)?.group ?? null

  // Aprendo una playlist di un gruppo, il gruppo si apre a lato.
  useEffect(() => {
    if (currentGroup) setGroupOpen(currentGroup, true)
  }, [currentId, currentGroup])

  // Brani trascinati dalla pagina: ogni playlist li accetta, un gruppo chiuso si apre se ci si ferma sopra.
  const dragging = useStore(dragStore) !== null
  const [over, setOver] = useState<string | null>(null)
  const openTimer = useRef(0)
  useEffect(() => {
    if (dragging) return
    setOver(null)
    clearTimeout(openTimer.current)
  }, [dragging])

  const leave = (key: string) => (event: DragEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    if (key.startsWith('g')) clearTimeout(openTimer.current)
    setOver((current) => (current === key ? null : current))
  }

  const dropOn = (key: string, onDrop: (payload: DragPayload) => void) =>
    dragging
      ? {
          onDragEnter: (event: DragEvent) => {
            event.preventDefault()
            setOver(key)
          },
          onDragOver: (event: DragEvent) => {
            event.preventDefault()
            event.dataTransfer.dropEffect = 'copy'
          },
          onDragLeave: leave(key),
          onDrop: (event: DragEvent) => {
            event.preventDefault()
            setOver(null)
            const payload = takeDrag()
            if (payload) onDrop(payload)
          },
        }
      : {}

  const openWhileDragging = (group: string, expanded: boolean) =>
    dragging
      ? {
          onDragEnter: () => {
            setOver(`g${group}`)
            clearTimeout(openTimer.current)
            if (!expanded) openTimer.current = window.setTimeout(() => setGroupOpen(group, true), 500)
          },
          onDragLeave: leave(`g${group}`),
        }
      : {}

  const newPlaylistWith = async (payload: DragPayload) => {
    const id = await createPlaylistFlow(payload.ids.length > 1 ? payload.label : '')
    if (id !== null) await addTracksTo(id, payload.ids)
  }

  const link = (list: Playlist, nested: boolean) => (
    <a
      key={list.id}
      href={routeHref({ name: 'playlist', id: list.id })}
      className={[nested && 'nested', list.id === currentId && 'current', over === `p${list.id}` && 'drop-over']
        .filter(Boolean)
        .join(' ')}
      {...dropOn(`p${list.id}`, (payload) => void addTracksTo(list.id, payload.ids))}
    >
      {list.title}
    </a>
  )

  return (
    <nav className={`side-lists${dragging ? ' dragging' : ''}`}>
      {dragging && (
        <div className={`side-drop-new${over === 'new' ? ' drop-over' : ''}`} {...dropOn('new', (payload) => void newPlaylistWith(payload))}>
          <Icon name="plus" size={16} /> Nuova playlist
        </div>
      )}
      {groups.map((group) => {
        const expanded = isOpen(open, group.name)
        return (
          <Fragment key={group.name}>
            <button
              className={`side-group${expanded ? ' open' : ''}${over === `g${group.name}` ? ' drop-hover' : ''}`}
              aria-expanded={expanded}
              onClick={() => toggleGroup(group.name)}
              onContextMenu={(event) => {
                event.preventDefault()
                openGroupMenu(group)
              }}
              {...openWhileDragging(group.name, expanded)}
            >
              <span className="disclosure">
                <Icon name="chevron" size={14} />
              </span>
              <span className="side-group-name">{group.name}</span>
            </button>
            {expanded && group.lists.map((list) => link(list, true))}
          </Fragment>
        )
      })}
      {loose.map((list) => link(list, false))}
    </nav>
  )
}

function Sidebar({ route }: { route: Route }) {
  return (
    <aside className="sidebar">
      <a className="brand" href="#/">
        <img src="./favicon.svg" alt="" width="28" height="28" />
        musicx
      </a>
      <nav>
        {sections.map((section) => (
          <a
            key={section.label}
            href={routeHref(section.route)}
            className={section.match.includes(route.name) && route.name !== 'playlist' ? 'current' : ''}
          >
            <Icon name={section.icon} size={18} /> {section.label}
          </a>
        ))}
      </nav>
      <div className="side-title">
        Playlist
        <button className="icon-button" aria-label="Nuova playlist o gruppo" onClick={openCreateMenu}>
          <Icon name="plus" size={18} />
        </button>
      </div>
      <SidePlaylists route={route} />
    </aside>
  )
}

function Tabs({ route }: { route: Route }) {
  return (
    <nav className="tabs">
      {sections.map((section) => (
        <a key={section.label} href={routeHref(section.route)} className={section.match.includes(route.name) ? 'current' : ''}>
          <Icon name={section.icon} />
          {section.label}
        </a>
      ))}
    </nav>
  )
}

const routeKey = (route: Route) => (route.name === 'search' ? 'search' : routeHref(route))

export function Main() {
  const route = useStore(routeStore)
  const refreshing = useStore(libraryStore, (state) => state.refreshing)
  const title = useStore(playerStore, (state) => (state.playing ? state.items[state.index]?.title : undefined))

  useEffect(() => {
    loadOpenGroups()
    initPlayer()
    void initLibrary()
    void refreshPlaylists()
    accountEmail().then(
      (email) => (account = email),
      () => {},
    )
  }, [])

  useEffect(() => {
    document.title = title ? `▶ ${title} · musicx` : 'musicx'
  }, [title])

  // Ogni pagina ricorda dove era arrivato lo scorrimento, così "indietro" riporta nello stesso punto.
  const content = useRef<HTMLElement>(null)
  const scrolls = useRef(new Map<string, number>())
  const key = routeKey(route)
  useLayoutEffect(() => {
    if (content.current) content.current.scrollTop = scrolls.current.get(key) ?? 0
  }, [key])

  return (
    <div className="app">
      <Sidebar route={route} />
      <header className="top">
        <SearchBox route={route} />
        {refreshing && <span className="spinner small" role="status" aria-label="Aggiorno la libreria" />}
        <button className="icon-button" aria-label="Menu dell'app" onClick={openAppMenu}>
          <Icon name="more" />
        </button>
      </header>
      <main
        className="content"
        ref={content}
        onScroll={(event) => scrolls.current.set(key, event.currentTarget.scrollTop)}
      >
        {route.name === 'folder' && <FolderView id={route.id} />}
        {route.name === 'search' && <SearchView query={route.query} />}
        {route.name === 'playlists' && <PlaylistsView />}
        {route.name === 'playlist' && <PlaylistView id={route.id} key={route.id} />}
        {route.name === 'queue' && <QueueView />}
      </main>
      <PlayerBar />
      <Tabs route={route} />
      <SheetHost />
    </div>
  )
}
