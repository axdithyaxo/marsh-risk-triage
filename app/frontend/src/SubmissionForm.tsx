import { useState, type CSSProperties } from 'react'

const BACKEND = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:4000'

// TypeScript types describing the shapes coming back from the backend.
// `| null` matters: these fields genuinely can be null (e.g. when the
// agent blocks or rejects before ever calling the model) — writing the
// type honestly forces you to handle that case instead of assuming a
// string is always there.
interface AssessResult {
  status: 'needs_review' | 'blocked' | 'rejected_at_intake' | 'error'
  reason?: string
  assessment_id?: string
  guidelines_consulted?: Record<string, GuidelineHit[]> | null
  branch_findings_summary?: string
  branch_critical?: boolean
  model_confidence?: number
  property_analysis?: string | null
  financial_analysis?: string | null
  regulatory_analysis?: string | null
}

interface DecideResult {
  status: string
  final_decision: string
  computed_oversight_level: string
  ledger_record: Record<string, unknown>
}

// A guideline the RAG step retrieved for one branch, shown so the reviewer
// can see what the model was grounded in (and check it against the finding).
interface GuidelineHit {
  id: string
  title: string
  score: number
}

interface BranchFinding {
  risk_level: string
  confidence: number
  finding: string
}

// The backend returns each branch as a raw JSON *string* (that's what the
// model produced) — this parses one, and fails honestly rather than
// crashing the component if the model's output wasn't valid JSON.
function parseBranch(raw: string | null | undefined): BranchFinding | null {
  if (!raw) return null
  try {
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}') + 1
    if (start < 0 || end <= start) return null
    return JSON.parse(raw.slice(start, end))
  } catch {
    return null
  }
}

// fetch() only rejects on network failure — a 400/502 response resolves
// normally, with an error body like {error: "..."} instead of the shape we
// typed. Casting that straight to AssessResult leaves `status` undefined and
// crashes the render, so check res.ok and surface the backend's message.
async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BACKEND}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new Error(data?.error ?? `Request failed (${res.status})`)
  }
  return res.json()
}

function RiskCard({
  dimension,
  raw,
  guidelines,
}: {
  dimension: string
  raw: string | null | undefined
  guidelines?: GuidelineHit[]
}) {
  const parsed = parseBranch(raw)
  if (!parsed) {
    return (
      <div className="risk-card" style={{ ['--risk-card-color' as string]: 'var(--ink-soft)' }}>
        <div className="risk-card-head">
          <span className="risk-card-dim">{dimension}</span>
          <span className="risk-badge">unparsed</span>
        </div>
        <p className="risk-card-finding">Model response wasn't valid JSON.</p>
      </div>
    )
  }
  const level = parsed.risk_level?.toUpperCase() ?? 'UNKNOWN'
  const levelVar = level.toLowerCase()
  return (
    <div
      className="risk-card"
      style={
        {
          ['--risk-card-color' as string]: `var(--risk-${levelVar}, var(--ink-soft))`,
          ['--risk-card-bg' as string]: `var(--risk-${levelVar}-bg, var(--line))`,
        } as CSSProperties
      }
    >
      <div className="risk-card-head">
        <span className="risk-card-dim">{dimension}</span>
        <span className="risk-badge">{level}</span>
      </div>
      <p className="risk-card-finding">{parsed.finding}</p>
      <p className="confidence-line">confidence {parsed.confidence?.toFixed(2)}</p>
      {guidelines && guidelines.length > 0 && (
        <p className="confidence-line" title={guidelines.map((g) => `${g.id}: ${g.title}`).join('\n')}>
          guidelines: {guidelines.map((g) => g.id).join(' · ')}
        </p>
      )}
    </div>
  )
}

export function SubmissionForm() {
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
    try {
      setResult(await postJson<AssessResult>('/api/assess', { submission }))
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
      setDecided(
        await postJson<DecideResult>('/api/assess/decide', {
          assessment_id: result.assessment_id,
          decision,
          rationale,
        }),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setDeciding(false)
    }
  }

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
      </div>
      <button className="primary-button" onClick={handleAssess} disabled={assessing || !submission.trim()}>
        {assessing ? 'Analyzing (real model, ~10-20s)…' : 'Assess submission'}
      </button>

      {error && <p className="error-banner">Error: {error}</p>}

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
            <div className="risk-grid">
              <RiskCard dimension="Property" raw={result.property_analysis} guidelines={result.guidelines_consulted?.property} />
              <RiskCard dimension="Financial" raw={result.financial_analysis} guidelines={result.guidelines_consulted?.financial} />
              <RiskCard dimension="Regulatory" raw={result.regulatory_analysis} guidelines={result.guidelines_consulted?.regulatory} />
            </div>
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
            />
            <div className="decision-row" style={{ marginTop: 10 }}>
              <button
                className="decision-button"
                onClick={() => handleDecide('bind')}
                disabled={deciding || !rationale.trim()}
              >
                Bind
              </button>
              <button
                className="decision-button refer"
                onClick={() => handleDecide('refer')}
                disabled={deciding || !rationale.trim()}
              >
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
          <p className="ledger-note">Signed into the audit ledger (HMAC-SHA256).</p>
        </div>
      )}
    </div>
  )
}
