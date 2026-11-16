// L'app Android è un guscio Capacitor attorno a questo stesso sito (capacitor.config.ts).
// Serve per una cosa sola che la pagina web non può fare: farsi dare da pCloud i link ai brani.
// pCloud li rifiuta a qualsiasi pagina web ("Invalid link referer"), ma non a un'app installata,
// che chiede senza Origin né Referer. Il link vale per l'indirizzo IP che l'ha chiesto, cioè il
// telefono stesso: l'elemento <audio> della pagina lo può usare.

import { Capacitor, CapacitorHttp } from '@capacitor/core'

/** true dentro l'app Android musicx. */
export const isNativeApp = Capacitor.isNativePlatform()

/** true su un telefono Android che usa il sito in Chrome invece dell'app. */
export const isAndroidBrowser = !isNativeApp && typeof navigator !== 'undefined' && /Android/.test(navigator.userAgent)

/** Dove si scarica l'app Android. */
export const ANDROID_APP_URL = 'https://github.com/robotlabs/musicx/releases/latest/download/musicx.apk'

/** Scarica un file dal lato nativo (per riscriverne i tag). Il ponte di Capacitor lo passa in base64. */
export async function nativeGetBytes(url: string, timeoutMs: number): Promise<Uint8Array> {
  const response = await CapacitorHttp.get({ url, connectTimeout: timeoutMs, readTimeout: timeoutMs, responseType: 'arraybuffer' })
  if (response.status < 200 || response.status > 299) throw new Error(`pCloud ha risposto ${response.status}.`)
  const data: unknown = response.data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (typeof data === 'string') return Uint8Array.from(atob(data), (char) => char.charCodeAt(0))
  throw new Error('Il file scaricato non è leggibile.')
}

/** GET fatta dal lato nativo dell'app; restituisce stato HTTP e JSON già letto. */
export async function nativeGetJson(url: string, timeoutMs: number): Promise<{ status: number; data: unknown }> {
  const response = await CapacitorHttp.get({
    url,
    connectTimeout: timeoutMs,
    readTimeout: timeoutMs,
    responseType: 'json',
  })
  const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data
  return { status: response.status, data }
}
