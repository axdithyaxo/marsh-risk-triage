import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, ApiError, setUnauthorizedHandler } from './api'
import { AuthContext, type Status } from './authContext'
import type { User } from './types'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [status, setStatus] = useState<Status>('loading')

  useEffect(() => {
    // Is there already a live session (e.g. after a page reload)?
    api
      .get<{ user: User }>('/api/auth/me')
      .then((r) => {
        setUser(r.user)
        setStatus('authenticated')
      })
      .catch((e) => {
        // 401 is the normal "not signed in"; anything else is still "not signed in" to the UI.
        if (!(e instanceof ApiError)) console.error(e)
        setStatus('anonymous')
      })
    // A session that dies mid-use sends the user back to the login screen.
    setUnauthorizedHandler(() => {
      setUser(null)
      setStatus('anonymous')
    })
    return () => setUnauthorizedHandler(null)
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const r = await api.post<{ user: User }>('/api/auth/login', { email, password })
    setUser(r.user)
    setStatus('authenticated')
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout')
    } finally {
      setUser(null)
      setStatus('anonymous')
    }
  }, [])

  const value = useMemo(() => ({ status, user, login, logout }), [status, user, login, logout])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
