import type { CSSProperties } from 'react'
import { parseBranch } from './branch'
import type { GuidelineHit } from './types'

export function RiskCard({
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

export function BranchGrid({ result }: { result: { property_analysis?: string | null; financial_analysis?: string | null; regulatory_analysis?: string | null; guidelines_consulted?: Record<string, GuidelineHit[]> | null } }) {
  return (
    <div className="risk-grid">
      <RiskCard dimension="Property" raw={result.property_analysis} guidelines={result.guidelines_consulted?.property} />
      <RiskCard dimension="Financial" raw={result.financial_analysis} guidelines={result.guidelines_consulted?.financial} />
      <RiskCard dimension="Regulatory" raw={result.regulatory_analysis} guidelines={result.guidelines_consulted?.regulatory} />
    </div>
  )
}
