import type { RiskLevel } from '../agent/types'
import type { RuleId } from '../rules/weights'

/**
 * "false-positive": PhishGuard marcó riesgo medio/alto pero el usuario cree
 * que el sitio es legítimo. "missed-risk": PhishGuard marcó bajo riesgo
 * pero el usuario cree que el sitio es sospechoso.
 */
export type FeedbackType = 'false-positive' | 'missed-risk'

/**
 * Un reporte guardado localmente. Congela el `Decision` original (score,
 * probabilidad, reglas) en el momento del reporte — nunca se recalcula ni
 * se vuelve a consultar `decide()` para esta entrada, así que reportar
 * jamás puede alterar una clasificación ya hecha.
 */
export interface FeedbackEntry {
  id: string
  url: string
  hostname: string
  reportedAt: string
  feedbackType: FeedbackType
  originalRiskLevel: RiskLevel
  finalScore: number
  ruleScore: number
  mlProbability: number
  activatedRuleIds: RuleId[]
}

/** Datos de un reporte recién generado, antes de convertirse en `FeedbackEntry` (sin `id`/`hostname`/`reportedAt`, los pone el servicio). */
export interface FeedbackInput {
  url: string
  feedbackType: FeedbackType
  originalRiskLevel: RiskLevel
  finalScore: number
  ruleScore: number
  mlProbability: number
  activatedRuleIds: RuleId[]
}
