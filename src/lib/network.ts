// C'è rete o no. Senza rete suonano solo i brani salvati sul dispositivo.
// Nell'app Android navigator.onLine non se ne accorge (resta true anche in modalità aereo): lì lo
// dice il lato nativo, con il plugin Network di Capacitor.

import { Capacitor } from '@capacitor/core'
import { Network } from '@capacitor/network'
import { isNativeApp } from './native'
import { createStore } from './store'

export const onlineStore = createStore(typeof navigator === 'undefined' || navigator.onLine !== false)

if (isNativeApp && Capacitor.isPluginAvailable('Network')) {
  void Network.getStatus().then((status) => onlineStore.set(status.connected), () => {})
  void Network.addListener('networkStatusChange', (status) => onlineStore.set(status.connected)).catch(() => {})
} else if (typeof window !== 'undefined') {
  window.addEventListener('online', () => onlineStore.set(true))
  window.addEventListener('offline', () => onlineStore.set(false))
}

export const isOnline = () => onlineStore.get()
