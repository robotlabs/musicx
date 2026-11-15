import { authStore, loginConfigured, redirectUri, startLogin } from '../lib/auth'
import { useStore } from '../lib/store'

export function Login() {
  const { notice } = useStore(authStore)
  return (
    <main className="login">
      <img src="./favicon.svg" alt="" width="84" height="84" />
      <h1>musicx</h1>
      <p className="dim">La tua musica, direttamente da pCloud.</p>
      {notice && <p className="login-notice">{notice}</p>}
      {loginConfigured() ? (
        <button className="pill primary big" onClick={startLogin}>
          Accedi con pCloud
        </button>
      ) : (
        <div className="setup">
          <p>
            Manca il <b>Client ID</b> dell'app pCloud. Va creato una volta su{' '}
            <a href="https://docs.pcloud.com/my_apps/" target="_blank" rel="noreferrer">
              docs.pcloud.com/my_apps
            </a>{' '}
            e scritto in <code>src/config.ts</code>.
          </p>
          <p>Indirizzo di ritorno (redirect URI) da registrare per questa pagina:</p>
          <code className="block">{redirectUri()}</code>
        </div>
      )}
    </main>
  )
}
