// Pannelli sovrapposti (menu, richieste di testo, conferme) e avvisi brevi.
// Si aprono con una chiamata di funzione da qualunque punto: <SheetHost /> li disegna.

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { createPlaylist, playlistsStore } from '../lib/playlists'
import { createStore, useStore } from '../lib/store'
import { Icon, type IconName } from './icons'
import { errorText } from './text'

interface Sheet {
  node: ReactNode
  /** Chiamata se l'utente chiude il pannello senza scegliere. */
  onDismiss?: () => void
}

const sheetStore = createStore<Sheet | null>(null)

/** C'è un menu o un dialogo aperto: i tasti rapidi della pagina stanno fermi. */
export const sheetOpen = () => sheetStore.get() !== null
const toastStore = createStore<{ id: number; text: string } | null>(null)

/** Apre un pannello qualsiasi (sostituisce quello aperto). */
export function showSheet(node: ReactNode, onDismiss?: () => void) {
  sheetStore.set({ node, onDismiss })
}

/** Chiude il pannello senza chiamare `onDismiss`. */
export function closeSheet() {
  sheetStore.set(null)
}

/** Chiude il pannello come col clic fuori (chi aspettava una risposta riceve "annullato"). */
export function dismissSheet() {
  const sheet = sheetStore.get()
  sheetStore.set(null)
  sheet?.onDismiss?.()
}

let lastToast = 0

/** Avviso che sparisce da solo. */
export function toast(text: string) {
  const id = ++lastToast
  toastStore.set({ id, text })
  setTimeout(() => {
    if (toastStore.get()?.id === id) toastStore.set(null)
  }, 3500)
}

export interface MenuItem {
  label: string
  icon?: IconName
  danger?: boolean
  onSelect: () => void
}

export function openMenu(title: string, items: MenuItem[], subtitle?: string) {
  const select = (item: MenuItem) => {
    sheetStore.set(null)
    item.onSelect()
  }
  sheetStore.set({
    node: (
      <>
        <header className="sheet-head">
          <div className="sheet-title">{title}</div>
          {subtitle && <div className="sheet-sub">{subtitle}</div>}
        </header>
        <ul className="menu">
          {items.map((item) => (
            <li key={item.label}>
              <button className={item.danger ? 'danger' : ''} onClick={() => select(item)}>
                {item.icon && <Icon name={item.icon} />}
                <span>{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </>
    ),
  })
}

function TextPrompt(props: {
  title: string
  initial: string
  placeholder?: string
  confirm: string
  onDone: (value: string | null) => void
}) {
  const [value, setValue] = useState(props.initial)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const text = value.trim()
    if (text) props.onDone(text)
  }
  return (
    <form className="dialog" onSubmit={submit}>
      <div className="sheet-title">{props.title}</div>
      <input
        autoFocus
        value={value}
        placeholder={props.placeholder}
        onChange={(event) => setValue(event.target.value)}
        onFocus={(event) => event.target.select()}
      />
      <div className="dialog-actions">
        <button type="button" onClick={() => props.onDone(null)}>
          Annulla
        </button>
        <button type="submit" className="primary" disabled={!value.trim()}>
          {props.confirm}
        </button>
      </div>
    </form>
  )
}

/** Chiede una riga di testo. Restituisce null se annullato. */
export function askText(
  title: string,
  options: { initial?: string; placeholder?: string; confirm?: string } = {},
): Promise<string | null> {
  return new Promise((resolve) => {
    const done = (value: string | null) => {
      sheetStore.set(null)
      resolve(value)
    }
    sheetStore.set({
      node: (
        <TextPrompt
          title={title}
          initial={options.initial ?? ''}
          placeholder={options.placeholder}
          confirm={options.confirm ?? 'OK'}
          onDone={done}
        />
      ),
      onDismiss: () => resolve(null),
    })
  })
}

/** Chiede conferma per un'azione. */
export function confirmAction(title: string, body: string, confirm: string): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (value: boolean) => {
      sheetStore.set(null)
      resolve(value)
    }
    sheetStore.set({
      node: (
        <div className="dialog">
          <div className="sheet-title">{title}</div>
          <p>{body}</p>
          <div className="dialog-actions">
            <button onClick={() => done(false)}>Annulla</button>
            <button className="primary danger" onClick={() => done(true)}>
              {confirm}
            </button>
          </div>
        </div>
      ),
      onDismiss: () => resolve(false),
    })
  })
}

