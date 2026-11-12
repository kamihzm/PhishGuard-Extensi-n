import type { RuleHit } from '../rules/types'
import type { RuleId } from '../rules/weights'
import type { RiskLevel } from './types'

/**
 * Estrategia de combinación: promedio ponderado + override por IDENTIDAD de
 * regla fuerte (no por magnitud de `ruleScore`).
 *
 * Pesos (30% reglas / 70% ML): se comparó el motor de reglas solo contra la
 * regresión logística (modelo ML elegido tras comparar LR/Decision
 * Tree/Random Forest sobre el dataset ampliado) sobre el mismo test set —
 * LR@0.30 tiene recall 0.711 y F1 0.696, contra recall 0.111 del motor de
 * reglas solo. El ML pesa más porque mide sistemáticamente mejor en este
 * dataset (ver `docs/model-comparison.md`).
 *
 * El override YA NO depende de que `ruleScore` supere un umbral: depende de
 * qué regla específica se activó. Se midió cada regla por separado
 * (`training/evaluateRulesIndividually.ts`) y solo 4 mostraron precisión
 * alta con evidencia real: `punycode`, `at-symbol`, `suspicious-tld` y
 * `many-hyphens` (0.98-1.00 de precisión sobre el dataset completo).
 * `ip-as-host` quedó deliberadamente FUERA: se encontró un falso positivo
 * real (un portal cautivo de wifi con IP privada como host), así que ya no
 * se le puede dar autoridad de override sin que la regla distinga IP
 * privada de pública — algo que no le corresponde arreglar a este módulo.
 * Desde 2026-10-01 esa distinción vive en la capa de reglas: la regla
 * `ip-host-sensitive-path` (IP PÚBLICA + palabras sensibles en la ruta) sí
 * es fuerte; `ip-as-host` sola sigue sin serlo (ver
 * `docs/rules-reinforcement.md`).
 *
 * Además del override fuerte, hay un segundo piso más suave para
 * CORROBORACIÓN: si no se activó ninguna regla fuerte, pero sí 3 o más
 * reglas no fuertes juntas (`MEDIUM_FLOOR_MIN_RULES`), el resultado no
 * puede quedar por debajo de "medio". Se comparó contra activar este piso
 * con 2 reglas, o solo si se mezclan categorías moderada+contextual — con 2
 * reglas o mezclando categorías, casos legítimos reales del dataset (un
 * login real y una URL larga real, ambas con exactamente 2 señales técnicas)
 * quedaban marcadas como "medio" — falsos positivos. Exigir 3 evita esos
 * casos y sigue resolviendo el caso que motivó este ajuste (IP privada +
 * HTTP + palabra sensible → 3 señales, sí se corrobora). Ver
 * `training/evaluateMediumFloorManualCases.ts`.
 */
export const RULE_WEIGHT = 0.3
export const ML_WEIGHT = 0.7

/** Reglas cuya activación, medida de forma individual, tiene precisión alta y consistente — ver justificación arriba. */
export const STRONG_RULE_IDS: readonly RuleId[] = [
  // 2026-10-01: `punycode` deja de ser fuerte (ahora informativa); la imitación con
  // homoglifos o mezcla de escrituras la cubre `punycode-deceptive`.
  'punycode-deceptive',
  'at-symbol',
  'suspicious-tld',
  'many-hyphens',
  'ip-host-sensitive-path',
]

/**
 * Si se activó alguna regla de `STRONG_RULE_IDS`, el resultado combinado no
 * puede quedar por debajo de este valor — coincide a propósito con
 * `RISK_HIGH_THRESHOLD`: el override garantiza como mínimo la entrada a
 * "alto", sin un margen extra que no tenga respaldo en los datos.
 */
export const RULE_OVERRIDE_SCORE = 65

