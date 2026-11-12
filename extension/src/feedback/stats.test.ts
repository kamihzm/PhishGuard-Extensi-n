import { describe, expect, it } from 'vitest'
import { calculateFeedbackStats } from './stats'
import type { FeedbackEntry } from './types'

function entry(overrides: Partial<FeedbackEntry> = {}): FeedbackEntry {
  return {
    id: crypto.randomUUID(),
    url: 'https://example.com/',
    hostname: 'example.com',
    reportedAt: new Date().toISOString(),
    feedbackType: 'false-positive',
    originalRiskLevel: 'high',
    finalScore: 83,
    ruleScore: 75,
    mlProbability: 0.87,
    activatedRuleIds: [],
    ...overrides,
  }
}

describe('calculateFeedbackStats', () => {
  it('sin reportes, todos los conteos quedan en 0', () => {
    expect(calculateFeedbackStats([])).toEqual({ total: 0, falsePositives: 0, missedRisks: 0 })
  })

  it('cuenta correctamente falsos positivos y riesgos no detectados por separado', () => {
    const entries = [
      entry({ feedbackType: 'false-positive' }),
      entry({ feedbackType: 'false-positive' }),
      entry({ feedbackType: 'missed-risk' }),
    ]

    expect(calculateFeedbackStats(entries)).toEqual({ total: 3, falsePositives: 2, missedRisks: 1 })
  })
})
