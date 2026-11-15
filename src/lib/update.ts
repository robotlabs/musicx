// Una finestra dell'app (soprattutto quella installata) resta aperta anche per giorni con il codice
// di quando è stata caricata. Ogni tanto controlla se su GitHub Pages c'è una versione nuova e, se
// sì, lo dice. Non ricarica da sola: fermerebbe la musica.

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
  try {
    // Un indirizzo sempre diverso, così non risponde né la cache del browser né quella del service worker.
    const response = await fetch(`./?versione=${Date.now()}`, { cache: 'no-store' })
    const latest = response.ok ? bundleOf(await response.text()) : null
    if (latest && latest !== running) updateStore.set(true)
  } catch {
    // Senza rete si riprova la prossima volta.
  }
}

export function watchForUpdates() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check()
  })
  setInterval(() => void check(), 30 * 60 * 1000)
}
