// pCloud finto, solo per lo sviluppo: apri l'app con ?fake e hai una libreria inventata,
// brani sintetici di pochi secondi e playlist in memoria. Non finisce nella build di produzione.

import { setMemoryAuth } from './auth'
import { setNamespace } from './env'
import { setLoginTransport } from './passwordLogin'
import { PCloudError, setTransport, type Params, type RawMeta } from './pcloud'

let nextFolderId = 100
let nextFileId = 1000
const files = new Map<number, RawMeta>()

type Tags = Pick<RawMeta, 'artist' | 'album' | 'title'>

function file(name: string, tags: Tags = {}): RawMeta {
  return { name, isfolder: false, fileid: nextFileId++, ...tags }
}

function folder(name: string, contents: RawMeta[]): RawMeta {
  const folderid = nextFolderId++
  for (const child of contents) {
    child.parentfolderid = folderid
    if (!child.isfolder) files.set(child.fileid!, child)
  }
  return { name, isfolder: true, folderid, contents }
}

const album = (artist: string, name: string, titles: string[]) =>
  titles.map((title, i) =>
    file(`${String(i + 1).padStart(2, '0')}-${title.toLowerCase().replace(/\s+/g, '_')}.mp3`, { artist, album: name, title }),
  )

const tree = folder('music', [
  folder('-musica', [
    folder('--listen', [
      folder('Avion Travel - L\'amico magico (2009)', album('Avion Travel', 'L\'amico magico', ['Parlami di me', 'La dolce vita', 'Amarcord', 'Otto e mezzo'])),
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
  file('sciolto nella radice.mp3'),
])

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
  setMemoryAuth(signedIn ? { token: 'fake', host: 'eapi.pcloud.com', kind: 'session' } : null)
  installFakeLogin()
  setTransport(async (method, params) => {
    await new Promise((resolve) => setTimeout(resolve, 120))
    switch (method) {
      case 'userinfo':
        return { result: 0, email: 'demo@example.com' }
      case 'logout':
        return { result: 0 }
      case 'listfolder':
        return { result: 0, metadata: tree }
      case 'getfilelink':
        return link(Number(params.fileid), false, trackSeconds)
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
