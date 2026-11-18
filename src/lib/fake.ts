// pCloud finto, solo per lo sviluppo: apri l'app con ?fake e hai una libreria inventata,
// brani sintetici di pochi secondi e playlist in memoria. Non finisce nella build di produzione.

import { setDirectLinks } from './audioStore'
import { setMemoryAuth } from './auth'
import { readTags, writeTags } from './id3'
import { setNamespace } from './env'
import { setLocalSourceEnabled } from './localSource'
import { setLoginTransport } from './passwordLogin'
import { PCloudError, setTransport, type DiffEntry, type Params, type RawMeta } from './pcloud'

let nextFolderId = 100
let nextFileId = 1000
const files = new Map<number, RawMeta>()

type Tags = Pick<RawMeta, 'artist' | 'album' | 'title' | 'trackno'>

/** Impronta finta del contenuto: uguale per nome e tag uguali (come due copie dello stesso file). */
const fakeHash = (seed: string) => [...seed].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 2 ** 40, 7)

function file(name: string, tags: Tags = {}): RawMeta {
  const hash = fakeHash(`${name}|${tags.title ?? ''}|${tags.artist ?? ''}`)
  return { name, isfolder: false, fileid: nextFileId++, hash, size: 3_000_000 + (hash % 5_000_000), ...tags }
}

/** Una copia identica di un file (stesso contenuto, altro fileid), per provare i doppioni. */
const copyOf = (original: RawMeta, name = original.name): RawMeta => ({ ...original, name, fileid: nextFileId++ })

function folder(name: string, contents: RawMeta[]): RawMeta {
  const folderid = nextFolderId++
  for (const child of contents) {
    child.parentfolderid = folderid
    if (!child.isfolder) files.set(child.fileid!, child)
  }
  return { name, isfolder: true, folderid, contents }
}

const album = (artist: string, name: string, titles: string[], first = 1) =>
  titles.map((title, i) =>
    file(`${String(i + first).padStart(2, '0')}-${title.toLowerCase().replace(/\s+/g, '_')}.mp3`, { artist, album: name, title }),
  )

const parlami = file('01-parlami_di_me.mp3', { artist: 'Avion Travel', album: "L'amico magico", title: 'Parlami di me' })

const tree = folder('music', [
  folder('-musica', [
    folder('--listen', [
      folder('Avion Travel - L\'amico magico (2009)', [parlami, ...album('Avion Travel', 'L\'amico magico', ['La dolce vita', 'Amarcord', 'Otto e mezzo'], 2)]),
      folder('JMI', ['01 Track 01 1.mp3', '02 Track 02 1.mp3', '10 Track 10 1.mp3', '3 Track 03 1.mp3'].map((name) => file(name))),
      folder('copertine', [file('front.jpg'), file('back.jpg')]),
    ]),
    folder('Lungo', Array.from({ length: 180 }, (_, i) => file(`Brano ${String(i + 1).padStart(3, '0')}.flac`))),
    folder('Formati difficili', [
      file('vecchio formato.wma'),
      file('rotto ma recuperabile.mp3'),
      file('irrecuperabile.mp3'),
      file('._doppione macos.mp3'),
    ]),
  ]),
  folder('dub', [
    folder('King Tubby', album('King Tubby', 'Dub From The Roots', ['Iyahta', 'Mine Field', 'Dub You Can Feel'])),
    folder('Città & Perché', [file('Già così è più bello.ogg'), file('Perché no.opus')]),
  ]),
  // Vuota: l'indice non la mostra, ma ci si può spostare dentro qualcosa.
  folder('Da sistemare', []),
  // Doppioni: una copia identica e lo stesso brano in un altro formato.
  folder('Vecchi download', [copyOf(parlami, 'Avion Travel - Parlami di me.mp3'), file('Iyahta.flac', { artist: 'King Tubby', title: 'Iyahta' })]),
  file('sciolto nella radice.mp3'),
])

function findFolder(id: number, from: RawMeta = tree): RawMeta | null {
  if (from.folderid === id) return from
  for (const child of from.contents ?? []) {
    const found = child.isfolder ? findFolder(id, child) : null
    if (found) return found
  }
  return null
}

function folderOf(params: Params, name = 'folderid'): RawMeta {
  const found = findFolder(Number(params[name]))
  if (!found) throw new PCloudError(2005, 'Directory does not exist.')
  return found
}

/** Toglie un file o una cartella da dove sta e lo mette in `target` (come pCloud: un file con lo stesso nome viene sostituito). */
function moveInto(entry: RawMeta, target: RawMeta) {
  const from = findFolder(entry.parentfolderid!)
  if (from) from.contents = from.contents!.filter((child) => child !== entry)
  const clash = target.contents!.find((child) => child.name === entry.name && !child.isfolder && !entry.isfolder)
  if (clash) {
    target.contents = target.contents!.filter((child) => child !== clash)
    files.delete(clash.fileid!)
  }
  entry.parentfolderid = target.folderid
  target.contents!.push(entry)
}

