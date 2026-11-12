import { describe, expect, it } from 'vitest'
import type { FeatureSet } from '../features/types'
import { runRules } from './engine'

const safeFeatures: FeatureSet = {
  urlLength: 20,
  domainLength: 10,
  subdomainCount: 0,
  isIpHost: false,
  isPublicIpHost: false,
  hasPunycode: false,
  hasAtSymbol: false,
  hyphenCount: 0,
  hasSuspiciousTld: false,
  sensitiveWordCount: 0,
  sensitiveWordCategories: [],
  sensitiveWordsInHost: 0,
  sensitiveWordsInPath: 0,
  sensitiveWordsInQuery: 0,
  hostnameDigitCount: 0,
  specialCharRatioInHostname: 0,
  pathDepth: 0,
  isDomainImpersonation: false,
  domainSimilarityScore: 0,
  domainSimilarityReferenceDomain: null,
  domainSimilarityTechnique: null,
  domainEntropy: 2,
  isHttps: true,
  queryParamCount: 0,
  trackingParamCount: 0,
  hasClickTrackingId: false,
  trackingParamRatio: 0,
  hostingPlatform: null,
  hostingBrand: null,
  hostingBrandExtended: null,
  hostingSensitiveWord: null,
  hostingRandomLabel: false,
  urlShortener: null,
  subdomainBrand: null,
  punycodeUnicodeHost: null,
  punycodeMixedScript: false,
  punycodeAsciiConfusable: false,
  homoglyphReferenceDomain: null,
  visibleHyphenCount: 0,
}

describe('runRules', () => {
  it('devuelve score 0 y sin hits cuando ninguna regla se activa', () => {
    const result = runRules(safeFeatures)
    expect(result.score).toBe(0)
    expect(result.hits).toHaveLength(0)
  })

  it('acumula el peso de cada regla activada', () => {
    const result = runRules({ ...safeFeatures, isIpHost: true, hasPunycode: true })
    expect(result.hits.map((h) => h.id).sort()).toEqual(['ip-as-host', 'punycode'])
    // 30 + 0: desde 2026-10-01 `punycode` es informativa (peso 0).
    expect(result.score).toBe(30)
  })

  it('el score nunca supera 100 aunque se activen muchas reglas', () => {
    const worst: FeatureSet = {
      urlLength: 200,
      domainLength: 50,
      subdomainCount: 5,
      isIpHost: true,
      isPublicIpHost: false,
      hasPunycode: true,
      hasAtSymbol: true,
      hyphenCount: 5,
      hasSuspiciousTld: true,
      sensitiveWordCount: 3,
      sensitiveWordCategories: ['auth', 'banking'],
      sensitiveWordsInHost: 1,
      sensitiveWordsInPath: 1,
      sensitiveWordsInQuery: 1,
      hostnameDigitCount: 3,
      specialCharRatioInHostname: 0.2,
      pathDepth: 2,
      isDomainImpersonation: true,
      domainSimilarityScore: 0.9,
      domainSimilarityReferenceDomain: 'example.com',
      domainSimilarityTechnique: 'edit-distance',
      domainEntropy: 4,
      isHttps: false,
      queryParamCount: 0,
      trackingParamCount: 0,
      hasClickTrackingId: false,
      trackingParamRatio: 0,
      hostingPlatform: null,
      hostingBrand: null,
      hostingBrandExtended: null,
      hostingSensitiveWord: null,
      hostingRandomLabel: false,
      urlShortener: null,
      subdomainBrand: null,
      punycodeUnicodeHost: null,
      punycodeMixedScript: false,
      punycodeAsciiConfusable: false,
      homoglyphReferenceDomain: null,
      visibleHyphenCount: 5,
    }
    const result = runRules(worst)
    expect(result.score).toBe(100)
    // Las 11 reglas originales (con `many-hyphens` contando guiones visibles); las de plataforma,
    // acortador, IP pública y homoglifo no aplican a estas features.
    expect(result.hits).toHaveLength(11)
  })

  it('los hits conservan el mismo orden que la lista de reglas', () => {
    const result = runRules({ ...safeFeatures, isIpHost: true, hasAtSymbol: true })
    expect(result.hits.map((h) => h.id)).toEqual(['ip-as-host', 'at-symbol'])
  })
})
