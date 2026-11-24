// Casse finte per lo sviluppo (?fake) e i test: rispondono come due MusicCast (DLNA + API Yamaha),
// con il tempo che passa davvero, così "Trasmetti" si prova senza far suonare niente in casa.

import type { CastBackend, HttpRequest } from './backend'
import { hms, seconds, soapValues } from './dlna'

interface FakeSpeaker {
  ip: string
  name: string
  model: string
  power: string
  volume: number
  input: string
  uri: string
  nextUri: string
  state: string
  /** Posizione quando è partito l'ultimo tratto, e quando. */
  offset: number
  startedAt: number
}

export function fakeCastBackend(trackSeconds = 6, options: { supportsNext?: boolean } = {}) {
  const supportsNext = options.supportsNext ?? true
  const speakers = new Map<string, FakeSpeaker>(
    [
      ['192.168.1.100', 'Soggiorno', 'CRX-N470D'],
      ['192.168.1.122', 'Camera', 'WX-021'],
    ].map(([ip, name, model]) => [
      ip,
      { ip, name, model, power: 'standby', volume: 20, input: 'spotify', uri: '', nextUri: '', state: 'NO_MEDIA_PRESENT', offset: 0, startedAt: 0 },
    ]),
  )

  const position = (speaker: FakeSpeaker) =>
    speaker.state === 'PLAYING' ? speaker.offset + (Date.now() - speaker.startedAt) / 1000 : speaker.offset

  /** Fa passare il tempo: a fine brano va al preparato o si ferma. */
  const tick = (speaker: FakeSpeaker) => {
    if (speaker.state !== 'PLAYING' || position(speaker) < trackSeconds) return
    if (speaker.nextUri) {
      speaker.startedAt = speaker.startedAt + (trackSeconds - speaker.offset) * 1000
      speaker.offset = 0
      speaker.uri = speaker.nextUri
      speaker.nextUri = ''
      tick(speaker)
    } else {
      speaker.state = 'STOPPED'
      speaker.offset = 0
    }
  }

  const description = (speaker: FakeSpeaker) =>
    `<?xml version="1.0"?><root><device><friendlyName>${speaker.name}</friendlyName><manufacturer>Yamaha Corporation</manufacturer>` +
    `<modelName>${speaker.model}</modelName><serviceList>` +
    `<service><serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType><controlURL>/AVTransport/ctrl</controlURL></service>` +
    `<service><serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType><controlURL>/RenderingControl/ctrl</controlURL></service>` +
    `</serviceList></device><yamaha:X_device><yamaha:X_URLBase>http://${speaker.ip}:80/</yamaha:X_URLBase>` +
    `<yamaha:X_specType>urn:schemas-yamaha-com:service:X_YamahaExtendedControl:1</yamaha:X_specType></yamaha:X_device></root>`

  const envelope = (action: string, values: Record<string, string> = {}) =>
    '<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>' +
    `<u:${action}Response xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">` +
    Object.entries(values)
      .map(([name, value]) => `<${name}>${value.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</${name}>`)
      .join('') +
    `</u:${action}Response></s:Body></s:Envelope>`

  const fault = (code: number, text: string) =>
    '<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault>' +
    `<faultstring>UPnPError</faultstring><detail><UPnPError><errorCode>${code}</errorCode><errorDescription>${text}</errorDescription></UPnPError></detail>` +
    '</s:Fault></s:Body></s:Envelope>'

  function soap(speaker: FakeSpeaker, request: HttpRequest) {
    const action = /#(\w+)"?$/.exec(request.headers?.SOAPACTION ?? '')?.[1] ?? ''
    const args = soapValues(request.body ?? '')
    tick(speaker)
    switch (action) {
      case 'SetAVTransportURI':
        Object.assign(speaker, { uri: args.CurrentURI, nextUri: '', state: 'STOPPED', offset: 0, power: 'on', input: 'server' })
        return envelope(action)
      case 'SetNextAVTransportURI':
        if (!supportsNext) return fault(401, 'Invalid Action')
        speaker.nextUri = args.NextURI
        return envelope(action)
      case 'Play':
        if (!speaker.uri) return fault(701, 'Transition not available')
        if (speaker.state !== 'PLAYING') Object.assign(speaker, { state: 'PLAYING', startedAt: Date.now() })
        return envelope(action)
      case 'Pause':
        Object.assign(speaker, { offset: position(speaker), state: 'PAUSED_PLAYBACK' })
        return envelope(action)
      case 'Stop':
        Object.assign(speaker, { offset: 0, state: speaker.uri ? 'STOPPED' : 'NO_MEDIA_PRESENT' })
        return envelope(action)
      case 'Seek':
        Object.assign(speaker, { offset: Math.min(seconds(args.Target), trackSeconds), startedAt: Date.now() })
        return envelope(action)
      case 'GetTransportInfo':
        return envelope(action, { CurrentTransportState: speaker.state, CurrentTransportStatus: 'OK', CurrentSpeed: '1' })
      case 'GetPositionInfo':
        // Come le MusicCast vere con i link di pCloud: la durata non la sanno, e l'indirizzo lo
        // restituiscono con la porta (http://1.2.3.4:80/…, anche se è arrivato senza).
        return envelope(action, {
          Track: '1',
          TrackDuration: '0:00:00',
          TrackURI: speaker.uri.replace(/^(http:\/\/[^/:]+)\//, '$1:80/'),
          RelTime: hms(position(speaker)),
        })
      case 'GetVolume':
        return envelope(action, { CurrentVolume: String(speaker.volume) })
      case 'SetVolume':
        speaker.volume = Number(args.DesiredVolume)
        return envelope(action)
      default:
        return fault(401, 'Invalid Action')
    }
  }

  function yxc(speaker: FakeSpeaker, path: string) {
    const [route, query = ''] = path.split('?')
    const params = new URLSearchParams(query)
    if (route === 'main/getStatus') {
      return { response_code: 0, power: speaker.power, volume: speaker.volume, max_volume: 60, input: speaker.input }
    }
    if (route === 'main/setVolume') speaker.volume = Number(params.get('volume'))
    if (route === 'main/setPower') speaker.power = params.get('power') ?? speaker.power
    if (route === 'dist/setClientInfo') speaker.input = 'mc_link'
    return { response_code: 0 }
  }

  const backend: CastBackend = {
    problem: async () => null,
    async discover() {
      await new Promise((resolve) => setTimeout(resolve, 600))
      return [
        { ip: '192.168.1.100', location: 'http://192.168.1.100:49154/MediaRenderer/desc.xml' },
        // Trovata solo con l'API Yamaha (senza SSDP).
        { ip: '192.168.1.122', location: null },
      ]
    },
    async http(request) {
      await new Promise((resolve) => setTimeout(resolve, 40))
      const url = new URL(request.url)
      const speaker = speakers.get(url.hostname)
      if (!speaker) throw new Error('Rete non raggiungibile.')
      if (url.pathname.endsWith('desc.xml')) return { status: 200, text: description(speaker) }
      if (url.pathname.startsWith('/YamahaExtendedControl/v1/')) {
        return { status: 200, text: JSON.stringify(yxc(speaker, url.pathname.slice(26) + url.search)) }
      }
      const text = soap(speaker, request)
      return { status: text.includes('Fault') ? 500 : 200, text }
    },
    link: async (fileid, transcode) => `http://10.0.0.1/fake/${fileid}.${transcode ? 'transcoded.mp3' : 'mp3'}`,
  }
  return { backend, speakers }
}
