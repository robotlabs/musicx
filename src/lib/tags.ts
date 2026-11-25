// Tag: etichette libere su cartelle intere, playlist e singoli brani, per ritrovare blocchi di musica.
// Come "Da cercare" stanno su pCloud come cartelline vuote, in music/.musicx/tag/<tag>/<cosa>:
// "f123" è una cartella, "p45" una playlist, "t678" un brano (id di pCloud, che non cambiano
// spostando o rinominando). Una lettura sola le porta tutte, uguali su ogni dispositivo, e due
// modifiche fatte insieme da due dispositivi non si pestano i piedi.
// Un tag su una cartella vale per tutta la musica che contiene, anche quella aggiunta dopo.

import { appFolder, fromFolderName, toFolderName } from './appFolder'
import { storageKey } from './env'
import { normalize } from './library'
import { createFolder, deleteFolder, deleteFolderTree, listFolderTree, renameFolder, type RawMeta } from './pcloud'
import { createStore } from './store'

export type TagKind = 'folder' | 'playlist' | 'track'

export interface TagTarget {
  kind: TagKind
  id: number
}

export interface Tag {
  name: string
  /** In ordine di aggiunta. */
  items: TagTarget[]
}

interface TagState {
  /** In ordine alfabetico. */
  tags: Tag[]
  loaded: boolean
  error: string | null
}

export const tagStore = createStore<TagState>({ tags: [], loaded: false, error: null })

const PATH = ['.musicx', 'tag']
const PREFIX: Record<TagKind, string> = { folder: 'f', playlist: 'p', track: 't' }
const KINDS: Record<string, TagKind> = { f: 'folder', p: 'playlist', t: 'track' }

const collator = new Intl.Collator('it', { numeric: true, sensitivity: 'base' })
const cacheKey = () => storageKey('tags')

/** Il nome pulito di un tag (spazi in più via, niente barre). Vuoto se non resta niente. */
export const cleanTag = (text: string) => fromFolderName(toFolderName(text, 80))

/** Due nomi sono lo stesso tag anche con maiuscole, accenti o trattini diversi. */
export const tagKey = (name: string) => normalize(name).replace(/\s+/g, ' ').trim()

const marker = (target: TagTarget) => `${PREFIX[target.kind]}${target.id}`
const sameTarget = (a: TagTarget) => (b: TagTarget) => a.kind === b.kind && a.id === b.id

function parseMarker(name: string): TagTarget | null {
  const match = /^([fpt])(\d+)$/.exec(name)
  return match ? { kind: KINDS[match[1]], id: Number(match[2]) } : null
}

// Dove sta ogni cosa su pCloud: la cartella di ogni tag e la cartellina di ogni voce.
const tagFolders = new Map<string, number>()
const itemFolders = new Map<string, number>()
const itemKey = (name: string, target: TagTarget) => `${tagKey(name)}/${marker(target)}`

function show(tags: Tag[], error: string | null = null) {
  const sorted = tags.filter((tag) => tag.items.length).sort((a, b) => collator.compare(a.name, b.name))
  tagStore.set({ tags: sorted, loaded: true, error })
  try {
    localStorage.setItem(cacheKey(), JSON.stringify(sorted))
  } catch {
    // Senza spazio si rilegge da pCloud.
  }
}

/** All'avvio: subito quelli salvati sul dispositivo (servono senza rete), poi pCloud li riconferma. */
export function restoreTags() {
  if (tagStore.get().loaded) return
  try {
    const saved = JSON.parse(localStorage.getItem(cacheKey()) ?? 'null') as Tag[] | null
    if (Array.isArray(saved)) tagStore.set({ tags: saved, loaded: true, error: null })
  } catch {
    // Copia illeggibile: si aspetta pCloud.
  }
}

export function resetTags() {
  mapsReady = false
  tagFolders.clear()
  itemFolders.clear()
  tagStore.set({ tags: [], loaded: false, error: null })
  try {
    localStorage.removeItem(cacheKey())
  } catch {
    // Niente da togliere.
  }
}

// Le modifiche vanno a pCloud una dopo l'altra, nell'ordine dei clic.
let chain: Promise<unknown> = Promise.resolve()
let pending = 0
// Cresce a ogni modifica: una lettura partita prima non sovrascrive quello che si è appena cambiato.
let version = 0
const serial = <T>(task: () => Promise<T>): Promise<T> => {
  pending += 1
  version += 1
  const run = chain.then(task, task)
  chain = run.catch(() => {})
  return run.finally(() => {
    pending -= 1
  })
}

async function readTree(): Promise<RawMeta | null> {
  const id = await appFolder(PATH, false)
  return id === null ? null : listFolderTree(id)
}

let mapsReady = false

/** Dalla cartella dei tag letta da pCloud: i tag, e dove sta ogni cosa. */
function fillFrom(tree: RawMeta | null): Tag[] {
  tagFolders.clear()
  itemFolders.clear()
  const tags: Tag[] = []
  for (const folder of tree?.contents ?? []) {
    if (!folder.isfolder) continue
    const name = fromFolderName(folder.name)
    tagFolders.set(tagKey(name), folder.folderid!)
    const entries = (folder.contents ?? []).filter((entry) => entry.isfolder).sort((a, b) => a.folderid! - b.folderid!)
    const items: TagTarget[] = []
    for (const entry of entries) {
      const target = parseMarker(entry.name)
      if (!target) continue
      itemFolders.set(itemKey(name, target), entry.folderid!)
      items.push(target)
    }
    // Lo stesso tag scritto in due modi (da due dispositivi insieme): si vede come uno solo.
    const twin = tags.find((tag) => tagKey(tag.name) === tagKey(name))
    if (twin) twin.items.push(...items.filter((item) => !twin.items.some(sameTarget(item))))
    else tags.push({ name, items })
  }
  mapsReady = true
  return tags
}

