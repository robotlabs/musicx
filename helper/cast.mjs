// "Trasmetti" sul Mac: la pagina comanda le casse di casa (DLNA/UPnP, Yamaha MusicCast) passando da
// qui, perché una pagina https non può parlare in http con gli indirizzi della rete di casa né cercarli.
// La logica (SOAP, MusicCast, coda) sta nella pagina: qui solo i pezzi che il browser non sa fare.
//
//  - discover: cerca le casse con SSDP e, in più, chiedendo l'API Yamaha a tutta la rete /24.
//  - lanHttp: una richiesta HTTP verso un indirizzo privato della rete di casa (mai verso internet).
//  - castLink: il link pCloud di un brano scritto con l'IP numerico del server, l'unica forma che le
//    casse MusicCast suonano (il loro DLNA non risolve i nomi e non segue i rimandi). pCloud dà i link
//    solo a chi non è una pagina web, e li lega all'IP pubblico che li chiede: Mac e casse escono
//    dallo stesso.

import dgram from 'node:dgram'
import { lookup } from 'node:dns/promises'
import { networkInterfaces } from 'node:os'

const SSDP_ADDRESS = '239.255.255.250'
const SSDP_PORT = 1900
const RENDERER = 'urn:schemas-upnp-org:device:MediaRenderer:1'

/** 10.x, 172.16–31.x, 192.168.x: solo la rete di casa. */
export function isPrivateIPv4(ip) {
  const parts = String(ip).split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false
  const [a, b] = parts
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

/** Gli indirizzi IPv4 privati di questo Mac (Wi-Fi, Ethernet). */
function ownAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((net) => net && net.family === 'IPv4' && !net.internal && isPrivateIPv4(net.address))
    .map((net) => net.address)
}

/** M-SEARCH SSDP: chi risponde come MediaRenderer, con l'indirizzo della sua descrizione. */
function ssdp(timeoutMs) {
  return new Promise((resolve) => {
    const found = new Map()
    let socket
    const finish = () => {
      try {
        socket?.close()
      } catch {
        // già chiuso
      }
      resolve([...found.values()])
    }
    try {
      socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    } catch {
      return resolve([])
    }
    socket.on('error', finish)
    socket.on('message', (message, remote) => {
      const text = message.toString()
      const location = /^location:\s*(\S+)/im.exec(text)?.[1]
      if (!location || !isPrivateIPv4(remote.address)) return
      found.set(remote.address, { ip: remote.address, location })
    })
    const search = Buffer.from(
      `M-SEARCH * HTTP/1.1\r\nHOST: ${SSDP_ADDRESS}:${SSDP_PORT}\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ${RENDERER}\r\n\r\n`,
    )
    socket.bind(0, () => {
      // Due volte: l'UDP si perde facilmente.
      for (const delay of [0, 400]) {
        setTimeout(() => socket.send(search, SSDP_PORT, SSDP_ADDRESS, () => {}), delay)
      }
    })
    setTimeout(finish, timeoutMs)
  })
}

/** Chiede l'API Yamaha a ogni indirizzo della /24 del Mac: trova le MusicCast anche se SSDP non passa. */
async function scanYamaha(timeoutMs) {
  const prefixes = new Set(ownAddresses().map((ip) => ip.split('.').slice(0, 3).join('.')))
  const probes = []
  for (const prefix of prefixes) {
    for (let host = 1; host < 255; host++) {
      const ip = `${prefix}.${host}`
      probes.push(
        fetch(`http://${ip}/YamahaExtendedControl/v1/system/getDeviceInfo`, {
          signal: AbortSignal.timeout(timeoutMs),
          headers: { Connection: 'close' },
        })
          .then((response) => (response.ok ? response.json() : null))
          .then((data) => (data && data.response_code === 0 ? { ip, location: null } : null))
          .catch(() => null),
      )
    }
  }
  return (await Promise.all(probes)).filter(Boolean)
}

/** Le casse in rete: [{ ip, location }] (`location` è la descrizione UPnP, se SSDP l'ha data). */
export async function discover() {
  const [bySsdp, byScan] = await Promise.all([ssdp(2500), scanYamaha(1500)])
  const result = new Map(byScan.map((device) => [device.ip, device]))
  for (const device of bySsdp) result.set(device.ip, device)
  return [...result.values()]
}

/** Una richiesta HTTP verso la rete di casa, fatta per conto della pagina. */
export async function lanHttp({ method = 'GET', url, headers = {}, body, timeoutMs = 8000 }) {
  const target = new URL(url)
  if (target.protocol !== 'http:' || !isPrivateIPv4(target.hostname)) throw new Error('Indirizzo non ammesso.')
  // Le casse chiudono la connessione dopo ogni risposta: niente riuso, o la richiesta dopo fallisce.
  const response = await fetch(target, {
    method,
    headers: { ...headers, Connection: 'close' },
    body: method === 'GET' ? undefined : body,
    signal: AbortSignal.timeout(Math.min(Number(timeoutMs) || 8000, 30_000)),
  })
  return { status: response.status, text: await response.text() }
}

const API_HOSTS = new Set(['api.pcloud.com', 'eapi.pcloud.com'])

/**
 * Il link pCloud del brano, pronto per una cassa: http://<IP del server>/<percorso>.
 * `transcode` chiede l'mp3 fatto da pCloud (per i formati che la cassa non suona).
 */
export async function castLink({ host, kind, token, fileid, transcode }) {
  if (!API_HOSTS.has(host)) throw new Error('Server pCloud non valido.')
  if (!Number.isInteger(Number(fileid))) throw new Error('Brano non valido.')
  const query = new URLSearchParams({ fileid: String(fileid) })
  query.set(kind === 'session' ? 'auth' : 'access_token', String(token))
  if (transcode) query.set('abitrate', '320')
  const method = transcode ? 'getaudiolink' : 'getfilelink'
  const response = await fetch(`https://${host}/${method}?${query}`, { signal: AbortSignal.timeout(20_000) })
  const data = await response.json()
  if (data.result !== 0) {
    const error = new Error(data.error || `Errore pCloud ${data.result}.`)
    error.code = data.result
    throw error
  }
  return { url: await numericUrl(`https://${data.hosts[0]}${data.path}`) }
}

/** Lo stesso indirizzo con l'IPv4 al posto del nome e in http. */
export async function numericUrl(link) {
  const url = new URL(link)
  const { address } = await lookup(url.hostname, { family: 4 })
  return `http://${address}${url.pathname}${url.search}`
}
