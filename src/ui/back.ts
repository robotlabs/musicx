// Tasto indietro di Android: chiude il pannello aperto, poi il lettore aperto, poi torna alla pagina
// di prima. Sulla prima pagina manda l'app in secondo piano (la musica continua) invece di chiuderla.
// Serve il plugin App, che c'è solo negli APK nuovi: con quelli vecchi resta il comportamento di prima.

import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { isNativeApp } from '../lib/native'
import { dismissSheet, sheetOpen } from './sheets'

const closers: (() => void)[] = []

/** Finché è registrato, "indietro" chiama `close` (l'ultimo registrato per primo). */
export function onBack(close: () => void): () => void {
  closers.push(close)
  return () => {
    const at = closers.lastIndexOf(close)
    if (at >= 0) closers.splice(at, 1)
  }
}

let started = false

export function startBackButton() {
  if (started || !isNativeApp || !Capacitor.isPluginAvailable('App')) return
  started = true
  void App.addListener('backButton', ({ canGoBack }) => {
    if (sheetOpen()) return dismissSheet()
    const close = closers[closers.length - 1]
    if (close) return close()
    if (canGoBack) history.back()
    else void App.minimizeApp()
  })
}
