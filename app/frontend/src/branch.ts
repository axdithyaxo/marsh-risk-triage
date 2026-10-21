export interface BranchFinding {
  risk_level: string
  confidence: number
  finding: string
}

// The backend returns each branch as a raw JSON *string* (that's what the
// model produced) — this parses one, and fails honestly rather than crashing
// the component if the model's output wasn't valid JSON.
export function parseBranch(raw: string | null | undefined): BranchFinding | null {
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
