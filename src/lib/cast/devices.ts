// Le casse di casa: chi c'è in rete e come si chiama. L'elenco dell'ultima ricerca resta salvato,
// così il pannello "Trasmetti" le mostra subito mentre ne cerca di nuove.

import { storageKey } from '../env'
import { createStore } from '../store'
import { castBackend, type Candidate, type CastBackend } from './backend'
import { parseDescription } from './dlna'

export interface Device {
  /** L'IP della cassa: in casa basta come identità. */
  ip: string
  name: string
  model: string
  /** URL di controllo DLNA. */
  avTransport: string
  renderingControl: string | null
  /** Yamaha MusicCast: si possono collegare altre stanze e il volume si legge dall'API Yamaha. */
  yamaha: boolean
}

interface DevicesState {
  devices: Device[]
  searching: boolean
  /** Perché non si trova niente (rete, servizio sul Mac, app vecchia). */
  problem: string | null
}

const KEY = () => storageKey('cast-devices')

function loadSaved(): Device[] {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY()) ?? '[]') as Device[]
    return Array.isArray(saved) ? saved.filter((device) => device && device.ip && device.avTransport) : []
  } catch {
    return []
  }
}

export const devicesStore = createStore<DevicesState>({ devices: [], searching: false, problem: null })

let loaded = false

/** Le casse salvate dall'ultima ricerca (per mostrarle subito). */
export function knownDevices(): Device[] {
  if (!loaded) {
    loaded = true
    devicesStore.set((state) => ({ ...state, devices: state.devices.length ? state.devices : loadSaved() }))
  }
  return devicesStore.get().devices
}

/** Legge la descrizione UPnP: nome, modello e indirizzi di controllo. null se non è una cassa DLNA. */
export async function describe(backend: CastBackend, candidate: Candidate): Promise<Device | null> {
  // Le MusicCast trovate con l'API Yamaha (senza SSDP) hanno la descrizione sempre lì.
  const location = candidate.location ?? `http://${candidate.ip}:49154/MediaRenderer/desc.xml`
  try {
    const reply = await backend.http({ url: location, timeoutMs: 4000 })
    if (reply.status !== 200) return null
    const description = parseDescription(reply.text, location)
    if (!description.avTransport) return null
    return {
      ip: candidate.ip,
      name: description.name || candidate.ip,
      model: [description.manufacturer, description.model].filter(Boolean).join(' '),
      avTransport: description.avTransport,
      renderingControl: description.renderingControl,
      yamaha: description.yamaha,
    }
  } catch {
    return null
  }
}

const byName = new Intl.Collator('it', { numeric: true, sensitivity: 'base' })

let searching: Promise<Device[]> | null = null

/** Cerca le casse in rete (2–3 secondi). Restituisce l'elenco aggiornato. */
export function searchDevices(): Promise<Device[]> {
  searching ??= (async () => {
    knownDevices()
    const backend = castBackend()
    if (!backend) return []
    devicesStore.set((state) => ({ ...state, searching: true }))
    try {
      const problem = await backend.problem()
      if (problem) {
        devicesStore.set((state) => ({ ...state, problem }))
        return devicesStore.get().devices
      }
      const candidates = await backend.discover()
      const found = (await Promise.all(candidates.map((candidate) => describe(backend, candidate)))).filter(
        (device): device is Device => device !== null,
      )
      found.sort((a, b) => byName.compare(a.name, b.name))
      devicesStore.set((state) => ({
        ...state,
        devices: found,
        problem: found.length ? null : 'Nessuna cassa trovata. Mac o telefono devono essere sul Wi-Fi di casa.',
      }))
      try {
        localStorage.setItem(KEY(), JSON.stringify(found))
      } catch {
        // Spazio esaurito: alla prossima apertura si ricerca da capo.
      }
      return found
    } catch (error) {
      devicesStore.set((state) => ({ ...state, problem: error instanceof Error ? error.message : String(error) }))
      return devicesStore.get().devices
    } finally {
      devicesStore.set((state) => ({ ...state, searching: false }))
      searching = null
    }
  })()
  return searching
}
