export type Role = 'underwriter' | 'auditor'

export interface User {
  id: string
  email: string
  name: string
  role: Role
}

export interface GuidelineHit {
  id: string
  title: string
  score: number
}

export type AssessmentStatus = 'needs_review' | 'decided' | 'blocked' | 'rejected'

// One assessment as the backend presents it. The model's per-branch output
// arrives as the raw JSON string the model produced.
export interface Assessment {
  assessment_id: string
  status: AssessmentStatus
  created_at: string
  reason?: string | null
  submission_redacted?: string | null
  branch_findings_summary?: string
  branch_critical?: boolean
  model_confidence?: number
  property_analysis?: string | null
  financial_analysis?: string | null
  regulatory_analysis?: string | null
  guidelines_consulted?: Record<string, GuidelineHit[]> | null
  decision?: string | null
  rationale?: string | null
  decided_at?: string | null
  decided_by?: string | null
  audit_seq?: number | null
  owner?: string
}

// What POST /api/assess returns: the assessment, or a terminal outcome.
export type AssessResult = Omit<Partial<Assessment>, 'status'> & {
  status: AssessmentStatus | 'rejected_at_intake' | 'error'
}

export interface AssessmentSummary {
  assessment_id: string
  status: AssessmentStatus
  created_at: string
  preview: string
  branch_critical: boolean | null
  model_confidence: number | null
  decision: string | null
  owner?: string
}

export interface LedgerEntry {
  seq: number
  timestamp: string
  assessment_id: string
  decision: string
  rationale: string
  stakeholder_id: string
  stakeholder_role: string
  computed_oversight_level: string
  entry_hash: string
}

export interface Verification {
  ok: boolean
  entries: number
  head_hash: string
  error: { seq: number; reason: string } | null
}