// Cronologia dei cambiamenti, come `diff` di pCloud.
const events: DiffEntry[] = []
let lastDiffId = 5000
function emit(event: string, metadata: RawMeta) {
  events.push({ event, diffid: ++lastDiffId, metadata: { ...metadata, contents: undefined } })
}

async function diff(params: Params) {
  if (params.last !== undefined) return { result: 0, diffid: lastDiffId, entries: [] }
  const since = Number(params.diffid)
  // Con block si aspetta un cambiamento (al massimo 20 secondi, poi una risposta vuota).
  for (let waited = 0; params.block && !events.some((entry) => entry.diffid > since) && waited < 20_000; waited += 300) {
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  return { result: 0, diffid: lastDiffId, entries: events.filter((entry) => entry.diffid > since) }
}

/** Solo in sviluppo: cambia qualcosa "da un altro dispositivo", per vedere la libreria aggiornarsi da sola. */
function exposeRemote() {
  const remote = {
    addFile(folderName: string, name: string, tags: Tags = {}) {
      const find = (from: RawMeta): RawMeta | null =>
        from.name === folderName && from.isfolder ? from : (from.contents ?? []).reduce<RawMeta | null>((found, child) => found ?? (child.isfolder ? find(child) : null), null)
      const target = find(tree)
      if (!target) throw new Error(`Cartella finta "${folderName}" non trovata`)
      const added = { ...file(name, tags), parentfolderid: target.folderid }
      target.contents!.push(added)
      files.set(added.fileid!, added)
      emit('createfile', added)
      return added.fileid
    },
  }
  ;(window as unknown as { fakePcloud: typeof remote }).fakePcloud = remote
}

interface FakeCollection {
  id: number
  name: string
  system: boolean
  fileIds: number[]
}

const someFiles = [...files.keys()]
const collections: FakeCollection[] = [
  { id: 1, name: 'Preferiti', system: false, fileIds: someFiles.slice(0, 5) },
  { id: 2, name: 'Most Listened', system: true, fileIds: [] },
  { id: 3, name: 'CCCP ▸ Socialismo e barbarie', system: false, fileIds: someFiles.slice(5, 9) },
  { id: 4, name: 'CCCP ▸ Live in Punkow', system: false, fileIds: someFiles.slice(9, 12) },
  { id: 5, name: 'De Gregori ▸ Rimmel', system: false, fileIds: someFiles.slice(12, 20) },
  { id: 6, name: 'almodovar', system: false, fileIds: someFiles.slice(20, 23) },
  { id: 7, name: 'Battiato', system: false, fileIds: someFiles.slice(23, 30) },
  { id: 8, name: 'De Gregori - Alice non lo sa', system: false, fileIds: someFiles.slice(30, 33) },
]
let nextCollectionId = 9

const describe = (collection: FakeCollection, withContents = false) => ({
  id: collection.id,
  name: collection.name,
  items: collection.fileIds.length,
  system: collection.system,
  type: 'audio',
  contents: withContents
    ? collection.fileIds.map((fileid, i) => ({ ...files.get(fileid)!, position: i + 1 }))
    : [],
})

function collectionOf(params: Params): FakeCollection {
  const found = collections.find((collection) => collection.id === Number(params.collectionid))
  if (!found) throw new PCloudError(2065, 'Collection not found.')
  return found
}

const urls = new Map<string, string>()

/** Un WAV con una nota fissa, diversa per ogni brano. */
function toneUrl(fileid: number, seconds: number): string {
  const rate = 8000
  const samples = rate * seconds
  const buffer = new ArrayBuffer(44 + samples)
  const view = new DataView(buffer)
  const text = (offset: number, value: string) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)))
  text(0, 'RIFF')
  view.setUint32(4, 36 + samples, true)
  text(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, rate, true)
  view.setUint32(28, rate, true)
  view.setUint16(32, 1, true)
  view.setUint16(34, 8, true)
  text(36, 'data')
  view.setUint32(40, samples, true)
  const hz = 220 + (fileid % 24) * 20
  for (let i = 0; i < samples; i++) {
    view.setUint8(44 + i, 128 + Math.round(30 * Math.sin((2 * Math.PI * hz * i) / rate)))
  }
  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }))
}

/** File caricati con "Modifica info": li si riscarica uguali. */
const uploaded = new Map<number, Uint8Array>()