/** Cantidad mínima de reglas NO fuertes activadas juntas para corroborar sospecha (ver justificación arriba). */
export const MEDIUM_FLOOR_MIN_RULES = 3
/** Piso aplicado por corroboración de reglas no fuertes — coincide con `RISK_LOW_THRESHOLD`: garantiza como mínimo "medio". */
export const MEDIUM_FLOOR_SCORE = 35

export const RISK_LOW_THRESHOLD = 35
export const RISK_HIGH_THRESHOLD = 65

export interface CombineResult {
  ruleScore: number
  mlProbability: number
  finalScore: number
  riskLevel: RiskLevel
}

/**
 * Qué reglas tienen poder sobre el nivel (2026-10-01). Por defecto, el
 * comportamiento de siempre: solo `STRONG_RULE_IDS`. La evaluación de reglas
 * candidatas (`training/evaluateRuleCandidates.ts`) pasa otra política para
 * medir su impacto ANTES de activarlas:
 *  - `strongRuleIds`: garantizan "alto" (override);
 *  - `mediumFloorRuleIds`: por sí solas garantizan "medio";
 *  - `informationalRuleIds`: se muestran pero no cuentan para el piso de
 *    corroboración (p. ej. `url-shortener`, peso 0).
 */
export interface CombinePolicy {
  strongRuleIds: readonly RuleId[]
  mediumFloorRuleIds: readonly RuleId[]
  informationalRuleIds: readonly RuleId[]
}

/**
 * Reglas que por sí solas garantizan "medio" (2026-10-01, propuestas A y C de
 * `docs/rules-reinforcement.md`): señales de plataforma o de marca que no
 * prueban el fraude por sí solas, pero justifican precaución.
 */
export const MEDIUM_FLOOR_RULE_IDS: readonly RuleId[] = [
  'hosting-brand-extended',
  'hosting-sensitive-subdomain',
  'hosting-random-subdomain',
  'brand-in-subdomain',
]

/** Se muestran al usuario como aviso, pero no suman ni cuentan para el piso de corroboración. */
export const INFORMATIONAL_RULE_IDS: readonly RuleId[] = ['url-shortener', 'punycode']

export const DEFAULT_COMBINE_POLICY: CombinePolicy = {
  strongRuleIds: STRONG_RULE_IDS,
  mediumFloorRuleIds: MEDIUM_FLOOR_RULE_IDS,
  informationalRuleIds: INFORMATIONAL_RULE_IDS,
}

export function combine(
  ruleScore: number,
  mlProbability: number,
  activatedRules: RuleHit[],
  policy: CombinePolicy = DEFAULT_COMBINE_POLICY,
): CombineResult {
  const mlScore = mlProbability * 100
  const weighted = ruleScore * RULE_WEIGHT + mlScore * ML_WEIGHT

  const hasStrongRule = activatedRules.some((hit) => policy.strongRuleIds.includes(hit.id))
  const nonStrongRuleCount = activatedRules.filter(
    (hit) =>
      !policy.strongRuleIds.includes(hit.id) && !policy.informationalRuleIds.includes(hit.id),
  ).length
  const hasCorroboratedRules =
    nonStrongRuleCount >= MEDIUM_FLOOR_MIN_RULES ||
    activatedRules.some((hit) => policy.mediumFloorRuleIds.includes(hit.id))

  let finalScore: number
  if (hasStrongRule) {
    finalScore = Math.max(weighted, RULE_OVERRIDE_SCORE)
  } else if (hasCorroboratedRules) {
    finalScore = Math.max(weighted, MEDIUM_FLOOR_SCORE)
  } else {
    finalScore = weighted
  }
  finalScore = Math.round(finalScore)

  return { ruleScore, mlProbability, finalScore, riskLevel: riskLevelFromScore(finalScore) }
}

export function riskLevelFromScore(score: number): RiskLevel {
  if (score < RISK_LOW_THRESHOLD) return 'low'
  if (score < RISK_HIGH_THRESHOLD) return 'medium'
  return 'high'
}
