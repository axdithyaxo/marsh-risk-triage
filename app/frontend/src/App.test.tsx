import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from './App'
import { auditor, mockApi, underwriter } from './test/mockApi'

const emptyHistory = { 'GET /api/assessments': () => [200, { total: 0, assessments: [] }] as [number, unknown] }

describe('App', () => {
  it('shows the sign-in form when there is no session', async () => {
    mockApi({ 'GET /api/auth/me': () => [401, { error: 'authentication required' }] })
    render(<App />)
    expect(await screen.findByRole('form', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('gives an underwriter the working tabs and no audit log', async () => {
    mockApi({ 'GET /api/auth/me': () => [200, { user: underwriter }], ...emptyHistory })
    render(<App />)
    expect(await screen.findByRole('button', { name: 'New assessment' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'My assessments' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Audit log' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Property risk submission')).toBeInTheDocument()
  })

  it('gives an auditor read-only views and no way to submit', async () => {
    mockApi({
      'GET /api/auth/me': () => [200, { user: auditor }],
      ...emptyHistory,
      'GET /api/ledger': () => [200, { count: 0, head_hash: '0'.repeat(64), entries: [] }],
      'GET /api/ledger/verify': () => [200, { ok: true, entries: 0, head_hash: '0'.repeat(64), error: null }],
    })
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Audit log' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New assessment' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Property risk submission')).not.toBeInTheDocument()
  })

  it('signs out back to the login screen', async () => {
    const m = mockApi({
      'GET /api/auth/me': () => [200, { user: underwriter }],
      'POST /api/auth/logout': () => [204],
      ...emptyHistory,
    })
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('form', { name: 'Sign in' })).toBeInTheDocument()
    expect(m.calls('POST /api/auth/logout')).toHaveLength(1)
  })

  it('drops to the login screen when the session expires mid-use', async () => {
    mockApi({
      'GET /api/auth/me': () => [200, { user: underwriter }],
      'GET /api/assessments': () => [401, { error: 'authentication required' }],
    })
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: 'My assessments' }))
    expect(await screen.findByRole('form', { name: 'Sign in' })).toBeInTheDocument()
  })
})