/**
 * Per scaricare un mp3 (e riscriverne i tag) serve un mp3 vero: tag dai metadati finti più un frame
 * audio muto. Per ascoltarlo resta il WAV con la nota.
 */
function downloadLink(fileid: number) {
  const meta = files.get(fileid)
  if (!meta) throw new PCloudError(2009, 'File not found.')
  let bytes = uploaded.get(fileid)
  if (!bytes) {
    const frame = new Uint8Array(417)
    frame.set([0xff, 0xfb, 0x90, 0x64])
    const tags = { title: meta.title ?? '', artist: meta.artist ?? '', album: meta.album ?? '', track: String(meta.trackno ?? '') }
    bytes = writeTags(frame, tags)
  }
  return { result: 0, hosts: ['fake'], path: '/', url: URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>])) }
}

async function upload(params: Params, upload: { name: string; data: Blob } | undefined) {
  if (!upload) throw new PCloudError(2005, 'Directory does not exist.')
  const target = folderOf(params)
  let meta = [...files.values()].find((entry) => entry.parentfolderid === target.folderid && entry.name === upload.name)
  const created = !meta
  if (!meta) {
    // File nuovo nella cartella.
    meta = { name: upload.name, isfolder: false, fileid: nextFileId++, parentfolderid: target.folderid }
    target.contents!.push(meta)
    files.set(meta.fileid!, meta)
  }
  const bytes = new Uint8Array(await upload.data.arrayBuffer())
  const tags = readTags(bytes)
  uploaded.set(meta.fileid!, bytes)
  // Come pCloud: rilegge subito i tag del file nuovo.
  Object.assign(meta, {
    title: tags.title,
    artist: tags.artist,
    album: tags.album,
    trackno: tags.track ? Number.parseInt(tags.track, 10) : undefined,
    size: bytes.length,
    hash: fakeHash(`${upload.name}|${bytes.length}`),
  })
  emit(created ? 'createfile' : 'modifyfile', meta)
  return { result: 0, fileids: [meta.fileid], metadata: [{ ...meta }] }
}

function link(fileid: number, transcoded: boolean, seconds: number) {
  const meta = files.get(fileid)
  if (!meta) throw new PCloudError(2009, 'File not found.')
  // Due brani fatti apposta per provare i tentativi di recupero del lettore.
  const broken = meta.name.startsWith('irrecuperabile') || (!transcoded && meta.name.startsWith('rotto'))
  const key = `${fileid}:${broken}`
  let url = urls.get(key)
  if (!url) {
    url = broken ? URL.createObjectURL(new Blob(['non è audio'], { type: 'audio/mpeg' })) : toneUrl(fileid, seconds)
    urls.set(key, url)
  }
  return { result: 0, hosts: ['fake'], path: '/', url }
}

/**
 * Accesso finto con email e password. Il codice giusto è sempre 123456.
 * - email che inizia con "2fa" → codice dell'app di autenticazione; "sms" → codice via SMS
 * - email che inizia con "mail" → codice via email (dispositivo nuovo)
 * - password "sbagliata" → errore
 */
function installFakeLogin() {
  setLoginTransport(async (_host, method, params) => {
    await new Promise((resolve) => setTimeout(resolve, 400))
    const email = String(params.username ?? '')
    const codeOk = String(params.code ?? '') === '123456'
    switch (method) {
      case 'userinfo':
        if (params.password === 'sbagliata') return { result: 2000, error: 'Log in failed.' }
        if (email.startsWith('2fa')) return { result: 2297, error: 'Two factor authentication required.', token: 't', tfatype: 2 }
        if (email.startsWith('sms')) return { result: 2297, error: 'Two factor authentication required.', token: 't', tfatype: 1 }
        if (email.startsWith('mail')) return { result: 2306, error: 'Please verify this device.' }
        return { result: 0, auth: 'fake' }
      case 'tfa_login':
      case 'login':
        return codeOk ? { result: 0, auth: 'fake' } : { result: 2064, error: 'Invalid code.' }
      case 'tfa_sendcodeviasms':
      case 'user/sendemailtfamail':
        return { result: 0 }
      default:
        return { result: 2000, error: `Metodo finto non previsto: ${method}` }
    }
  })
}

