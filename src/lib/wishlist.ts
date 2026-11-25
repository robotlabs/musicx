// "Da cercare": brani da scaricare da YouTube, scritti anche dal telefono e ritrovati sul Mac in
// "Da YouTube". Ogni voce è una cartellina vuota su pCloud, in music/.musicx/da cercare (la libreria
// salta le cartelle col punto): così si leggono con l'API da ogni dispositivo, sempre aggiornate, e
// due aggiunte insieme non si pestano i piedi.

import { appFolder, fromFolderName, toFolderName } from './appFolder'
import { storageKey } from './env'
import { createFolder, deleteFolder, listFolder, type RawMeta } from './pcloud'
import { createStore } from './store'

export interface Wish {
  /** La cartellina su pCloud. */
  id: number
  text: string
}

interface WishState {
  items: Wish[]
  loaded: boolean
  error: string | null
}

export const wishStore = createStore<WishState>({ items: [], loaded: false, error: null })

const PATH = ['.musicx', 'da cercare']
const cacheKey = () => storageKey('wishes')


function show(items: Wish[], error: string | null = null) {
  wishStore.set({ items, loaded: true, error })
  try {
    localStorage.setItem(cacheKey(), JSON.stringify(items))
  } catch {
    // Senza spazio si rilegge da pCloud.
  }
}

/** All'apertura della pagina: subito quella salvata sul dispositivo, poi pCloud. */
export function restoreWishes() {
  if (wishStore.get().loaded) return
  try {
    const saved = JSON.parse(localStorage.getItem(cacheKey()) ?? 'null') as Wish[] | null
    if (Array.isArray(saved)) wishStore.set({ items: saved, loaded: true, error: null })
  } catch {
    // Copia illeggibile: si aspetta pCloud.
  }
}

const toWish = (entry: RawMeta): Wish => ({ id: entry.folderid!, text: fromFolderName(entry.name) })
const byAge = (a: RawMeta, b: RawMeta) => Date.parse(a.created ?? '') - Date.parse(b.created ?? '') || a.folderid! - b.folderid!

export async function loadWishes() {
  try {
    const id = await appFolder(PATH, false)
    const entries = id === null ? [] : ((await listFolder(id, true)).contents ?? []).filter((entry) => entry.isfolder)
    show(entries.sort(byAge).map(toWish))
  } catch (error) {
    // Senza rete resta la copia sul dispositivo.
    wishStore.set((state) => ({ ...state, loaded: true, error: state.items.length ? null : error instanceof Error ? error.message : 'Errore sconosciuto.' }))
  }
}

export async function addWish(text: string) {
  const name = toFolderName(text)
  if (!name) return
  const id = await appFolder(PATH, true)
  const made = await createFolder(id!, name)
  const items = wishStore.get().items.filter((item) => item.id !== made.folderid)
  show([...items, toWish({ ...made, name })])
}

export async function removeWish(id: number) {
  const before = wishStore.get().items
  show(before.filter((item) => item.id !== id))
  try {
    await deleteFolder(id)
  } catch (error) {
    show(before)
    throw error
  }
}
