import type { RiskLevel } from '../agent/types'
import type { RuleId } from '../rules/weights'

/** Un análisis guardado localmente. No incluye texto de explicación ni la lista completa de `RuleHit` — solo los ids, para mantener el registro chico. */
export interface HistoryEntry {
  id: string
  url: string
  hostname: string
  analyzedAt: string
  finalScore: number
  ruleScore: number
  mlProbability: number
  riskLevel: RiskLevel
  activatedRuleIds: RuleId[]
}

/** Datos de un análisis recién calculado, antes de convertirse en `HistoryEntry` (sin `id`/`hostname`/`analyzedAt`, los pone el servicio). */
export interface AnalysisInput {
  url: string
  finalScore: number
  ruleScore: number
  mlProbability: number
  riskLevel: RiskLevel
  activatedRuleIds: RuleId[]
}

export type HistoryFilter = 'all' | RiskLevel