/** `signedIn = false` parte dalla schermata di accesso (con ?fake&login). */
export function installFake(trackSeconds = 6, signedIn = true) {
  setNamespace('musicx-fake')
  setLocalSourceEnabled(false)
  // I link finti sono blob leggibili dalla pagina: i download si provano anche qui.
  setDirectLinks(true)
  setMemoryAuth(signedIn ? { token: 'fake', host: 'eapi.pcloud.com', kind: 'session' } : null)
  installFakeLogin()
  exposeRemote()
  setTransport(async (method, params, _timeout, file) => {
    await new Promise((resolve) => setTimeout(resolve, 120))
    switch (method) {
      case 'userinfo':
        return { result: 0, email: 'demo@example.com' }
      case 'logout':
        return { result: 0 }
      case 'listfolder': {
        if (params.recursive) return { result: 0, metadata: tree }
        const found = folderOf(params)
        const contents = found.contents!.filter((child) => !params.nofiles || child.isfolder).map((child) => ({ ...child, contents: undefined }))
        return { result: 0, metadata: { ...found, contents } }
      }
      case 'renamefolder': {
        const moving = folderOf(params)
        const target = folderOf(params, 'tofolderid')
        if (findFolder(target.folderid!, moving)) throw new PCloudError(2043, 'Cannot move a folder to a subfolder of itself.')
        if (target.contents!.some((child) => child.name === moving.name)) throw new PCloudError(2004, 'File or folder alredy exists.')
        moveInto(moving, target)
        emit('modifyfolder', moving)
        return { result: 0, metadata: { ...moving, contents: undefined } }
      }
      case 'createfolderifnotexists': {
        const parent = folderOf(params)
        let made = parent.contents!.find((child) => child.isfolder && child.name === String(params.name))
        if (!made) {
          made = { name: String(params.name), isfolder: true, folderid: nextFolderId++, parentfolderid: parent.folderid, contents: [] }
          parent.contents!.push(made)
          emit('createfolder', made)
        }
        return { result: 0, created: true, metadata: { ...made, contents: undefined } }
      }
      case 'getfilelink':
        return params.forcedownload ? downloadLink(Number(params.fileid)) : link(Number(params.fileid), false, trackSeconds)
      case 'uploadfile':
        return upload(params, file)
      case 'renamefile': {
        const meta = files.get(Number(params.fileid))
        if (!meta) throw new PCloudError(2009, 'File not found.')
        if (params.toname !== undefined) meta.name = String(params.toname)
        if (params.tofolderid !== undefined) moveInto(meta, folderOf(params, 'tofolderid'))
        emit('modifyfile', meta)
        return { result: 0, metadata: { ...meta } }
      }
      case 'deletefile': {
        const meta = files.get(Number(params.fileid))
        if (!meta) throw new PCloudError(2009, 'File not found.')
        const from = findFolder(meta.parentfolderid!)
        if (from) from.contents = from.contents!.filter((child) => child !== meta)
        files.delete(meta.fileid!)
        emit('deletefile', meta)
        return { result: 0, metadata: { ...meta, isdeleted: true } }
      }
      case 'diff':
        return diff(params)
      case 'getaudiolink':
        return link(Number(params.fileid), true, trackSeconds)
      case 'collection_list':
        return { result: 0, collections: collections.map((collection) => describe(collection)) }
      case 'collection_details':
        return { result: 0, collection: describe(collectionOf(params), true) }
      case 'collection_create': {
        const name = String(params.name)
        if (collections.some((collection) => collection.name === name)) {
          throw new PCloudError(2073, 'The name for the collection is already used.')
        }
        const created = { id: nextCollectionId++, name, system: false, fileIds: [] }
        collections.push(created)
        return { result: 0, collection: [describe(created)] }
      }
      case 'collection_rename':
        collectionOf(params).name = String(params.name)
        return { result: 0 }
      case 'collection_delete':
        collections.splice(collections.indexOf(collectionOf(params)), 1)
        return { result: 0 }
      case 'collection_linkfiles': {
        const collection = collectionOf(params)
        const linkresult = String(params.fileids)
          .split(',')
          .map(Number)
          .map((fileid) => {
            if (collection.fileIds.includes(fileid)) return { fileid, result: 2072 }
            collection.fileIds.push(fileid)
            return { fileid, result: 0 }
          })
        return { result: 0, linkresult, collection: describe(collection) }
      }
      case 'collection_unlinkfiles': {
        const collection = collectionOf(params)
        const removed = new Set(String(params.fileids).split(',').map(Number))
        collection.fileIds = collection.fileIds.filter((fileid) => !removed.has(fileid))
        return { result: 0 }
      }
      case 'collection_move': {
        const collection = collectionOf(params)
        // Come pCloud (si presume): posizione e file devono corrispondere, altrimenti errore.
        if (collection.fileIds[Number(params.item) - 1] !== Number(params.fileid)) {
          throw new PCloudError(2066, 'Item could not be moved in the collection - invalid parameters.')
        }
        const [moved] = collection.fileIds.splice(Number(params.item) - 1, 1)
        collection.fileIds.splice(Number(params.position) - 1, 0, moved)
        return { result: 0 }
      }
      default:
        throw new PCloudError(-3, `Metodo finto non previsto: ${method}`)
    }
  })
}
