import type { RuleHit } from '../rules/types'
import { ML_SKIP_TEXTS, type MlSkipReason } from './mlScope'
import type { RiskLevel } from './types'

const RISK_LABELS: Record<RiskLevel, string> = { low: 'bajo', medium: 'medio', high: 'alto' }

/**
 * Arma la explicación en lenguaje humano dejando SEPARADO qué vino de
 * reglas y qué vino de ML — nunca se mezclan en una sola frase, para que el
 * usuario (y el jurado en la sustentación) vea de dónde sale cada señal.
 */
export function explain(
  activatedRules: RuleHit[],
  mlProbability: number,
  finalScore: number,
  riskLevel: RiskLevel,
  mlSkippedReason: MlSkipReason | null = null,
): string {
  const rulesText =
    activatedRules.length > 0
      ? `Sistema experto: se detectaron ${activatedRules.length} señal(es) — ${activatedRules.map((hit) => hit.explanation).join(' ')}`
      : 'Sistema experto: no se activó ninguna regla conocida.'

  const mlText = mlSkippedReason
    ? `Machine Learning (Random Forest): ${ML_SKIP_TEXTS[mlSkippedReason]}.`
    : `Machine Learning (Random Forest): ${Math.round(mlProbability * 100)}% de probabilidad estimada de phishing.`

  const riskText = `Resultado combinado: riesgo ${RISK_LABELS[riskLevel]} (score ${finalScore}/100).`

  return `${rulesText}\n\n${mlText}\n\n${riskText}`
}
