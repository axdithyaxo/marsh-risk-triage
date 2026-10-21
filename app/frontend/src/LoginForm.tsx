import { useState, type FormEvent } from 'react'
import { useAuth } from './authContext'

export function LoginForm() {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    try {
      await login(email, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed')
      setPassword('')
    } finally {
      setPending(false)
    }
  }

  return (
    <form className="panel login-card" onSubmit={onSubmit} aria-label="Sign in">
      <h2 className="login-title">Sign in</h2>
      <div>
        <label className="field-label" htmlFor="email">Email</label>
        <input id="email" className="text-input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <label className="field-label" htmlFor="password">Password</label>
        <input id="password" className="text-input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      {error && <p className="error-banner" role="alert">{error}</p>}
      <button className="primary-button" type="submit" disabled={pending || !email || !password}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}
