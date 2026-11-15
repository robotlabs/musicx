import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { authStore, consumeLoginRedirect } from './lib/auth'
import { useStore } from './lib/store'
import './styles.css'
import { Login } from './ui/Login'
import { Main } from './ui/Main'

function App() {
  const signedIn = useStore(authStore, (state) => state.auth !== null)
  return signedIn ? <Main /> : <Login />
}

async function start() {
  // Solo in sviluppo: con ?fake (o ?fake=20 per brani da 20 secondi) si usa un pCloud finto.
  const fake = new URLSearchParams(location.search).get('fake')
  if (import.meta.env.DEV && fake !== null) {
    const { installFake } = await import('./lib/fake')
    installFake(Number(fake) || undefined)
  } else {
    consumeLoginRedirect()
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )

  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {})
  }
}

void start()
