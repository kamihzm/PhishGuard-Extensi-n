import type { FeatureSet } from '../features/types'
import type { RuleId } from './weights'

export interface Rule {
  id: RuleId
  /** Peso propio (solo para reconstruir reglas anteriores en evaluaciones); por defecto, `RULE_WEIGHTS[id]`. */
  weight?: number
  description: string
  test: (features: FeatureSet) => boolean
  explain: (features: FeatureSet) => string
}

export interface RuleHit {
  id: RuleId
  weight: number
  explanation: string
}

export interface RuleEngineResult {
  /** 0 (sin señales) a 100 (máxima señal de reglas). */
  score: number
  hits: RuleHit[]
}
