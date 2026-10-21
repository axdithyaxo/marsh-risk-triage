import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AuditLog } from './AuditLog'
import { mockApi } from './test/mockApi'

const entry = { seq: 1, timestamp: '2026-10-21T10:00:00Z', assessment_id: 'a', decision: 'bind', rationale: 'clean', stakeholder_id: 'abcdef123456', stakeholder_role: 'underwriter', computed_oversight_level: 'PRE_EXECUTION', entry_hash: 'f'.repeat(64) }

describe('AuditLog', () => {
  it('shows an intact chain and the recorded decisions', async () => {
    mockApi({
      'GET /api/ledger': () => [200, { count: 1, head_hash: 'f'.repeat(64), entries: [entry] }],
      'GET /api/ledger/verify': () => [200, { ok: true, entries: 1, head_hash: 'f'.repeat(64), error: null }],
    })
    render(<AuditLog />)
    expect(await screen.findByRole('status')).toHaveTextContent('Chain intact: 1 entries verified')
    expect(screen.getByText('clean')).toBeInTheDocument()
  })

  it('shouts when the chain is broken, and where', async () => {
    mockApi({
      'GET /api/ledger': () => [503, { error: 'audit log is not intact' }],
      'GET /api/ledger/verify': () => [200, { ok: false, entries: 0, head_hash: '0'.repeat(64), error: { seq: 2, reason: 'signature mismatch' } }],
    })
    render(<AuditLog />)
    const alerts = await screen.findAllByRole('alert')
    expect(alerts.map((a) => a.textContent).join(' ')).toMatch(/Chain BROKEN at entry 2: signature mismatch/)
  })
})
