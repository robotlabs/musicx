import { describe, expect, it } from 'vitest'
import { readTags, TagError, writeTags } from './id3'

const bytes = (text: string) => [...text].map((char) => char.charCodeAt(0))
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
const safe = (n: number) => [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]
const text = (value: string) => [0, ...bytes(value)]

const frame3 = (id: string, data: number[]) => [...bytes(id), ...u32(data.length), 0, 0, ...data]
const frame4 = (id: string, data: number[]) => [...bytes(id), ...safe(data.length), 0, 0, ...data]
const frame2 = (id: string, data: number[]) => [...bytes(id), 0, 0, data.length, ...data]
const tag = (version: number, body: number[], flags = 0) => [0x49, 0x44, 0x33, version, 0, flags, ...safe(body.length), ...body]

/** Un frame mp3 finto: basta che cominci con la sincronizzazione. */
const AUDIO = [0xff, 0xfb, 0x90, 0x64, 0x00, 0xff, 0x00, 0x11, 0x22, 0x33]
const PICTURE = [0, ...bytes('image/jpeg'), 0, 3, 0, 0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]

const file = (...parts: number[][]) => Uint8Array.from(parts.flat())
const audioOf = (out: Uint8Array) => {
  const size = ((out[6] & 0x7f) << 21) | ((out[7] & 0x7f) << 14) | ((out[8] & 0x7f) << 7) | (out[9] & 0x7f)
  return [...out.subarray(10 + size)]
}
const v1 = (title: string, artist: string, album: string, track: number) => {
  const field = (value: string) => [...bytes(value), ...new Array(30 - value.length).fill(0)]
  return [...bytes('TAG'), ...field(title), ...field(artist), ...field(album), ...bytes('2001'), ...new Array(28).fill(0), 0, track, 12]
}

