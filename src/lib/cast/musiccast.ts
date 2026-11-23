// L'API Yamaha (Extended Control) delle casse MusicCast: volume e stanze collegate.
// Il brano lo suona una cassa sola via DLNA (ingresso "server"); le altre stanze la seguono con il
// collegamento MusicCast, come fa l'app Yamaha. L'ingresso AirPlay invece non si può condividere.

import type { CastBackend } from './backend'
import type { Device } from './devices'

export interface RoomStatus {
  power: 'on' | 'standby' | string
  volume: number
  maxVolume: number
  input: string
}

async function yxc<T = { response_code: number }>(backend: CastBackend, device: Device, path: string, body?: unknown): Promise<T> {
  const reply = await backend.http({
    method: body === undefined ? 'GET' : 'POST',
    url: `http://${device.ip}/YamahaExtendedControl/v1/${path}`,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    timeoutMs: 6000,
  })
  if (reply.status !== 200) throw new Error(`${device.name} ha risposto ${reply.status}.`)
  const data = JSON.parse(reply.text) as T & { response_code: number }
  if (data.response_code !== 0) throw new Error(`${device.name}: errore MusicCast ${data.response_code}.`)
  return data
}

export async function roomStatus(backend: CastBackend, device: Device): Promise<RoomStatus> {
  const data = await yxc<{ power: string; volume: number; max_volume: number; input: string }>(backend, device, 'main/getStatus')
  return { power: data.power, volume: data.volume, maxVolume: data.max_volume, input: data.input }
}

export const setRoomVolume = (backend: CastBackend, device: Device, volume: number) =>
  yxc(backend, device, `main/setVolume?volume=${Math.round(volume)}`)

/** Un id di gruppo nuovo (32 cifre esadecimali, come li fa l'app Yamaha). */
export function newGroupId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Collega le stanze `clients` alla cassa che suona (`server`). */
export async function linkRooms(backend: CastBackend, server: Device, clients: Device[], groupId: string) {
  if (!clients.length) return
  for (const client of clients) {
    await yxc(backend, client, 'main/setPower?power=on')
    await yxc(backend, client, 'dist/setClientInfo', { group_id: groupId, zone: ['main'], server_ip_address: server.ip })
  }
  await yxc(backend, server, 'dist/setServerInfo', {
    group_id: groupId,
    zone: 'main',
    type: 'add',
    client_list: clients.map((client) => client.ip),
  })
  await yxc(backend, server, 'dist/startDistribution?num=0')
  await yxc(backend, server, 'dist/setGroupName', { name: 'musicx' }).catch(() => {})
}

/**
 * Scollega le stanze `clients`. Con `keepGroup` (l'id del gruppo) le altre restano collegate;
 * con null il gruppo si chiude del tutto.
 */
export async function unlinkRooms(backend: CastBackend, server: Device, clients: Device[], keepGroup: string | null) {
  for (const client of clients) {
    await yxc(backend, client, 'dist/setClientInfo', { group_id: '', zone: ['main'] }).catch(() => {})
  }
  if (clients.length) {
    await yxc(backend, server, 'dist/setServerInfo', {
      group_id: keepGroup ?? '',
      zone: 'main',
      type: 'remove',
      client_list: clients.map((client) => client.ip),
    }).catch(() => {})
  }
  if (keepGroup) await yxc(backend, server, 'dist/startDistribution?num=0').catch(() => {})
  else await yxc(backend, server, 'dist/stopDistribution').catch(() => {})
}
