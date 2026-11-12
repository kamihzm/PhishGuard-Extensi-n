import { canonicalizeDomain, normalizeForVisualComparison } from './normalizeDomain'
import { REFERENCE_DOMAINS } from './referenceDomains'
import { damerauLevenshteinDistance, similarityFromDistance } from './similarity'
import type { ImpersonationResult, ImpersonationTechnique } from './types'

/**
 * Umbral de similitud a partir del cual se considera "impersonation".
 * Calibrado empíricamente sobre dataset real + lookalikes sintéticos +
 * dominios no relacionados — ver la evaluación completa y la matriz de
 * TP/FP/FN/Precision/Recall en `docs/domain-impersonation-detection.md`.
 * NO es un número arbitrario elegido a priori.
 */
export const IMPERSONATION_SIMILARITY_THRESHOLD = 0.82

interface CandidateMatch {
  referenceDomain: string
  score: number
  technique: ImpersonationTechnique
}

/**
 * Compara `registrableDomain` (nunca la URL completa — quien llama debe
 * pasar el dominio registrable, ej. `banco.com.co`, no `login.banco.com.co/x`)
 * contra la lista de dominios de referencia (`referenceDomains.ts`).
 *
 * Una coincidencia EXACTA (tras normalizar mayúsculas/punto final) nunca
 * es impersonation — es literalmente el dominio real. Para el resto, se
 * mide la similitud dos veces: tal cual está escrito (`edit-distance`) y
 * después de colapsar sustituciones visuales conocidas
 * (`visual-substitution`, ver `normalizeDomain.ts`) — se conserva la
 * técnica que dio el mejor score, así el resultado explica CÓMO se
 * pareció, no solo CUÁNTO.
 */
export function detectDomainImpersonation(registrableDomain: string): ImpersonationResult {
  const candidate = canonicalizeDomain(registrableDomain)

  if (REFERENCE_DOMAINS.includes(candidate)) {
    return { isImpersonation: false, referenceDomain: null, similarityScore: 1, technique: null }
  }

  const candidateVisual = normalizeForVisualComparison(candidate)

  let best: CandidateMatch | undefined
  for (const reference of REFERENCE_DOMAINS) {
    const rawDistance = damerauLevenshteinDistance(candidate, reference)
    const rawScore = similarityFromDistance(candidate, reference, rawDistance)

    const referenceVisual = normalizeForVisualComparison(reference)
    const visualDistance = damerauLevenshteinDistance(candidateVisual, referenceVisual)
    const visualScore = similarityFromDistance(candidateVisual, referenceVisual, visualDistance)

    const [score, technique]: [number, ImpersonationTechnique] =
      visualScore > rawScore ? [visualScore, 'visual-substitution'] : [rawScore, 'edit-distance']

    if (!best || score > best.score) {
      best = { referenceDomain: reference, score, technique }
    }
  }

  if (!best || best.score < IMPERSONATION_SIMILARITY_THRESHOLD) {
    return {
      isImpersonation: false,
      referenceDomain: null,
      similarityScore: best?.score ?? 0,
      technique: null,
    }
  }

  return {
    isImpersonation: true,
    referenceDomain: best.referenceDomain,
    similarityScore: best.score,
    technique: best.technique,
  }
}
