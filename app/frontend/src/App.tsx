import { useState } from 'react'
import './App.css'
import { AuditLog } from './AuditLog'
import { AuthProvider } from './auth'
import { useAuth } from './authContext'
import { History } from './History'
import { LoginForm } from './LoginForm'
import { SubmissionForm } from './SubmissionForm'

type Tab = 'new' | 'history' | 'audit'

function Shell() {
  const { user, logout } = useAuth()
  const isAuditor = user?.role === 'auditor'
  const [tab, setTab] = useState<Tab>(isAuditor ? 'history' : 'new')
  const [refreshKey, setRefreshKey] = useState(0)

  // The tabs a person sees follow their role, and the server enforces the same
  // rules: hiding a tab is a convenience, not the access control.
  const tabs: { id: Tab; label: string }[] = isAuditor
    ? [{ id: 'history', label: 'All assessments' }, { id: 'audit', label: 'Audit log' }]
    : [{ id: 'new', label: 'New assessment' }, { id: 'history', label: 'My assessments' }]

  return (
    <>
      <div className="topbar">
        <span>{user?.name} · <span className="role-chip">{user?.role}</span></span>
        <button className="link-button" onClick={() => void logout()}>Sign out</button>
      </div>
      <nav className="tabs" aria-label="Sections">
        {tabs.map((t) => (
          <button key={t.id} className={`tab${tab === t.id ? ' active' : ''}`} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      {tab === 'new' && !isAuditor && <SubmissionForm onDecided={() => setRefreshKey((k) => k + 1)} />}
      {tab === 'history' && user && <History role={user.role} refreshKey={refreshKey} />}
      {tab === 'audit' && isAuditor && <AuditLog />}
    </>
  )
}

function Gate() {
  const { status } = useAuth()
  if (status === 'loading') return <p className="confidence-line">Loading…</p>
  if (status === 'anonymous') return <LoginForm />
  return <Shell />
}

function App() {
  return (
    <div className="shell">
      <header className="shell-header">
        <p className="eyebrow">Property &amp; Casualty · Underwriting</p>
        <h1>Risk Triage Agent</h1>
        <p className="subhead">
          Three independent risk assessments run in parallel, then a human
          makes the bind/refer call — every decision signed into an append-only
          audit log.
        </p>
      </header>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </div>
  )
}

export default App
