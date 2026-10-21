import { useState } from 'react'
import { api } from './api'
import { BranchGrid } from './RiskCard'
import type { AssessResult } from './types'

interface DecideResult {
  status: string
  final_decision: string
  computed_oversight_level: string
  audit_entry: { seq: number; entry_hash: string }
}

const MAX_SUBMISSION = 20_000

export function SubmissionForm({ onDecided }: { onDecided?: () => void }) {
  // One useState per independent piece of state. React re-renders this
  // component whenever any of these setters is called with a new value.
  const [submission, setSubmission] = useState('')
  const [assessing, setAssessing] = useState(false)
  const [result, setResult] = useState<AssessResult | null>(null)
  const [rationale, setRationale] = useState('')
  const [deciding, setDeciding] = useState(false)
  const [decided, setDecided] = useState<DecideResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleAssess() {
    setAssessing(true)
    setError(null)
    setResult(null)
    setDecided(null)
    setRationale('')
    try {
      setResult(await api.post<AssessResult>('/api/assess', { submission }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setAssessing(false)
    }
  }

  async function handleDecide(decision: 'bind' | 'refer') {
    if (!result?.assessment_id) return
    setDeciding(true)
    setError(null)
    try {
      // Only WHICH assessment, what you chose and why. The findings come from
      // the server's own record, never from this page.
      setDecided(await api.post<DecideResult>('/api/assess/decide', { assessment_id: result.assessment_id, decision, rationale }))
      onDecided?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setDeciding(false)
    }
  }

  const tooLong = submission.length > MAX_SUBMISSION

  return (
    <div className="panel">
      <div>
        <label className="field-label" htmlFor="submission">Property risk submission</label>
        <textarea
          id="submission"
          className="submission-input"
          value={submission}
          onChange={(e) => setSubmission(e.target.value)}
          placeholder="Paste a property risk submission..."
          rows={5}
        />
        {tooLong && <p className="confidence-line">Too long: {submission.length.toLocaleString()} of {MAX_SUBMISSION.toLocaleString()} characters.</p>}
      </div>
      <button className="primary-button" onClick={handleAssess} disabled={assessing || !submission.trim() || tooLong}>
        {assessing ? 'Analyzing (real model, ~10-20s)…' : 'Assess submission'}
      </button>

      {error && <p className="error-banner" role="alert">Error: {error}</p>}

      {result && result.status !== 'needs_review' && (
        <p className="status-banner">
          Agent returned <strong>{result.status.replace(/_/g, ' ')}</strong>
          {result.reason ? `: ${result.reason}` : ''}
        </p>
      )}

      {result && result.status === 'needs_review' && !decided && (
        <div className="results">
          <div>
            <h3>Branch findings</h3>
            <BranchGrid result={result} />
            <p className="confidence-line" style={{ marginTop: 10 }}>
              worst-branch confidence {result.model_confidence?.toFixed(2)} · critical: {String(result.branch_critical)}
            </p>
          </div>

          <div>
            <h3>Your decision</h3>
            <textarea
              className="rationale-input"
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              placeholder="Your rationale (required for the audit record)..."
              rows={2}
              aria-label="Rationale"
            />
            <div className="decision-row" style={{ marginTop: 10 }}>
              <button className="decision-button" onClick={() => handleDecide('bind')} disabled={deciding || !rationale.trim()}>
                Bind
              </button>
              <button className="decision-button refer" onClick={() => handleDecide('refer')} disabled={deciding || !rationale.trim()}>
                Refer
              </button>
            </div>
          </div>
        </div>
      )}

      {decided && (
        <div className={`recorded-panel ${decided.final_decision?.toLowerCase()}`}>
          <h3>Recorded: {decided.final_decision}</h3>
          <p>Oversight level: {decided.computed_oversight_level}</p>
          <p className="ledger-note">Audit entry #{decided.audit_entry.seq}, signed and chained (HMAC-SHA256).</p>
        </div>
      )}
    </div>
  )
}
