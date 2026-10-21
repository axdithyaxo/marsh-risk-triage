import { useEffect, useState } from 'react'
import { api } from './api'
import type { LedgerEntry, Verification } from './types'

interface Ledger {
  count: number
  head_hash: string
  entries: LedgerEntry[]
}

const short = (h: string) => `${h.slice(0, 10)}…`

export function AuditLog() {
  const [ledger, setLedger] = useState<Ledger | null>(null)
  const [verification, setVerification] = useState<Verification | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(true) // the first verification starts on mount

  const verifyNow = () => {
    setVerifying(true)
    api
      .get<Verification>('/api/ledger/verify')
      .then((v) => {
        setVerification(v)
        setError(null)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setVerifying(false))
  }

  useEffect(() => {
    // A broken log makes /ledger itself answer 503, so verification is shown
    // independently of the listing.
    api.get<Ledger>('/api/ledger?limit=100').then(setLedger).catch((e) => setError(e.message))
    api
      .get<Verification>('/api/ledger/verify')
      .then(setVerification)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setVerifying(false))
  }, [])

  return (
    <div className="panel">
      {verification && (
        <p className={verification.ok ? 'status-banner' : 'error-banner'} role={verification.ok ? 'status' : 'alert'}>
          {verification.ok
            ? `Chain intact: ${verification.entries} entries verified. Head ${short(verification.head_hash)}`
            : `Chain BROKEN at entry ${verification.error?.seq}: ${verification.error?.reason}`}
        </p>
      )}
      <button className="primary-button" onClick={verifyNow} disabled={verifying}>{verifying ? 'Verifying…' : 'Verify now'}</button>
      {error && <p className="error-banner" role="alert">Error: {error}</p>}
      {ledger && (
        <>
          <p className="confidence-line">
            {ledger.count} recorded decisions. Keep the head hash and count somewhere independent to detect later truncation.
          </p>
          <table className="data-table">
            <thead>
              <tr><th>#</th><th>Time</th><th>Decision</th><th>By</th><th>Rationale</th><th>Hash</th></tr>
            </thead>
            <tbody>
              {ledger.entries.map((e) => (
                <tr key={e.seq}>
                  <td>{e.seq}</td>
                  <td>{new Date(e.timestamp).toLocaleString()}</td>
                  <td><span className={`status-pill status-${e.decision}`}>{e.decision}</span></td>
                  <td title={e.stakeholder_id}>{e.stakeholder_role} {e.stakeholder_id.slice(0, 8)}</td>
                  <td>{e.rationale}</td>
                  <td className="mono">{short(e.entry_hash)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}
