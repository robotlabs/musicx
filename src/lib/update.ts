// Una finestra dell'app (soprattutto quella installata) resta aperta anche per giorni con il codice
// di quando è stata caricata. Ogni tanto controlla se su GitHub Pages c'è una versione nuova e, se
// sì, lo dice. Non ricarica da sola: fermerebbe la musica.

import { applyAppUpdate, bundledApp, downloadAppUpdate, startAppUpdates } from './appUpdate'
import { createStore } from './store'

export const updateStore = createStore(false)

const bundleOf = (html: string) => html.match(/assets\/(index-[\w-]+\.js)/)?.[1] ?? null

function runningBundle(): string | null {
  const script = document.querySelector<HTMLScriptElement>('script[type="module"][src*="assets/"]')
  return script ? bundleOf(script.src) : null
}

async function check() {
  const running = runningBundle()
  if (!running || updateStore.get()) return
  if (bundledApp) {
    // Nell'app la versione nuova si scarica prima, poi basta un tocco (o il prossimo avvio).
    if (await downloadAppUpdate(running).catch(() => false)) updateStore.set(true)
    return
  }
  try {
    // Un indirizzo sempre diverso, così non risponde né la cache del browser né quella del service worker.
    const response = await fetch(`./?versione=${Date.now()}`, { cache: 'no-store' })
    const latest = response.ok ? bundleOf(await response.text()) : null
    if (latest && latest !== running) updateStore.set(true)
  } catch {
    // Senza rete si riprova la prossima volta.
  }
}

/** "Aggiorna" del banner. */
export function applyUpdate() {
  if (bundledApp) void applyAppUpdate()
  else location.reload()
}

/** Nell'app: all'avvio passa alla versione scaricata, se c'è. true se la pagina si sta ricaricando. */
export const startUpdates = () => (bundledApp ? startAppUpdates(runningBundle()) : Promise.resolve(false))

export function watchForUpdates() {
  if (bundledApp) void check()
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check()
  })
  setInterval(() => void check(), 30 * 60 * 1000)
}
