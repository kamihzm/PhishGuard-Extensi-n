import type { FeedbackEntry } from './types'

export interface FeedbackStats {
  total: number
  falsePositives: number
  missedRisks: number
}

/**
 * Función pura: no toca `chrome.storage`. Estos conteos son percepción del
 * usuario, NO la accuracy real del modelo — nunca se cruzan con
 * `stats/calculateStats.ts` ni con las métricas de `docs/final-evaluation.md`.
 */
export function calculateFeedbackStats(entries: FeedbackEntry[]): FeedbackStats {
  return {
    total: entries.length,
    falsePositives: entries.filter((entry) => entry.feedbackType === 'false-positive').length,
    missedRisks: entries.filter((entry) => entry.feedbackType === 'missed-risk').length,
  }
}