/** Prima di cambiare qualcosa: se i tag vengono solo dalla copia sul dispositivo, si cerca dove stanno. */
async function ensureMaps() {
  if (!mapsReady) fillFrom(await readTree())
}

/** Rilegge tutti i tag da pCloud. Se intanto se ne sta cambiando uno, vince lo schermo. */
export async function loadTags() {
  try {
    const at = version
    const tree = await readTree()
    if (pending || version !== at) return
    show(fillFrom(tree))
  } catch (error) {
    // Senza rete restano quelli sul dispositivo.
    tagStore.set((state) => ({
      ...state,
      loaded: true,
      error: state.tags.length ? null : error instanceof Error ? error.message : 'Errore sconosciuto.',
    }))
  }
}

export const findTag = (name: string) => tagStore.get().tags.find((tag) => tagKey(tag.name) === tagKey(name))

/** I tag di una cosa (cartella, playlist o brano). */
export const tagsOf = (tags: Tag[], target: TagTarget) => tags.filter((tag) => tag.items.some(sameTarget(target)))

/** Mette il tag (nuovo o già esistente) su tutte le cose indicate. Lo schermo cambia subito. */
export async function addTag(text: string, targets: TagTarget[]) {
  const typed = cleanTag(text)
  if (!typed || !targets.length) return
  const existing = findTag(typed)
  const name = existing?.name ?? typed
  const adding = targets.filter((target) => !existing?.items.some(sameTarget(target)))
  if (!adding.length) return
  const others = tagStore.get().tags.filter((tag) => tag !== existing)
  show([...others, { name, items: [...(existing?.items ?? []), ...adding] }])
  try {
    await serial(async () => {
      await ensureMaps()
      let folder = tagFolders.get(tagKey(name))
      if (folder === undefined) {
        folder = (await createFolder((await appFolder(PATH, true))!, toFolderName(name, 80))).folderid!
        tagFolders.set(tagKey(name), folder)
      }
      for (const target of adding) {
        const made = await createFolder(folder, marker(target))
        itemFolders.set(itemKey(name, target), made.folderid!)
      }
    })
  } catch (error) {
    const now = tagStore.get().tags
    show(now.map((tag) => (tag.name === name ? { ...tag, items: tag.items.filter((item) => !adding.some(sameTarget(item))) } : tag)))
    throw error
  }
}

/** Toglie il tag dalle cose indicate. Un tag rimasto senza niente sparisce. */
export async function removeTag(name: string, targets: TagTarget[]) {
  const tag = findTag(name)
  if (!tag) return
  const removing = targets.filter((target) => tag.items.some(sameTarget(target)))
  if (!removing.length) return
  const left = tag.items.filter((item) => !removing.some(sameTarget(item)))
  show(tagStore.get().tags.map((entry) => (entry === tag ? { ...tag, items: left } : entry)))
  try {
    await serial(async () => {
      await ensureMaps()
      for (const target of removing) {
        const node = itemFolders.get(itemKey(tag.name, target))
        if (node !== undefined) await deleteFolder(node)
        itemFolders.delete(itemKey(tag.name, target))
      }
      const folder = tagFolders.get(tagKey(tag.name))
      if (!left.length && folder !== undefined) {
        tagFolders.delete(tagKey(tag.name))
        // Se nel frattempo un altro dispositivo ci ha messo qualcosa, pCloud dice di no: resta.
        await deleteFolder(folder).catch(() => {})
      }
    })
  } catch (error) {
    await loadTags()
    throw error
  }
}

/** Cambia nome a un tag. Se il nuovo nome è già un altro tag, pCloud lo rifiuta. */
export async function renameTag(name: string, text: string) {
  const tag = findTag(name)
  const next = cleanTag(text)
  if (!tag || !next || next === tag.name) return
  const clash = findTag(next)
  if (clash && clash !== tag) throw new Error(`C'è già un tag "${clash.name}".`)
  await serial(async () => {
    await ensureMaps()
    const folder = tagFolders.get(tagKey(tag.name))
    if (folder === undefined) return
    await renameFolder(folder, toFolderName(next, 80))
    tagFolders.delete(tagKey(tag.name))
    tagFolders.set(tagKey(next), folder)
  })
  for (const item of tag.items) {
    const node = itemFolders.get(itemKey(tag.name, item))
    itemFolders.delete(itemKey(tag.name, item))
    if (node !== undefined) itemFolders.set(itemKey(next, item), node)
  }
  show(tagStore.get().tags.map((entry) => (entry === tag ? { ...tag, name: next } : entry)))
}

/** Toglie il tag da tutto (la sua cartella va nel cestino di pCloud). */
export async function deleteTag(name: string) {
  const tag = findTag(name)
  if (!tag) return
  show(tagStore.get().tags.filter((entry) => entry !== tag))
  try {
    await serial(async () => {
      await ensureMaps()
      const folder = tagFolders.get(tagKey(tag.name))
      if (folder !== undefined) await deleteFolderTree(folder)
      tagFolders.delete(tagKey(tag.name))
    })
  } catch (error) {
    await loadTags()
    throw error
  }
}

/** I tag il cui nome contiene tutte le parole cercate. */
export function searchTags(tags: Tag[], query: string): Tag[] {
  const words = normalize(query).split(/\s+/).filter(Boolean)
  if (!words.length) return []
  return tags.filter((tag) => {
    const text = tagKey(tag.name)
    return words.every((word) => text.includes(word))
  })
}
