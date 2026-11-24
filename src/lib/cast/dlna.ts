// DLNA/UPnP come testo: buste SOAP, descrizione della cassa, metadati DIDL. Niente rete qui dentro,
// così si può testare.

export type Service = 'AVTransport' | 'RenderingControl'

const escapeXml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const unescapeXml = (text: string) =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')

export const serviceType = (service: Service) => `urn:schemas-upnp-org:service:${service}:1`

/** La busta SOAP di un comando (InstanceID 0 va sempre per primo). */
export function soapRequest(service: Service, action: string, args: Record<string, string | number> = {}) {
  const body = Object.entries({ InstanceID: 0, ...args })
    .map(([name, value]) => `<${name}>${escapeXml(String(value))}</${name}>`)
    .join('')
  return {
    headers: {
      'Content-Type': 'text/xml; charset="utf-8"',
      SOAPACTION: `"${serviceType(service)}#${action}"`,
    },
    body:
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
      `<s:Body><u:${action} xmlns:u="${serviceType(service)}">${body}</u:${action}></s:Body></s:Envelope>`,
  }
}

/** I valori della risposta SOAP (solo gli elementi semplici, già senza escape). */
export function soapValues(xml: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const match of xml.matchAll(/<(?:[\w-]+:)?([\w-]+)>([^<]*)<\/(?:[\w-]+:)?\1>/g)) {
    values[match[1]] = unescapeXml(match[2])
  }
  return values
}

/** Il motivo di un errore SOAP ("701 Transition not available"), se la risposta è un errore. */
export function soapFault(xml: string): string | null {
  if (!/Fault>/.test(xml)) return null
  const values = soapValues(xml)
  return [values.errorCode, values.errorDescription ?? values.faultstring].filter(Boolean).join(' ') || 'errore'
}

export interface Description {
  name: string
  model: string
  manufacturer: string
  /** URL di controllo completi. */
  avTransport: string | null
  renderingControl: string | null
  /** Ha l'API Yamaha (MusicCast): stanze collegabili e volume vero. */
  yamaha: boolean
}

/** Legge la descrizione UPnP (desc.xml) di una cassa. `location` è l'indirizzo da cui arriva. */
export function parseDescription(xml: string, location: string): Description {
  const tag = (name: string, text = xml) => {
    const match = new RegExp(`<(?:[\\w-]+:)?${name}>([^<]*)<`).exec(text)
    return match ? unescapeXml(match[1]).trim() : ''
  }
  const base = tag('URLBase') || location
  const control = (service: Service) => {
    for (const block of xml.matchAll(/<service>([\s\S]*?)<\/service>/g)) {
      if (!block[1].includes(serviceType(service))) continue
      const url = tag('controlURL', block[1])
      return url ? new URL(url, base).href : null
    }
    return null
  }
  return {
    name: tag('friendlyName'),
    model: tag('modelName'),
    manufacturer: tag('manufacturer'),
    avTransport: control('AVTransport'),
    renderingControl: control('RenderingControl'),
    yamaha: /X_YamahaExtendedControl/.test(xml),
  }
}

/** Secondi → "H:MM:SS", come lo vuole DLNA. */
export function hms(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** "H:MM:SS" (anche con i decimali) → secondi; 0 se non si legge ("NOT_IMPLEMENTED"). */
export function seconds(text: string | undefined): number {
  const match = /^(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(text?.trim() ?? '')
  if (!match) return 0
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
}

/**
 * Stesso indirizzo anche se la cassa lo restituisce scritto in un altro modo. Le MusicCast aggiungono
 * la porta (`http://1.2.3.4:80/…` per `http://1.2.3.4/…`); altre casse tolgono i %20 o scrivono le
 * lettere accentate in un'altra forma Unicode.
 */
export function sameUrl(a: string, b: string): boolean {
  return urlKey(a) === urlKey(b)
}

function urlKey(value: string) {
  const decode = (part: string) => {
    try {
      return decodeURIComponent(part).normalize('NFC')
    } catch {
      return part.normalize('NFC')
    }
  }
  const text = value.trim()
  try {
    // URL toglie da solo la porta predefinita e mette in minuscolo il nome.
    const url = new URL(text)
    return `${url.protocol}//${url.hostname}:${url.port}${decode(url.pathname)}${decode(url.search)}`
  } catch {
    return decode(text)
  }
}

const MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  m4b: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  aif: 'audio/aiff',
  aiff: 'audio/aiff',
  wma: 'audio/x-ms-wma',
}

/** Formati che una cassa DLNA suona da sé; per gli altri si chiede a pCloud l'mp3. */
export const CAST_EXT = new Set(Object.keys(MIME))

export const mimeOf = (extension: string) => MIME[extension] ?? 'audio/mpeg'

export interface TrackMeta {
  title: string
  artist: string
  album?: string
  mime: string
  /** In secondi, se si sa. */
  duration?: number
}

/** I metadati DIDL-Lite che accompagnano il brano (titolo e artista sul display della cassa). */
export function didl(url: string, meta: TrackMeta): string {
  const duration = meta.duration ? ` duration="${hms(meta.duration)}.000"` : ''
  return (
    '<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">' +
    '<item id="musicx" parentID="0" restricted="1">' +
    `<dc:title>${escapeXml(meta.title)}</dc:title>` +
    `<upnp:artist>${escapeXml(meta.artist)}</upnp:artist>` +
    (meta.album ? `<upnp:album>${escapeXml(meta.album)}</upnp:album>` : '') +
    '<upnp:class>object.item.audioItem.musicTrack</upnp:class>' +
    `<res protocolInfo="http-get:*:${meta.mime}:*"${duration}>${escapeXml(url)}</res>` +
    '</item></DIDL-Lite>'
  )
}
