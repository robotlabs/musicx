import { describe, expect, it } from 'vitest'
import { didl, hms, parseDescription, seconds, soapFault, soapRequest, soapValues } from './dlna'

// La descrizione vera della CRX-N470D di casa (accorciata).
const YAMAHA_DESC = `<?xml version="1.0"?>
<root xmlns="urn:schemas-upnp-org:device-1-0" xmlns:yamaha="urn:schemas-yamaha-com:device-1-0">
<device><friendlyName>lounge-room</friendlyName><manufacturer>Yamaha Corporation</manufacturer><modelName>CRX-N470D</modelName>
<serviceList>
<service><serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType><SCPDURL>/AVTransport/desc.xml</SCPDURL><controlURL>/AVTransport/ctrl</controlURL></service>
<service><serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType><controlURL>/RenderingControl/ctrl</controlURL></service>
</serviceList></device>
<yamaha:X_device><yamaha:X_URLBase>http://192.168.1.100:80/</yamaha:X_URLBase><yamaha:X_serviceList><yamaha:X_service>
<yamaha:X_specType>urn:schemas-yamaha-com:service:X_YamahaExtendedControl:1</yamaha:X_specType></yamaha:X_service></yamaha:X_serviceList></yamaha:X_device>
</root>`

describe('DLNA', () => {
  it('scrive la busta SOAP con InstanceID e i valori senza rompere l’XML', () => {
    const request = soapRequest('AVTransport', 'SetAVTransportURI', { CurrentURI: 'http://1.2.3.4/a b&c.mp3' })
    expect(request.headers.SOAPACTION).toBe('"urn:schemas-upnp-org:service:AVTransport:1#SetAVTransportURI"')
    expect(request.body).toContain('<InstanceID>0</InstanceID><CurrentURI>http://1.2.3.4/a b&amp;c.mp3</CurrentURI>')
  })

  it('legge i valori della risposta e gli errori', () => {
    const reply =
      '<s:Envelope><s:Body><u:GetPositionInfoResponse xmlns:u="x"><TrackURI>http://1.2.3.4/x.mp3?a=1&amp;b=2</TrackURI>' +
      '<RelTime>0:01:05</RelTime><TrackMetaData>&lt;DIDL-Lite&gt;</TrackMetaData></u:GetPositionInfoResponse></s:Body></s:Envelope>'
    expect(soapValues(reply)).toMatchObject({ TrackURI: 'http://1.2.3.4/x.mp3?a=1&b=2', RelTime: '0:01:05', TrackMetaData: '<DIDL-Lite>' })
    expect(soapFault(reply)).toBeNull()
    const fault =
      '<s:Envelope><s:Body><s:Fault><faultstring>UPnPError</faultstring><detail><UPnPError><errorCode>701</errorCode>' +
      '<errorDescription>Transition not available</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>'
    expect(soapFault(fault)).toBe('701 Transition not available')
  })

  it('legge nome e indirizzi di controllo dalla descrizione di una MusicCast', () => {
    expect(parseDescription(YAMAHA_DESC, 'http://192.168.1.100:49154/MediaRenderer/desc.xml')).toEqual({
      name: 'lounge-room',
      model: 'CRX-N470D',
      manufacturer: 'Yamaha Corporation',
      // Relativi alla descrizione (porta 49154), non all'URL dell'API Yamaha (porta 80).
      avTransport: 'http://192.168.1.100:49154/AVTransport/ctrl',
      renderingControl: 'http://192.168.1.100:49154/RenderingControl/ctrl',
      yamaha: true,
    })
  })

  it('usa URLBase quando la descrizione lo dà', () => {
    const xml = `<root><URLBase>http://10.0.0.5:8080/</URLBase><device><friendlyName>Altra</friendlyName><serviceList>
      <service><serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType><controlURL>upnp/av</controlURL></service>
      </serviceList></device></root>`
    const description = parseDescription(xml, 'http://10.0.0.5:1400/desc.xml')
    expect(description.avTransport).toBe('http://10.0.0.5:8080/upnp/av')
    expect(description.renderingControl).toBeNull()
    expect(description.yamaha).toBe(false)
  })

  it('converte i tempi', () => {
    expect(hms(0)).toBe('0:00:00')
    expect(hms(3725.9)).toBe('1:02:05')
    expect(seconds('0:04:47')).toBe(287)
    expect(seconds('0:00:09.500')).toBe(9.5)
    expect(seconds('NOT_IMPLEMENTED')).toBe(0)
    expect(seconds(undefined)).toBe(0)
  })

  it('mette titolo, artista, formato e durata nei metadati', () => {
    const meta = didl('http://1.2.3.4/a.flac', { title: 'Rock & Roll', artist: 'AC<DC', mime: 'audio/flac', duration: 287 })
    expect(meta).toContain('<dc:title>Rock &amp; Roll</dc:title>')
    expect(meta).toContain('<upnp:artist>AC&lt;DC</upnp:artist>')
    expect(meta).toContain('<res protocolInfo="http-get:*:audio/flac:*" duration="0:04:47.000">http://1.2.3.4/a.flac</res>')
  })
})
