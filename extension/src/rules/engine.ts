import type { FeatureSet } from '../features/types'
import { RULES } from './rules'
import type { Rule, RuleEngineResult, RuleHit } from './types'
import { RULE_WEIGHTS } from './weights'

const MAX_SCORE = 100

/** `rules` permite evaluar reglas candidatas sin activarlas (por defecto, solo las activas). */
export function runRules(features: FeatureSet, rules: readonly Rule[] = RULES): RuleEngineResult {
  const hits: RuleHit[] = []

  for (const rule of rules) {
    if (rule.test(features)) {
      hits.push({
        id: rule.id,
        weight: rule.weight ?? RULE_WEIGHTS[rule.id],
        explanation: rule.explain(features),
      })
    }
  }

  const totalPoints = hits.reduce((sum, hit) => sum + hit.weight, 0)
  const score = Math.min(MAX_SCORE, totalPoints)

  return { score, hits }
}
