import { extractFeatures } from '../features/extractFeatures'
// Componente ML: Random Forest v4-propio calibrado (antes: regresión logística de `ml/classifier.ts`).
import { classify } from '../ml/forest'
import { runRules } from '../rules/engine'
import { combine } from './combine'
import { mlSkipReason } from './mlScope'
import { explain } from './explain'
import type { Decision } from './types'

/**
 * Ciclo percibir → decidir del agente: URL → features → reglas + ML →
 * combinar → explicar. Es una función pura (sin `chrome.*`) para poder
 * probarla con URLs de ejemplo sin stubs del navegador; conectarla a
 * `background`/`popup` (percepción real de la pestaña activa) es un paso
 * aparte, todavía no dado.
 *
 * No reentrena nada: `classify()` solo hace inferencia sobre la regresión
 * logística ya entrenada y empaquetada en `ml/model.json` — el modelo ML
 * elegido tras comparar LR/Decision Tree/Random Forest sobre el dataset
 * ampliado (ver `docs/model-comparison.md`); Random Forest quedó descartado
 * como modelo principal.
 */
export function decide(url: string): Decision {
  const features = extractFeatures(url)
  const ruleResult = runRules(features)
  // 2026-10-01 (docs/ml-scope.md): en plataformas de hosting y dominios con Punycode el ML no
  // distingue lo legítimo del fraude; no se aplica (probabilidad 0) y deciden las reglas.
  const skipped = mlSkipReason(features)
  const mlProbability = skipped ? 0 : classify(features).probability
  const combined = combine(ruleResult.score, mlProbability, ruleResult.hits)
  const explanation = explain(
    ruleResult.hits,
    mlProbability,
    combined.finalScore,
    combined.riskLevel,
    skipped,
  )

  return {
    url,
    ruleScore: combined.ruleScore,
    mlProbability: combined.mlProbability,
    finalScore: combined.finalScore,
    riskLevel: combined.riskLevel,
    activatedRules: ruleResult.hits,
    explanation,
    ...(skipped ? { mlSkippedReason: skipped } : {}),
  }
}
