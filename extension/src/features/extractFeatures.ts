import { detectDomainImpersonation } from '../domainSimilarity/detectImpersonation'
import { analyzeIdn } from '../domainSimilarity/homoglyph'
import type { ImpersonationResult } from '../domainSimilarity/types'
import {
  SENSITIVE_WORD_CATEGORIES,
  SENSITIVE_WORDS,
  SUSPICIOUS_TLDS,
  type SensitiveWordCategory,
} from '../shared/constants'
import { calculateShannonEntropy } from './entropy'
import { analyzeHosting } from './hosting'
import { isPublicIpAddress } from './ipScope'
import { analyzeQueryParams } from './queryParams'
import type { FeatureSet } from './types'
import { decomposeUrl } from './urlParts'

/**
 * Descompone la URL UNA vez (`urlParts.ts`, sobre `new URL()`) y calcula
 * cada feature a partir de esa estructura — nunca volviendo a analizar la
 * cadena cruda completa con regex cuando el parser estándar ya da el
 * componente correcto (protocolo, userinfo, host, puerto, path, query,
 * fragment). La única excepción es `sensitiveWordCount`, que a propósito
 * sigue mirando la URL completa porque la regla `sensitive-words`
 * (`rules/rules.ts`) depende de ese significado exacto sin distinguir
 * contexto — ver el comentario de esa feature en `types.ts`.
 */
export interface FeatureOptions {
  /**
   * Técnica `homoglyph` en `domain-impersonation` (2026-10-01). Activada por
   * defecto desde su aprobación (`docs/rules-reinforcement.md`); `false` solo
   * sirve para reconstruir el comportamiento anterior en evaluaciones. Las señales Punycode/homoglifo
   * se calculan siempre (`homoglyphReferenceDomain`…), solo cambia si
   * alimentan `isDomainImpersonation`.
   */
  homoglyphImpersonation: boolean
}

/** 2026-10-01: técnica `homoglyph` activada (propuesta A aprobada). */
export const DEFAULT_FEATURE_OPTIONS: FeatureOptions = { homoglyphImpersonation: true }

export function extractFeatures(
  rawUrl: string,
  options: FeatureOptions = DEFAULT_FEATURE_OPTIONS,
): FeatureSet {
  const parts = decomposeUrl(rawUrl)
  const idn = analyzeIdn(parts.hostname, parts.registrableDomain)
  const hosting = analyzeHosting(parts.hostname, parts.registrableDomain, parts.subdomainLabels)
  const textual = detectDomainImpersonation(parts.registrableDomain)
  const impersonation: ImpersonationResult =
    options.homoglyphImpersonation && !textual.isImpersonation && idn.homoglyphReferenceDomain
      ? {
          isImpersonation: true,
          referenceDomain: idn.homoglyphReferenceDomain,
          similarityScore: idn.homoglyphScore,
          technique: 'homoglyph',
        }
      : textual
  const queryParams = analyzeQueryParams(parts.query)

  return {
    urlLength: rawUrl.length,
    domainLength: parts.hostname.length,
    subdomainCount: parts.subdomainLabels.length,
    isIpHost: parts.isIpHost,
    isPublicIpHost: parts.isIpHost && isPublicIpAddress(parts.hostname),
    hasPunycode: parts.hostname.includes('xn--'),
    hasAtSymbol: parts.username !== '' || parts.password !== '',
    hyphenCount: countChar(parts.hostname, '-'),
    hasSuspiciousTld: parts.isIpHost ? false : hasSuspiciousTld(parts.publicSuffix),
    sensitiveWordCount: countSensitiveWords(rawUrl),
    sensitiveWordCategories: categorizeSensitiveWords(rawUrl),
    sensitiveWordsInHost: countSensitiveWords(parts.hostname),
    sensitiveWordsInPath: countSensitiveWords(parts.pathname),
    sensitiveWordsInQuery: countSensitiveWords(parts.query),
    hostnameDigitCount: countDigits(parts.hostname),
    specialCharRatioInHostname: specialCharRatio(parts.hostname),
    pathDepth: parts.pathname.split('/').filter(Boolean).length,
    isDomainImpersonation: impersonation.isImpersonation,
    domainSimilarityScore: impersonation.similarityScore,
    domainSimilarityReferenceDomain: impersonation.referenceDomain,
    domainSimilarityTechnique: impersonation.technique,
    domainEntropy: calculateShannonEntropy(parts.hostname.replaceAll('.', '')),
    isHttps: parts.protocol === 'https:',
    queryParamCount: queryParams.queryParamCount,
    trackingParamCount: queryParams.trackingParamCount,
    hasClickTrackingId: queryParams.hasClickTrackingId,
    trackingParamRatio: queryParams.trackingParamRatio,
    ...hosting,
    punycodeUnicodeHost: idn.unicodeHost,
    punycodeMixedScript: idn.mixedScript,
    punycodeAsciiConfusable: idn.asciiConfusable,
    homoglyphReferenceDomain: idn.homoglyphReferenceDomain,
    visibleHyphenCount: countChar(idn.unicodeHost ?? parts.hostname, '-'),
  }
}

/**
 * El sufijo público puede ocupar una o dos etiquetas (`urlParts.ts`); el TLD
 * "de verdad" para esta comparación es siempre la ÚLTIMA etiqueta del
 * sufijo (ej. de "com.co" el TLD relevante es "co") — ninguno de los TLD
 * sospechosos conocidos es compuesto, así que basta con la última etiqueta.
 */
function hasSuspiciousTld(publicSuffix: string): boolean {
  if (publicSuffix === '') return false
  const lastLabel = publicSuffix.split('.').at(-1)
  return lastLabel !== undefined && SUSPICIOUS_TLDS.includes(lastLabel)
}

function countSensitiveWords(text: string): number {
  const lower = text.toLowerCase()
  return SENSITIVE_WORDS.filter((word) => lower.includes(word)).length
}

/** Categorías únicas de las palabras sensibles efectivamente encontradas — ver el comentario de `sensitiveWordCategories` en `types.ts`. */
function categorizeSensitiveWords(text: string): SensitiveWordCategory[] {
  const lower = text.toLowerCase()
  const matchedWords = SENSITIVE_WORDS.filter((word) => lower.includes(word))
  const categories = matchedWords.flatMap((word) => SENSITIVE_WORD_CATEGORIES[word] ?? [])
  return [...new Set(categories)]
}

function countChar(text: string, char: string): number {
  return text.split(char).length - 1
}

function countDigits(text: string): number {
  return text.match(/\d/g)?.length ?? 0
}

/** Ver el comentario de `specialCharRatioInHostname` en `types.ts` sobre qué mide en la práctica. */
function specialCharRatio(text: string): number {
  if (text.length === 0) return 0
  const special = text.match(/[^a-z0-9-]/gi)?.length ?? 0
  return special / text.length
}
