import { describe, expect, it } from 'vitest'
import { parseBranch } from './branch'

describe('parseBranch', () => {
  it('parses the model JSON', () => {
    expect(parseBranch('{"risk_level":"LOW","confidence":0.9,"finding":"ok"}')).toEqual({ risk_level: 'LOW', confidence: 0.9, finding: 'ok' })
  })
  it('finds the JSON when the model wraps it in prose', () => {
    expect(parseBranch('Sure! {"risk_level":"HIGH","confidence":1,"finding":"x"} Hope that helps.')?.risk_level).toBe('HIGH')
  })
  it.each([null, undefined, '', 'no json here', '{broken', '}{'])('returns null rather than throwing for %j', (raw) => {
    expect(parseBranch(raw)).toBeNull()
  })
})
