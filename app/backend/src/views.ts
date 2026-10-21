export interface AssessmentRow {
  id: string;
  user_id: string;
  status: "needs_review" | "decided" | "blocked" | "rejected";
  created_at: string;
  submission_redacted: string | null;
  submission_sha256: string | null;
  evidence_json: string | null;
  evidence_signature: string | null;
  reason: string | null;
  decision: string | null;
  rationale: string | null;
  decided_by: string | null;
  decided_at: string | null;
  audit_seq: number | null;
  audit_entry_hash: string | null;
  owner_email?: string;
  decider_email?: string | null;
}

/** What the browser sees for one assessment: the evidence flattened the way the
 *  UI renders it. The evidence signature is deliberately NOT included: the
 *  browser never needs it, and the server is what presents it back to the agent. */
export function toView(row: AssessmentRow) {
  const evidence = row.evidence_json ? JSON.parse(row.evidence_json) : {};
  return {
    assessment_id: row.id,
    status: row.status,
    created_at: row.created_at,
    reason: row.reason,
    submission_redacted: row.submission_redacted,
    ...evidence,
    decision: row.decision,
    rationale: row.rationale,
    decided_at: row.decided_at,
    audit_seq: row.audit_seq,
    ...(row.owner_email !== undefined ? { owner: row.owner_email } : {}),
    ...(row.decider_email !== undefined ? { decided_by: row.decider_email } : {}),
  };
}

export function toSummary(row: AssessmentRow) {
  const evidence = row.evidence_json ? JSON.parse(row.evidence_json) : {};
  return {
    assessment_id: row.id,
    status: row.status,
    created_at: row.created_at,
    preview: (row.submission_redacted ?? "").slice(0, 140),
    branch_critical: evidence.branch_critical ?? null,
    model_confidence: evidence.model_confidence ?? null,
    decision: row.decision,
    ...(row.owner_email !== undefined ? { owner: row.owner_email } : {}),
  };
}
