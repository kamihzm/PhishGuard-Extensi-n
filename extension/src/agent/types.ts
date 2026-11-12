import type { RuleHit } from '../rules/types'
import type { MlSkipReason } from './mlScope'

export type RiskLevel = 'low' | 'medium' | 'high'

/**
 * Resultado del agente para una URL: reglas y ML permanecen visibles por
 * separado (`ruleScore`, `mlProbability`) además del score combinado — no
 * es una caja negra que solo devuelve un veredicto final.
 */
export interface Decision {
  url: string
  ruleScore: number
  mlProbability: number
  finalScore: number
  riskLevel: RiskLevel
  activatedRules: RuleHit[]
  explanation: string
  /**
   * Si el ML NO se aplicó y por qué (2026-10-01, ver `mlScope.ts`): en ese caso
   * `mlProbability` es 0 y deciden solo las reglas. Ausente = el ML sí se aplicó.
   */
  mlSkippedReason?: MlSkipReason
}