/** Chiede il nome e crea una playlist (dentro `group`, se dato). Restituisce l'id, o null se annullato o fallito. */
export async function createPlaylistFlow(initial = '', group: string | null = null): Promise<number | null> {
  const title = group ? `Nuova playlist in "${group}"` : 'Nuova playlist'
  const name = await askText(title, { initial, placeholder: 'Nome', confirm: 'Crea' })
  if (!name) return null
  try {
    return await createPlaylist(name, group)
  } catch (error) {
    toast(errorText(error))
    return null
  }
}

function PlaylistPicker(props: {
  title: string
  confirm: string
  exclude: Set<number>
  preselected: number[]
  onDone: (ids: number[] | null) => void
}) {
  const lists = useStore(playlistsStore, (state) => state.lists)
  const [chosen, setChosen] = useState(() => new Set(props.preselected))
  const shown = lists.filter((list) => !props.exclude.has(list.id))
  const toggle = (id: number) =>
    setChosen((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  return (
    <div className="picker">
      <header className="sheet-head">
        <div className="sheet-title">{props.title}</div>
        <div className="sheet-sub">{chosen.size === 1 ? '1 playlist scelta' : `${chosen.size} playlist scelte`}</div>
      </header>
      <ul className="menu checklist">
        {shown.map((list) => (
          <li key={list.id}>
            <label>
              <input type="checkbox" checked={chosen.has(list.id)} onChange={() => toggle(list.id)} />
              <span>{list.title}</span>
              {list.group && <small>{list.group}</small>}
            </label>
          </li>
        ))}
      </ul>
      <div className="dialog-actions picker-actions">
        <button onClick={() => props.onDone(null)}>Annulla</button>
        <button className="primary" disabled={chosen.size === 0} onClick={() => props.onDone([...chosen])}>
          {props.confirm}
        </button>
      </div>
    </div>
  )
}

/** Fa spuntare più playlist. Restituisce gli id scelti, o null se annullato. */
export function choosePlaylists(
  title: string,
  options: { confirm: string; exclude?: number[]; preselected?: number[] },
): Promise<number[] | null> {
  return new Promise((resolve) => {
    const done = (ids: number[] | null) => {
      sheetStore.set(null)
      resolve(ids)
    }
    sheetStore.set({
      node: (
        <PlaylistPicker
          title={title}
          confirm={options.confirm}
          exclude={new Set(options.exclude)}
          preselected={options.preselected ?? []}
          onDone={done}
        />
      ),
      onDismiss: () => resolve(null),
    })
  })
}

const nameCollator = new Intl.Collator('it', { numeric: true, sensitivity: 'base' })

function PlaylistChoices({ onDone }: { onDone: (id: number | 'new') => void }) {
  // Per nome completo, così le playlist dello stesso gruppo stanno vicine ("CCCP ▸ …").
  const lists = useStore(playlistsStore, (state) => state.lists)
  const sorted = useMemo(() => [...lists].sort((a, b) => nameCollator.compare(a.name, b.name)), [lists])
  return (
    <>
      <header className="sheet-head">
        <div className="sheet-title">Aggiungi a playlist</div>
      </header>
      <ul className="menu">
        <li>
          <button onClick={() => onDone('new')}>
            <Icon name="plus" />
            <span>Nuova playlist…</span>
          </button>
        </li>
        {sorted.map((list) => (
          <li key={list.id}>
            <button onClick={() => onDone(list.id)}>
              <Icon name="list" />
              <span>{list.name}</span>
              <small>{list.count}</small>
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}

/** Fa scegliere una playlist esistente o crearne una. Restituisce l'id, o null se annullato. */
export async function choosePlaylist(): Promise<number | null> {
  const choice = await new Promise<number | 'new' | null>((resolve) => {
    const done = (value: number | 'new') => {
      sheetStore.set(null)
      resolve(value)
    }
    sheetStore.set({ node: <PlaylistChoices onDone={done} />, onDismiss: () => resolve(null) })
  })
  return choice === 'new' ? createPlaylistFlow() : choice
}

export function SheetHost() {
  const sheet = useStore(sheetStore)
  const message = useStore(toastStore)

  useEffect(() => {
    if (!sheet) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismissSheet()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sheet])

  return (
    <>
      {sheet && (
        <div className="overlay" onClick={dismissSheet}>
          <div className="sheet" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            {sheet.node}
          </div>
        </div>
      )}
      {message && (
        <div className="toast" role="status" key={message.id}>
          {message.text}
        </div>
      )}
    </>
  )
}
