// Quali gruppi di playlist sono aperti. È una comodità di questo dispositivo: resta nel browser,
// ed è la stessa per la barra laterale e per la pagina Playlist.

import { storageKey } from './env'
import { createStore } from './store'

const key = () => storageKey('open-groups')

function load(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(key()) ?? '[]')
    return Array.isArray(saved) ? saved.filter((name): name is string => typeof name === 'string') : []
  } catch {
    return []
  }
}

export const openGroupsStore = createStore<string[]>([])

/** Da chiamare all'avvio, dopo aver scelto lo spazio dei nomi (la modalità finta ne usa un altro). */
export const loadOpenGroups = () => openGroupsStore.set(load())

function save(next: string[]) {
  openGroupsStore.set(next)
  try {
    localStorage.setItem(key(), JSON.stringify(next))
  } catch {
    // Senza storage i gruppi si riaprono chiusi: nient'altro.
  }
}

export const isOpen = (open: string[], group: string) => open.includes(group)

export function setGroupOpen(group: string, open: boolean) {
  const current = openGroupsStore.get()
  if (open === current.includes(group)) return
  save(open ? [...current, group] : current.filter((name) => name !== group))
}

export const toggleGroup = (group: string) => setGroupOpen(group, !openGroupsStore.get().includes(group))

/** Dopo un cambio di nome il gruppo resta aperto (o chiuso) com'era. */
export function renameOpenGroup(from: string, to: string) {
  const current = openGroupsStore.get()
  if (current.includes(from)) save([...current.filter((name) => name !== from && name !== to), to])
}
