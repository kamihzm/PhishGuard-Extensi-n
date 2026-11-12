import { describe, expect, it } from 'vitest'
import type { FeatureSet } from '../features/types'
import { extractFeatures } from '../features/extractFeatures'
import { runRules } from './engine'
import { RULES } from './rules'
import { RULE_WEIGHTS } from './weights'

const baseFeatures: FeatureSet = {
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

function ruleById(id: string) {
  const rule = RULES.find((r) => r.id === id)
  if (!rule) throw new Error(`Regla no encontrada: ${id}`)
  return rule
}

describe('RULES', () => {
  it('ip-as-host se activa solo cuando el host es una IP', () => {
    const rule = ruleById('ip-as-host')
    expect(rule.test(baseFeatures)).toBe(false)
    expect(rule.test({ ...baseFeatures, isIpHost: true })).toBe(true)
  })

  it('punycode se activa solo cuando el dominio usa punycode', () => {
    const rule = ruleById('punycode')
    expect(rule.test(baseFeatures)).toBe(false)
    expect(rule.test({ ...baseFeatures, hasPunycode: true })).toBe(true)
  })

  it('at-symbol se activa solo cuando existe userinfo (credenciales) en la autoridad de la URL', () => {
    const rule = ruleById('at-symbol')
    expect(rule.test(baseFeatures)).toBe(false)
    expect(rule.test({ ...baseFeatures, hasAtSymbol: true })).toBe(true)
  })

  it('suspicious-tld se activa solo con TLD sospechoso', () => {
    const rule = ruleById('suspicious-tld')
    expect(rule.test(baseFeatures)).toBe(false)
    expect(rule.test({ ...baseFeatures, hasSuspiciousTld: true })).toBe(true)
  })

  it('many-subdomains se activa en el límite de 3 subdominios, no antes', () => {
    const rule = ruleById('many-subdomains')
    expect(rule.test({ ...baseFeatures, subdomainCount: 2 })).toBe(false)
    expect(rule.test({ ...baseFeatures, subdomainCount: 3 })).toBe(true)
  })

  it('many-hyphens se activa en el límite de 2 guiones, no antes', () => {
    const rule = ruleById('many-hyphens')
    expect(rule.test({ ...baseFeatures, visibleHyphenCount: 1 })).toBe(false)
    expect(rule.test({ ...baseFeatures, visibleHyphenCount: 2 })).toBe(true)
  })

  it('many-hyphens no cuenta los guiones de "xn--" ni se aplica en plataformas de hosting', () => {
    const rule = ruleById('many-hyphens')
    // xn--mnchen-3ya: hyphenCount 3 (feature del ML, sin cambios) pero 0 guiones visibles.
    expect(rule.test({ ...baseFeatures, hyphenCount: 3, visibleHyphenCount: 0 })).toBe(false)
    expect(
      rule.test({ ...baseFeatures, visibleHyphenCount: 3, hostingPlatform: 'github.io' }),
    ).toBe(false)
    expect(
      ruleById('hosting-many-hyphens').test({
        ...baseFeatures,
        visibleHyphenCount: 3,
        hostingPlatform: 'github.io',
      }),
    ).toBe(true)
  })

  it('en hosts con Punycode los guiones van a idn-many-hyphens (sin override), no a many-hyphens', () => {
    const idn = { ...baseFeatures, hasPunycode: true, visibleHyphenCount: 2 }
    expect(ruleById('many-hyphens').test(idn)).toBe(false)
    expect(ruleById('idn-many-hyphens').test(idn)).toBe(true)
    expect(ruleById('idn-many-hyphens').test({ ...idn, visibleHyphenCount: 1 })).toBe(false)
    expect(ruleById('idn-many-hyphens').test({ ...idn, hostingPlatform: 'github.io' })).toBe(false)
    expect(ruleById('idn-many-hyphens').test({ ...idn, hasPunycode: false })).toBe(false)
  })

  it('sensitive-words se activa con al menos una palabra sensible', () => {
    const rule = ruleById('sensitive-words')
    expect(rule.test({ ...baseFeatures, sensitiveWordCount: 0 })).toBe(false)
    expect(rule.test({ ...baseFeatures, sensitiveWordCount: 1 })).toBe(true)
  })

  describe('sensitive-words: explicación por categoría (audit Seguridad-master, Fase 4/10)', () => {
    it('categoría auth menciona "autenticación"', () => {
      const rule = ruleById('sensitive-words')
      const explanation = rule.explain({
        ...baseFeatures,
        sensitiveWordCount: 1,
        sensitiveWordCategories: ['auth'],
      })
      expect(explanation).toContain('autenticación')
    })

    it('categoría banking menciona "servicios financieros"', () => {
      const rule = ruleById('sensitive-words')
      const explanation = rule.explain({
        ...baseFeatures,
        sensitiveWordCount: 1,
        sensitiveWordCategories: ['banking'],
      })
      expect(explanation).toContain('servicios financieros')
    })

    it('ambas categorías juntas mencionan autenticación Y servicios financieros', () => {
      const rule = ruleById('sensitive-words')
      const explanation = rule.explain({
        ...baseFeatures,
        sensitiveWordCount: 2,
        sensitiveWordCategories: ['auth', 'banking'],
      })
      expect(explanation).toContain('autenticación')
      expect(explanation).toContain('servicios financieros')
    })

    it('sin categorías (defensivo) cae al mensaje genérico anterior', () => {
      const rule = ruleById('sensitive-words')
      const explanation = rule.explain({
        ...baseFeatures,
        sensitiveWordCount: 1,
        sensitiveWordCategories: [],
      })
      expect(explanation).toContain('palabra(s) sensible(s)')
    })
  })

  it('no-https se activa solo cuando el sitio no usa HTTPS', () => {
    const rule = ruleById('no-https')
    expect(rule.test(baseFeatures)).toBe(false)
    expect(rule.test({ ...baseFeatures, isHttps: false })).toBe(true)
  })

  it('high-entropy-domain se activa por encima de 3.5 bits, no en el límite', () => {
    const rule = ruleById('high-entropy-domain')
    expect(rule.test({ ...baseFeatures, domainEntropy: 3.5 })).toBe(false)
    expect(rule.test({ ...baseFeatures, domainEntropy: 3.51 })).toBe(true)
  })

  it('long-url se activa por encima de 75 caracteres, no en el límite', () => {
    const rule = ruleById('long-url')
    expect(rule.test({ ...baseFeatures, urlLength: 75 })).toBe(false)
    expect(rule.test({ ...baseFeatures, urlLength: 76 })).toBe(true)
  })

  it('domain-impersonation se activa solo cuando isDomainImpersonation es true, y la explicación nombra el dominio de referencia', () => {
    const rule = ruleById('domain-impersonation')
    expect(rule.test(baseFeatures)).toBe(false)
    const impersonating = {
      ...baseFeatures,
      isDomainImpersonation: true,
      domainSimilarityScore: 0.94,
      domainSimilarityReferenceDomain: 'microsoft.com',
    }
    expect(rule.test(impersonating)).toBe(true)
    expect(rule.explain(impersonating)).toContain('microsoft.com')
    expect(rule.explain(impersonating)).toContain('94%')
  })

  describe('domain-impersonation: explicación por técnica (audit Seguridad-master, Fase 10)', () => {
    it('técnica "visual-substitution" menciona caracteres visualmente similares', () => {
      const rule = ruleById('domain-impersonation')
      const explanation = rule.explain({
        ...baseFeatures,
        isDomainImpersonation: true,
        domainSimilarityScore: 1,
        domainSimilarityReferenceDomain: 'microsoft.com',
        domainSimilarityTechnique: 'visual-substitution',
      })
      expect(explanation).toContain('caracteres visualmente similares')
    })

    it('técnica "edit-distance" menciona error tipográfico/typosquatting sin hablar de caracteres visuales', () => {
      const rule = ruleById('domain-impersonation')
      const explanation = rule.explain({
        ...baseFeatures,
        isDomainImpersonation: true,
        domainSimilarityScore: 0.92,
        domainSimilarityReferenceDomain: 'microsoft.com',
        domainSimilarityTechnique: 'edit-distance',
      })
      expect(explanation).toContain('typosquatting')
      expect(explanation).not.toContain('caracteres visualmente similares')
    })
  })

  it('cada regla produce una explicación no vacía', () => {
    for (const rule of RULES) {
      expect(rule.explain(baseFeatures).length).toBeGreaterThan(0)
    }
  })

  it('los ids de las reglas son únicos', () => {
    const ids = RULES.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('cada regla tiene un peso definido en el mapa centralizado', () => {
    for (const rule of RULES) {
      expect(RULE_WEIGHTS[rule.id]).toBeTypeOf('number')
    }
  })

  it('ninguna regla por sí sola alcanza el puntaje máximo (100)', () => {
    for (const weight of Object.values(RULE_WEIGHTS)) {
      expect(weight).toBeLessThan(100)
    }
  })
})

describe('ip-host-sensitive-path (IP pública + palabras sensibles en la ruta)', () => {
  const fires = (url: string) =>
    runRules(extractFeatures(url)).hits.some((h) => h.id === 'ip-host-sensitive-path')

  it('se activa con IP pública y palabra sensible en la ruta', () => {
    expect(fires('http://45.33.32.156/banco/verificar-cuenta')).toBe(true)
  })

  it.each([
    'http://10.0.0.1/banco/verificar-cuenta',
    'http://192.168.1.1/login/verificar',
    'http://127.0.0.1/banco/verificar-cuenta',
    'http://10.64.0.10/user/guest_redirect.jsp?cookie=login',
  ])('NO se activa con IP privada o local: %s', (url) => {
    expect(fires(url)).toBe(false)
  })

  it('NO se activa con IP pública sin palabras sensibles en la ruta (solo en la query)', () => {
    expect(fires('http://45.33.32.156/')).toBe(false)
    expect(fires('http://45.33.32.156/index.html?login=1')).toBe(false)
  })
})
