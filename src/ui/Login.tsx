import { useState, type FormEvent } from 'react'
import { authStore, loginConfigured, startLogin } from '../lib/auth'
import { completeLogin, passwordLogin, type Challenge, type LoginStep } from '../lib/passwordLogin'
import { useStore } from '../lib/store'

function challengeText(challenge: Challenge): string {
  if (challenge.kind === 'email') return 'pCloud ti ha mandato un codice via email per confermare questo dispositivo.'
  return challenge.sms ? 'pCloud ti ha mandato un codice via SMS.' : 'Scrivi il codice della tua app di autenticazione.'
}

/** Email e password vanno solo a pCloud; poi, se pCloud lo chiede, il codice di verifica. */
function PasswordLogin({ autoFocus }: { autoFocus: boolean }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [challenge, setChallenge] = useState<Challenge | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (task: () => Promise<LoginStep>) => {
    setBusy(true)
    setError(null)
    try {
      const step = await task()
      // Se l'accesso è fatto, questa schermata sparisce da sola.
      if (!step.done) {
        setChallenge(step.challenge)
        setCode('')
      }
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Accesso non riuscito.')
    } finally {
      setBusy(false)
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    if (challenge) void run(() => completeLogin(challenge, code.trim(), email.trim(), password))
    else void run(() => passwordLogin(email.trim(), password))
  }

  return (
    <form className="login-form" onSubmit={submit}>
      {/* Restano nella pagina anche durante il codice, così Chrome può proporre di salvarle. */}
      <div hidden={challenge !== null} className="login-fields">
        <input
          type="email"
          name="email"
          autoComplete="username"
          placeholder="Email pCloud"
          aria-label="Email pCloud"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          autoFocus={autoFocus}
        />
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          placeholder="Password"
          aria-label="Password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </div>
      {challenge && (
        <>
          <p>{challengeText(challenge)}</p>
          <input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="Codice"
            aria-label="Codice di verifica"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            required
            autoFocus
          />
        </>
      )}
      {error && <p className="login-notice">{error}</p>}
      <button className="pill primary big" type="submit" disabled={busy}>
        {busy ? 'Un momento…' : challenge ? 'Conferma' : 'Accedi'}
      </button>
      {challenge ? (
        <button
          type="button"
          className="text-button"
          onClick={() => {
            setChallenge(null)
            setError(null)
          }}
        >
          Annulla
        </button>
      ) : (
        <p className="login-hint">La password va solo a pCloud e non viene salvata. "Esci da pCloud" chiude la sessione.</p>
      )}
    </form>
  )
}

export function Login() {
  const { notice } = useStore(authStore)
  const oauth = loginConfigured()
  // Con l'app pCloud approvata l'accesso principale è quello OAuth; email e password restano di riserva.
  const [withPassword, setWithPassword] = useState(!oauth)

  return (
    <main className="login">
      <img src="./favicon.svg" alt="" width="84" height="84" />
      <h1>musicx</h1>
      <p className="dim">La tua musica, direttamente da pCloud.</p>
      {notice && <p className="login-notice">{notice}</p>}
      {oauth && (
        <button className="pill primary big" onClick={startLogin}>
          Accedi con pCloud
        </button>
      )}
      {withPassword ? (
        <PasswordLogin autoFocus={oauth} />
      ) : (
        <button className="text-button" onClick={() => setWithPassword(true)}>
          Accedi con email e password
        </button>
      )}
    </main>
  )
}
