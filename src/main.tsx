import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { authStore, consumeLoginRedirect } from './lib/auth'
import { isNativeApp } from './lib/native'
import { useStore } from './lib/store'
import { applyUpdate, startUpdates, updateStore, watchForUpdates } from './lib/update'
import './styles.css'
import { Login } from './ui/Login'
import { Main } from './ui/Main'

function UpdateBanner() {
  const ready = useStore(updateStore)
  if (!ready) return null
  return (
    <div className="update-banner" role="status">
      <span>C'è una versione nuova di musicx.</span>
      <button className="pill primary" onClick={applyUpdate}>
        Aggiorna
      </button>
    </div>
  )
}

function App() {
  const signedIn = useStore(authStore, (state) => state.auth !== null)
  return (
    <>
      {signedIn ? <Main /> : <Login />}
      <UpdateBanner />
    </>
  )
}

async function start() {
  // Solo in sviluppo: con ?fake (o ?fake=20 per brani da 20 secondi) si usa un pCloud finto;
  // con ?fake&login si parte dalla schermata di accesso.
  const search = new URLSearchParams(location.search)
  const fake = search.get('fake')
  if (import.meta.env.DEV && fake !== null) {
    const { installFake } = await import('./lib/fake')
    installFake(Number(fake) || undefined, !search.has('login'))
  } else {
    consumeLoginRedirect()
  }

  // Nell'app Android: se è già scaricata un'interfaccia più nuova, si passa subito a quella.
  if (import.meta.env.PROD && (await startUpdates())) return

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )

  if (import.meta.env.PROD) {
    // Nell'app Android l'interfaccia è dentro l'APK (o, quella vecchia, arriva dal sito attraverso il
    // guscio nativo che ci aggiunge il suo ponte): il service worker non serve, e lo salterebbe.
    if ('serviceWorker' in navigator && !isNativeApp) navigator.serviceWorker.register('./sw.js').catch(() => {})
    watchForUpdates()
  }
}

void start()
