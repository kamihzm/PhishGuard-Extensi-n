import { describe, expect, it } from 'vitest'
import { combine, DEFAULT_COMBINE_POLICY, STRONG_RULE_IDS } from '../agent/combine'
import { extractFeatures } from '../features/extractFeatures'
import { CANDIDATE_RULES, LEGACY_PUNYCODE } from './candidateRules'
import { runRules } from './engine'
import { RULES } from './rules'

const active = (id: string) => RULES.find((r) => r.id === id)!

describe('reglas activadas el 2026-10-01 (propuestas A, C e IDN)', () => {
  it('las candidatas que quedan no están en RULES', () => {
    const ids = new Set(RULES.map((r) => r.id))
    for (const rule of CANDIDATE_RULES) expect(ids.has(rule.id)).toBe(false)
  })

  it('url-shortener es informativa: peso 0, no cuenta para el piso y no cambia el nivel', () => {
    const f = extractFeatures('http://bit.ly/login')
    const result = runRules(f)
    expect(result.hits.find((h) => h.id === 'url-shortener')?.weight).toBe(0)
    const sinAviso = runRules(
      f,
      RULES.filter((r) => r.id !== 'url-shortener'),
    )
    expect(combine(result.score, 0, result.hits).riskLevel).toBe(
      combine(sinAviso.score, 0, sinAviso.hits).riskLevel,
    )
  })

  it('reglas de plataforma con piso: garantizan "medio" aunque el ML diga 0', () => {
    const r = runRules(extractFeatures('https://instagramlogin-ejemplo.blogspot.com/'))
    expect(r.hits.map((h) => h.id)).toEqual(
      expect.arrayContaining(['hosting-brand-extended', 'hosting-sensitive-subdomain']),
    )
    expect(combine(r.score, 0, r.hits).riskLevel).toBe('medium')
  })

  it('punycode es informativa y ya no es fuerte; punycode-deceptive sí es fuerte', () => {
    expect(STRONG_RULE_IDS).not.toContain('punycode')
    expect(STRONG_RULE_IDS).toContain('punycode-deceptive')
    expect(DEFAULT_COMBINE_POLICY.informationalRuleIds).toContain('punycode')
    expect(LEGACY_PUNYCODE.weight).toBe(30)
  })

  it('IDN legítimo sin imitación: solo el aviso informativo, nivel bajo con reglas', () => {
    const r = runRules(extractFeatures('https://xn--mnchen-3ya.de/'))
    expect(r.hits.map((h) => h.id)).toContain('punycode')
    expect(r.hits.map((h) => h.id)).not.toContain('punycode-deceptive')
    expect(r.hits.map((h) => h.id)).not.toContain('many-hyphens')
    expect(combine(r.score, 0, r.hits).riskLevel).toBe('low')
  })

  it('punycode-deceptive nombra la marca imitada y lleva a "alto"', () => {
    const f = extractFeatures('https://xn--pypal-4ve.com/')
    expect(active('punycode-deceptive').test(f)).toBe(true)
    expect(active('punycode-deceptive').explain(f)).toContain('paypal.com')
    const r = runRules(f)
    expect(combine(r.score, 0, r.hits).riskLevel).toBe('high')
  })
})
