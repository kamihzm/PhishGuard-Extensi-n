import type { FeatureSet } from '../features/types'

/**
 * Únicamente las claves de `FeatureSet` cuyo valor es `number`/`boolean`
 * pueden formar parte del vector de ML — excluye en tiempo de compilación
 * campos como `domainSimilarityReferenceDomain` (`string | null`, solo
 * para explicar la regla `domain-impersonation`, ver `features/types.ts`),
 * que nunca podrían convertirse a un número de forma sensata.
 */
type NumericFeatureKey = {
  [K in keyof FeatureSet]: FeatureSet[K] extends number | boolean ? K : never
}[keyof FeatureSet]

/**
 * Orden fijo en el que un `FeatureSet` se convierte en vector numérico para
 * el modelo de regresión logística. Es la ÚNICA fuente de verdad sobre el
 * orden — tanto `training/trainLogisticRegression.ts` (offline) como
 * `classifier.ts` (runtime) importan esta constante en vez de cada uno
 * mantener su propio orden, para no repetir el error de train/serve skew
 * que ya se evitó en `features/` reutilizando el mismo extractor.
 *
 * `sensitiveWordCount` (el agregado sin contexto) NO está en este vector a
 * propósito — sería colineal con `sensitiveWordsInHost/InPath/InQuery`
 * (su suma es prácticamente ese mismo valor) y esas tres dan al modelo
 * información que el agregado no puede representar: si la misma palabra
 * pesa distinto según esté en el host o en el path. `sensitiveWordCount`
 * se mantiene en `FeatureSet` solo para la regla `sensitive-words`, que sí
 * necesita ese significado agregado (ver `rules/rules.ts`).
 *
 * `isDomainImpersonation`/`domainSimilarityScore` (regla
 * `domain-impersonation`) TAMPOCO están acá todavía — el dataset de
 * phishing real actual no tiene ningún ejemplo con esa señal activa, así
 * que un peso de ML no tendría de dónde aprender (ver
 * `docs/domain-impersonation-detection.md`).
 */
export const FEATURE_ORDER: readonly NumericFeatureKey[] = [
  'urlLength',
  'domainLength',
  'subdomainCount',
  'hyphenCount',
  'sensitiveWordsInHost',
  'sensitiveWordsInPath',
  'sensitiveWordsInQuery',
  'hostnameDigitCount',
  'specialCharRatioInHostname',
  'pathDepth',
  'domainEntropy',
  'isIpHost',
  'hasPunycode',
  'hasAtSymbol',
  'hasSuspiciousTld',
  'isHttps',
]

/** Convierte un `FeatureSet` a vector numérico (booleanos → 0/1) en `FEATURE_ORDER`. */
export function featuresToVector(features: FeatureSet): number[] {
  return FEATURE_ORDER.map((key) => {
    const value = features[key]
    return typeof value === 'boolean' ? (value ? 1 : 0) : value
  })
}
