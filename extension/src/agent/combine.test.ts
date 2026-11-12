import { describe, expect, it } from 'vitest'
import type { RuleHit } from '../rules/types'
import type { RuleId } from '../rules/weights'
import {
  combine,
  MEDIUM_FLOOR_MIN_RULES,
  MEDIUM_FLOOR_SCORE,
  RULE_OVERRIDE_SCORE,
  riskLevelFromScore,
  STRONG_RULE_IDS,
} from './combine'

function hitFor(id: RuleId): RuleHit {
  return { id, weight: 10, explanation: `explicación de ${id}` }
}

const NON_STRONG_RULE_IDS: RuleId[] = [
  'ip-as-host',
  'many-subdomains',
  'sensitive-words',
  'no-https',
  'high-entropy-domain',
  'long-url',
]

describe('combine', () => {
  it('reglas bajas + ML bajo, sin reglas activadas → riesgo bajo', () => {
    // weighted = 5*0.3 + 5*0.7 = 5 (sin override: no hay reglas activadas)
    const result = combine(5, 0.05, [])
    expect(result.finalScore).toBe(5)
    expect(result.riskLevel).toBe('low')
  })

  it('reglas bajas + ML alto, sin regla fuerte ni corroboración → el promedio decide, no se fuerza a "alto"', () => {
    // weighted = 10*0.3 + 85*0.7 ≈ 62.5 (62.49999999999999 en punto flotante) → redondeado 62, sin override
    const result = combine(10, 0.85, [])
    expect(result.finalScore).toBe(62)
    expect(result.riskLevel).toBe('medium')
  })

  it('ambos altos (regla fuerte + ML alto) → riesgo alto', () => {
    // weighted = 70*0.3 + 90*0.7 = 84 → ya supera el piso por sí solo
    const result = combine(70, 0.9, [hitFor('many-hyphens')])
    expect(result.finalScore).toBe(84)
    expect(result.riskLevel).toBe('high')
  })

  it('valores extremos: 0 y 0 sin reglas → bajo; 100 y 1 con regla fuerte → alto', () => {
    const allZero = combine(0, 0, [])
    expect(allZero.finalScore).toBe(0)
    expect(allZero.riskLevel).toBe('low')

    const allMax = combine(100, 1, [hitFor('punycode')])
    expect(allMax.finalScore).toBe(100)
    expect(allMax.riskLevel).toBe('high')
  })

  it('es consistente: la misma entrada siempre produce la misma salida', () => {
    const hits = [hitFor('suspicious-tld')]
    const first = combine(42, 0.42, hits)
    const second = combine(42, 0.42, hits)
    expect(second).toEqual(first)
  })

  it('finalScore siempre es un entero dentro de [0, 100]', () => {
    const samples: [number, number, RuleHit[]][] = [
      [0, 0, []],
      [100, 1, [hitFor('at-symbol')]],
      [17, 0.33, []],
      [55, 0.61, [hitFor('sensitive-words')]],
      [3, 0.99, [hitFor('many-hyphens')]],
    ]
    for (const [ruleScore, mlProbability, hits] of samples) {
      const { finalScore } = combine(ruleScore, mlProbability, hits)
      expect(Number.isInteger(finalScore)).toBe(true)
      expect(finalScore).toBeGreaterThanOrEqual(0)
      expect(finalScore).toBeLessThanOrEqual(100)
    }
  })

  it('conserva ruleScore y mlProbability sin modificarlos, separados del finalScore', () => {
    const result = combine(70, 0.82, [hitFor('suspicious-tld')])
    expect(result.ruleScore).toBe(70)
    expect(result.mlProbability).toBe(0.82)
  })

  describe('override de reglas fuertes (por identidad, no por magnitud de ruleScore)', () => {
    it.each(STRONG_RULE_IDS)(
      'una regla FUERTE activada ("%s") garantiza al menos RULE_OVERRIDE_SCORE aunque ruleScore y ML sean bajos',
      (id) => {
        // ruleScore=10 (una sola regla de peso bajo) y mlProbability=0.05: el promedio ponderado
        // solo, por sí solo, jamás llegaría a 65 — el override es lo que lo garantiza.
        const result = combine(10, 0.05, [hitFor(id)])
        expect(result.finalScore).toBeGreaterThanOrEqual(RULE_OVERRIDE_SCORE)
        expect(result.riskLevel).toBe('high')
      },
    )

    it.each(NON_STRONG_RULE_IDS)(
      'una sola regla no fuerte ("%s") NO dispara ningún piso, aunque ruleScore sea alto',
      (id) => {
        // ruleScore=80 (alto en magnitud) pero la única regla activada no es "fuerte" y es
        // solo 1 (no corrobora) — con la estrategia vieja (ruleScore >= 30) esto habría
        // forzado "alto"; ahora no se fuerza nada, el promedio decide.
        const result = combine(80, 0.1, [hitFor(id)])
        const weighted = Math.round(80 * 0.3 + 10 * 0.7)
        expect(result.finalScore).toBe(weighted)
        expect(result.finalScore).toBeLessThan(RULE_OVERRIDE_SCORE)
      },
    )

    it('"ip-as-host" quedó deliberadamente fuera de STRONG_RULE_IDS (falso positivo real: portal cautivo con IP privada)', () => {
      expect(STRONG_RULE_IDS).not.toContain('ip-as-host')
    })
  })

  describe('piso de riesgo MEDIO por corroboración de reglas no fuertes', () => {
    it('IP privada sola (1 regla no fuerte) → NO fuerza "medio"', () => {
      const result = combine(30, 0.05, [hitFor('ip-as-host')])
      const weighted = Math.round(30 * 0.3 + 5 * 0.7)
      expect(result.finalScore).toBe(weighted)
      expect(result.finalScore).toBeLessThan(MEDIUM_FLOOR_SCORE)
      expect(result.riskLevel).toBe('low')
    })

    it('HTTP solo (1 regla no fuerte) → NO fuerza "medio"', () => {
      const result = combine(15, 0.05, [hitFor('no-https')])
      const weighted = Math.round(15 * 0.3 + 5 * 0.7)
      expect(result.finalScore).toBe(weighted)
      expect(result.finalScore).toBeLessThan(MEDIUM_FLOOR_SCORE)
      expect(result.riskLevel).toBe('low')
    })

    it('palabra sensible sola (1 regla no fuerte) → NO fuerza "medio"', () => {
      const result = combine(10, 0.05, [hitFor('sensitive-words')])
      const weighted = Math.round(10 * 0.3 + 5 * 0.7)
      expect(result.finalScore).toBe(weighted)
      expect(result.finalScore).toBeLessThan(MEDIUM_FLOOR_SCORE)
      expect(result.riskLevel).toBe('low')
    })

    it('2 reglas no fuertes juntas → todavía NO alcanzan para corroborar (se necesitan 3)', () => {
      const result = combine(25, 0.1, [hitFor('no-https'), hitFor('long-url')])
      const weighted = Math.round(25 * 0.3 + 10 * 0.7)
      expect(result.finalScore).toBe(weighted)
      expect(result.finalScore).toBeLessThan(MEDIUM_FLOOR_SCORE)
      expect(result.riskLevel).toBe('low')
    })

    it(`${MEDIUM_FLOOR_MIN_RULES} reglas no fuertes juntas → mínimo MEDIUM_FLOOR_SCORE, aunque el promedio por sí solo quede bajo`, () => {
      // weighted = 40*0.3 + 5*0.7 = 15.5 — muy por debajo de 35 sin el piso.
      const result = combine(40, 0.05, [
        hitFor('no-https'),
        hitFor('sensitive-words'),
        hitFor('long-url'),
      ])
      expect(result.finalScore).toBeGreaterThanOrEqual(MEDIUM_FLOOR_SCORE)
      expect(result.riskLevel).toBe('medium')
    })

    it('regla fuerte + 3 reglas no fuertes → sigue dominando el piso 65, no el piso 35', () => {
      const result = combine(80, 0.05, [
        hitFor('many-hyphens'),
        hitFor('no-https'),
        hitFor('sensitive-words'),
        hitFor('long-url'),
      ])
      expect(result.finalScore).toBeGreaterThanOrEqual(RULE_OVERRIDE_SCORE)
      expect(result.riskLevel).toBe('high')
    })
  })
})

describe('riskLevelFromScore', () => {
  it('los umbrales son 35 (bajo/medio) y 65 (medio/alto), inclusivos hacia arriba', () => {
    expect(riskLevelFromScore(34)).toBe('low')
    expect(riskLevelFromScore(35)).toBe('medium')
    expect(riskLevelFromScore(64)).toBe('medium')
    expect(riskLevelFromScore(65)).toBe('high')
  })
})
