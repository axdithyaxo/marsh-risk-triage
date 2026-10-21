import { createContext, useContext } from 'react'
import type { User } from './types'

export type Status = 'loading' | 'anonymous' | 'authenticated'

export interface AuthValue {
  status: Status
  user: User | null
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

export const AuthContext = createContext<AuthValue | null>(null)

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
