import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import { BranchGrid } from './RiskCard'
import type { Assessment, AssessmentSummary, Role } from './types'

const when = (iso: string) => new Date(iso).toLocaleString()

function StatusBadge({ s }: { s: AssessmentSummary }) {
  const label = s.status === 'decided' ? (s.decision ?? 'decided') : s.status.replace('_', ' ')
  return <span className={`status-pill status-${s.status === 'decided' ? s.decision : s.status}`}>{label}</span>
}

function Detail({ id, onBack }: { id: string; onBack: () => void }) {
  const [a, setA] = useState<Assessment | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.get<Assessment>(`/api/assessments/${id}`).then(setA).catch((e) => setError(e.message))
  }, [id])

  return (
    <div className="panel">
      <button className="link-button" onClick={onBack}>← Back to list</button>
      {error && <p className="error-banner" role="alert">Error: {error}</p>}
      {a && (
        <>
          <p className="confidence-line">
            {when(a.created_at)} · {a.status.replace('_', ' ')}
            {a.owner ? ` · submitted by ${a.owner}` : ''}
          </p>
          {a.submission_redacted && <blockquote className="submission-quote">{a.submission_redacted}</blockquote>}
          {a.reason && <p className="status-banner">{a.reason}</p>}
          {a.property_analysis !== undefined && <BranchGrid result={a} />}
          {a.status === 'decided' && (
            <div className={`recorded-panel ${a.decision}`}>
              <h3>{a.decision?.toUpperCase()}{a.decided_by ? ` by ${a.decided_by}` : ''}</h3>
              <p>{a.rationale}</p>
              <p className="ledger-note">{a.decided_at && when(a.decided_at)} · audit entry #{a.audit_seq}</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export function History({ role, refreshKey }: { role: Role; refreshKey: number }) {
  const [items, setItems] = useState<AssessmentSummary[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  const load = useCallback(() => {
    api
      .get<{ total: number; assessments: AssessmentSummary[] }>('/api/assessments?limit=50')
      .then((r) => {
        setItems(r.assessments)
        setTotal(r.total)
        setError(null)
      })
      .catch((e) => setError(e.message))
  }, [])

  useEffect(load, [load, refreshKey])

  if (openId) return <Detail id={openId} onBack={() => setOpenId(null)} />

  return (
    <div className="panel">
      <p className="confidence-line">{role === 'auditor' ? 'All assessments (read-only)' : 'Your assessments'} · {total}</p>
      {error && <p className="error-banner" role="alert">Error: {error}</p>}
      {items && items.length === 0 && <p className="confidence-line">Nothing here yet.</p>}
      {items && items.length > 0 && (
        <table className="data-table">
          <thead>
            <tr><th>When</th>{role === 'auditor' && <th>By</th>}<th>Submission</th><th>Result</th></tr>
          </thead>
          <tbody>
            {items.map((s) => (
              <tr key={s.assessment_id}>
                <td>{when(s.created_at)}</td>
                {role === 'auditor' && <td>{s.owner}</td>}
                <td>
                  <button className="link-button" onClick={() => setOpenId(s.assessment_id)}>
                    {s.preview || '(no text stored)'}
                  </button>
                </td>
                <td><StatusBadge s={s} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
