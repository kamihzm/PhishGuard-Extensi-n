import { describe, expect, it } from 'vitest'
import type { HistoryEntry } from '../history/types'
import { calculateStats } from './calculateStats'

const NOW = new Date('2026-08-26T12:00:00Z')

function buildEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: crypto.randomUUID(),
    url: 'https://example.com/',
    hostname: 'example.com',
    analyzedAt: NOW.toISOString(),
    finalScore: 10,
    ruleScore: 0,
    mlProbability: 0.1,
    riskLevel: 'low',
    activatedRuleIds: [],
    ...overrides,
  }
}

describe('calculateStats', () => {
  it('historial vacío: todo en 0, sin divisiones por cero (NaN)', () => {
    const stats = calculateStats([], NOW)

    expect(stats.total).toBe(0)
    expect(stats.counts).toEqual({ low: 0, medium: 0, high: 0 })
    expect(stats.percentages).toEqual({ low: 0, medium: 0, high: 0 })
    expect(stats.recentActivity).toEqual({ analyzed: 0, high: 0, medium: 0 })
    expect(stats.topDomains).toEqual([])
    expect(stats.topRules).toEqual([])
  })

  it('total correcto', () => {
    const history = [buildEntry(), buildEntry(), buildEntry()]
    expect(calculateStats(history, NOW).total).toBe(3)
  })

  it('conteo de riesgo bajo', () => {
    const history = [
      buildEntry({ riskLevel: 'low' }),
      buildEntry({ riskLevel: 'low' }),
      buildEntry({ riskLevel: 'high' }),
    ]
    expect(calculateStats(history, NOW).counts.low).toBe(2)
  })

  it('conteo de riesgo medio', () => {
    const history = [buildEntry({ riskLevel: 'medium' }), buildEntry({ riskLevel: 'low' })]
    expect(calculateStats(history, NOW).counts.medium).toBe(1)
  })

  it('conteo de riesgo alto', () => {
    const history = [
      buildEntry({ riskLevel: 'high' }),
      buildEntry({ riskLevel: 'high' }),
      buildEntry({ riskLevel: 'low' }),
    ]
    expect(calculateStats(history, NOW).counts.high).toBe(2)
  })

  it('porcentajes se calculan dinámicamente y redondeados', () => {
    // 98 low, 19 medium, 10 high -> total 127 (el ejemplo del pedido)
    const history = [
      ...Array.from({ length: 98 }, () => buildEntry({ riskLevel: 'low' })),
      ...Array.from({ length: 19 }, () => buildEntry({ riskLevel: 'medium' })),
      ...Array.from({ length: 10 }, () => buildEntry({ riskLevel: 'high' })),
    ]

    const stats = calculateStats(history, NOW)
    expect(stats.total).toBe(127)
    expect(stats.percentages).toEqual({ low: 77, medium: 15, high: 8 })
  })

  it('últimos 7 días: cuenta solo lo que cae dentro de la ventana, incluyendo su clasificación', () => {
    const withinWindow = new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString() // hace 3 días
    const outsideWindow = new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString() // hace 10 días

    const history = [
      buildEntry({ analyzedAt: withinWindow, riskLevel: 'high' }),
      buildEntry({ analyzedAt: withinWindow, riskLevel: 'medium' }),
      buildEntry({ analyzedAt: withinWindow, riskLevel: 'low' }),
      buildEntry({ analyzedAt: outsideWindow, riskLevel: 'high' }),
    ]

    const stats = calculateStats(history, NOW)
    expect(stats.recentActivity).toEqual({ analyzed: 3, high: 1, medium: 1 })
  })

  it('dominios más analizados: agrupa por hostname y devuelve máximo 3, ordenados de mayor a menor', () => {
    const history = [
      ...Array.from({ length: 12 }, () => buildEntry({ hostname: 'google.com' })),
      ...Array.from({ length: 8 }, () => buildEntry({ hostname: 'youtube.com' })),
      ...Array.from({ length: 5 }, () => buildEntry({ hostname: 'example.com' })),
      ...Array.from({ length: 2 }, () => buildEntry({ hostname: 'raro.com' })), // no debería entrar en el top 3
    ]

    const stats = calculateStats(history, NOW)
    expect(stats.topDomains).toEqual([
      { hostname: 'google.com', count: 12 },
      { hostname: 'youtube.com', count: 8 },
      { hostname: 'example.com', count: 5 },
    ])
  })

  it('señales más frecuentes: agrupa activatedRuleIds de todas las entradas y devuelve máximo 3, con etiquetas por id', () => {
    const history = [
      ...Array.from({ length: 21 }, () => buildEntry({ activatedRuleIds: ['sensitive-words'] })),
      ...Array.from({ length: 14 }, () => buildEntry({ activatedRuleIds: ['long-url'] })),
      ...Array.from({ length: 9 }, () => buildEntry({ activatedRuleIds: ['no-https'] })),
      ...Array.from({ length: 1 }, () => buildEntry({ activatedRuleIds: ['punycode'] })), // no debería entrar en el top 3
    ]

    const stats = calculateStats(history, NOW)
    expect(stats.topRules).toEqual([
      { ruleId: 'sensitive-words', count: 21 },
      { ruleId: 'long-url', count: 14 },
      { ruleId: 'no-https', count: 9 },
    ])
  })

  it('una entrada puede activar varias reglas a la vez, todas se cuentan', () => {
    const history = [
      buildEntry({ activatedRuleIds: ['no-https', 'long-url'] }),
      buildEntry({ activatedRuleIds: ['no-https'] }),
    ]

    const stats = calculateStats(history, NOW)
    const noHttps = stats.topRules.find((r) => r.ruleId === 'no-https')
    const longUrl = stats.topRules.find((r) => r.ruleId === 'long-url')
    expect(noHttps?.count).toBe(2)
    expect(longUrl?.count).toBe(1)
  })

  it('empate entre dominios: ambos quedan reflejados con su conteo correcto, sin perder ninguno', () => {
    const history = [
      buildEntry({ hostname: 'a.com' }),
      buildEntry({ hostname: 'a.com' }),
      buildEntry({ hostname: 'b.com' }),
      buildEntry({ hostname: 'b.com' }),
    ]

    const stats = calculateStats(history, NOW)
    expect(stats.topDomains).toHaveLength(2)
    expect(stats.topDomains.map((d) => d.count)).toEqual([2, 2])
    expect(new Set(stats.topDomains.map((d) => d.hostname))).toEqual(new Set(['a.com', 'b.com']))
  })

  it('el orden entre dominios empatados es determinista: correr dos veces sobre el mismo historial da el mismo resultado', () => {
    const history = [buildEntry({ hostname: 'a.com' }), buildEntry({ hostname: 'b.com' })]

    expect(calculateStats(history, NOW).topDomains).toEqual(calculateStats(history, NOW).topDomains)
  })

  it('fechas inválidas en analyzedAt no rompen el cálculo: se excluyen de "últimos 7 días" pero el resto sigue funcionando', () => {
    const history = [
      buildEntry({ analyzedAt: 'esto-no-es-una-fecha', riskLevel: 'high' }),
      buildEntry({ analyzedAt: NOW.toISOString(), riskLevel: 'low' }),
    ]

    const stats = calculateStats(history, NOW)
    expect(stats.total).toBe(2) // el total no depende de analyzedAt
    expect(stats.counts).toEqual({ low: 1, medium: 0, high: 1 })
    expect(stats.recentActivity.analyzed).toBe(1) // la fecha inválida queda afuera, no cuenta ni rompe
  })
})
