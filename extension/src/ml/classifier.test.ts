import { describe, expect, it } from 'vitest'
import type { FeatureSet } from '../features/types'
import toyModel from '../test/fixtures/toyModel.json'
import realModel from './model.json'
import { classifyWithModel } from './classifier'
import type { MlModel } from './types'
import { FEATURE_ORDER } from './vectorize'

// Modelo de juguete determinista: solo `urlLength` (peso 0.5) e `isHttps`
// (peso -2) influyen, el resto tiene peso 0. mean/std fijos para poder
// calcular `z` y la sigmoide a mano.
const model = toyModel as MlModel

const safeFeatures: FeatureSet = {
  urlLength: 20,
  domainLength: 10,
  subdomainCount: 1,
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
  domainEntropy: 3,
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

describe('classifyWithModel', () => {
  it('en la media exacta del modelo, z = bias → sigmoide(0.1) ≈ 0.525', () => {
    // urlLength y domainEntropy en su media → estandarizados = 0; isHttps en su media (1) → 0.
    // z = 0*0.5 + 0*(-2) + bias(0.1) = 0.1
    const result = classifyWithModel(safeFeatures, model)
    expect(result.probability).toBeCloseTo(0.524979, 5)
  })

  it('URL larga y sin HTTPS empuja la probabilidad hacia arriba', () => {
    // urlLength=40 → estandarizado (40-20)/10=2 → *0.5=1
    // isHttps=false → estandarizado (0-1)/1=-1 → *(-2)=2
    // z = 1 + 2 + 0.1 = 3.1 → sigmoide(3.1) ≈ 0.95689
    const result = classifyWithModel({ ...safeFeatures, urlLength: 40, isHttps: false }, model)
    expect(result.probability).toBeCloseTo(0.95689, 4)
  })

  it('siempre devuelve una probabilidad en [0, 1]', () => {
    const extreme: FeatureSet = {
      ...safeFeatures,
      urlLength: 500,
      domainEntropy: 4.5,
      isHttps: false,
    }
    const result = classifyWithModel(extreme, model)
    expect(result.probability).toBeGreaterThanOrEqual(0)
    expect(result.probability).toBeLessThanOrEqual(1)
  })
})

describe('model.json real', () => {
  it('mantiene el mismo orden de features que vectorize.ts (guarda contra desincronización con el entrenamiento)', () => {
    expect((realModel as MlModel).featureOrder).toEqual(FEATURE_ORDER)
  })
})