describe('tag ID3', () => {
  const original = file(
    tag(3, [...frame3('TIT2', text('Track 01')), ...frame3('APIC', PICTURE), ...frame3('TYER', text('1983')), 0, 0, 0, 0]),
    AUDIO,
  )

  it('legge i campi di un tag v2.3', () => {
    expect(readTags(original)).toEqual({ title: 'Track 01' })
  })

  it('cambia titolo e artista, lascia copertina, anno e audio come erano', () => {
    const out = writeTags(original, { title: 'Albachiara', artist: 'Vasco Rossi' })
    expect(readTags(out)).toEqual({ title: 'Albachiara', artist: 'Vasco Rossi' })
    expect(out[3]).toBe(3)
    const body = [...out]
    const find = (id: string) => body.findIndex((_, i) => String.fromCharCode(...body.slice(i, i + 4)) === id)
    expect(body.slice(find('APIC') + 10, find('APIC') + 10 + PICTURE.length)).toEqual(PICTURE)
    expect(find('TYER')).toBeGreaterThan(0)
    // Il titolo resta al suo posto, prima della copertina.
    expect(find('TIT2')).toBeLessThan(find('APIC'))
    expect(audioOf(out)).toEqual(AUDIO)
  })

  it('una stringa vuota toglie il campo, undefined lo lascia', () => {
    const out = writeTags(writeTags(original, { album: 'Vado al massimo' }), { title: '', album: undefined })
    expect(readTags(out)).toEqual({ album: 'Vado al massimo' })
  })

  it('scrive i caratteri fuori dal latin1 in UTF-16 (v2.3) o UTF-8 (v2.4)', () => {
    expect(readTags(writeTags(original, { artist: 'Сплин ★' }))).toMatchObject({ artist: 'Сплин ★' })
    const v24 = file(tag(4, [...frame4('TIT2', [3, ...new TextEncoder().encode('Città')])]), AUDIO)
    const out = writeTags(v24, { artist: 'Ēlo ★' })
    expect(out[3]).toBe(4)
    expect(readTags(out)).toEqual({ title: 'Città', artist: 'Ēlo ★' })
    expect(audioOf(out)).toEqual(AUDIO)
  })

  it('aggiunge il tag a un mp3 che non ne ha', () => {
    const out = writeTags(Uint8Array.from(AUDIO), { title: 'Senza tag', track: '3/12' })
    expect(readTags(out)).toEqual({ title: 'Senza tag', track: '3/12' })
    expect(audioOf(out)).toEqual(AUDIO)
  })

  it('converte un vecchio tag v2.2 in v2.3', () => {
    const out = writeTags(file(tag(2, [...frame2('TT2', text('Vecchio')), ...frame2('TAL', text('Album'))]), AUDIO), {
      artist: 'Qualcuno',
    })
    expect(out[3]).toBe(3)
    expect(readTags(out)).toEqual({ title: 'Vecchio', artist: 'Qualcuno', album: 'Album' })
  })

  it('dal v2.2 tiene anche copertina e commento', () => {
    const pic = [0, ...bytes('JPG'), 3, 0, 0xff, 0xd8, 0xff, 0xe0]
    const comment = [0, ...bytes('ita'), 0, ...bytes('bello')]
    const out = writeTags(file(tag(2, [...frame2('TT2', text('Vecchio')), ...frame2('PIC', pic), ...frame2('COM', comment)]), AUDIO), {
      artist: 'Qualcuno',
    })
    const body = [...out]
    const at = (id: string) => body.findIndex((_, i) => String.fromCharCode(...body.slice(i, i + 4)) === id)
    const apic = body.slice(at('APIC') + 10, at('APIC') + 10 + 18)
    expect(apic).toEqual([0, ...bytes('image/jpeg'), 0, 3, 0, 0xff, 0xd8, 0xff, 0xe0])
    expect(body.slice(at('COMM') + 10, at('COMM') + 10 + comment.length)).toEqual(comment)
    expect(audioOf(out)).toEqual(AUDIO)
  })

  it('accetta mp3 senza tag che cominciano con dei byte a zero', () => {
    const padded = Uint8Array.from([...new Array(626).fill(0), ...AUDIO])
    expect(readTags(writeTags(padded, { title: 'Ok' }))).toEqual({ title: 'Ok' })
  })

  it('capisce i tag v2.3 desincronizzati', () => {
    // FF 00 nel corpo è un FF "protetto": la dimensione del frame conta un FF solo.
    const body = [...bytes('TIT2'), ...u32(4), 0, 0, 0, 0x41, 0xff, 0x00, 0x42]
    const out = writeTags(file(tag(3, body, 0x80), AUDIO), { artist: 'X' })
    expect(readTags(out)).toEqual({ title: 'AÿB', artist: 'X' })
    expect(out[5]).toBe(0)
  })

  it('aggiorna anche il tag v1 in fondo al file', () => {
    const withV1 = file(tag(3, frame3('TIT2', text('Track 01'))), AUDIO, v1('Track 01', '', '', 1))
    const out = writeTags(withV1, { title: 'Albachiara', artist: 'Vasco Rossi', track: '2' })
    const tail = out.subarray(out.length - 128)
    expect(String.fromCharCode(...tail.subarray(3, 13))).toBe('Albachiara')
    expect(String.fromCharCode(...tail.subarray(33, 44))).toBe('Vasco Rossi')
    expect(tail[126]).toBe(2)
    expect(audioOf(out).slice(0, AUDIO.length)).toEqual(AUDIO)
  })

  it('legge il tag v1 se manca il v2', () => {
    expect(readTags(file(AUDIO, v1('Solo v1', 'Artista', 'Disco', 7)))).toEqual({
      title: 'Solo v1',
      artist: 'Artista',
      album: 'Disco',
      track: '7',
    })
  })

  it('non tocca file che non sembrano mp3 o con tag rovinati', () => {
    expect(() => writeTags(Uint8Array.from(bytes('RIFF....WAVE')), { title: 'x' })).toThrow(TagError)
    const broken = Uint8Array.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0x7f, 0x7f, 1, 2, 3])
    expect(() => writeTags(broken, { title: 'x' })).toThrow(TagError)
  })
})
