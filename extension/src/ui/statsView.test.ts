import { describe, expect, it } from 'vitest'
import type { Stats } from '../stats/types'
import { renderStatsPanel } from './statsView'

function buildStats(overrides: Partial<Stats> = {}): Stats {
  return {
    total: 127,
    counts: { low: 98, medium: 19, high: 10 },
    percentages: { low: 77, medium: 15, high: 8 },
    recentActivity: { analyzed: 12, high: 2, medium: 3 },
    topDomains: [
      { hostname: 'google.com', count: 12 },
      { hostname: 'youtube.com', count: 8 },
      { hostname: 'example.com', count: 5 },
    ],
    topRules: [
      { ruleId: 'sensitive-words', count: 21 },
      { ruleId: 'long-url', count: 14 },
      { ruleId: 'no-https', count: 9 },
    ],
    ...overrides,
  }
}

describe('renderStatsPanel', () => {
  it('muestra las 4 métricas principales con sus valores', () => {
    const container = document.createElement('div')
    renderStatsPanel(container, buildStats())

    expect(container.querySelector('.stats-metric-total .stats-metric-value')?.textContent).toBe(
      '127',
    )
    expect(container.querySelector('.stats-metric-low .stats-metric-value')?.textContent).toBe('98')
    expect(container.querySelector('.stats-metric-medium .stats-metric-value')?.textContent).toBe(
      '19',
    )
    expect(container.querySelector('.stats-metric-high .stats-metric-value')?.textContent).toBe(
      '10',
    )
  })

  it('muestra los porcentajes junto a la barra segmentada, con los colores actuales', () => {
    const container = document.createElement('div')
    renderStatsPanel(container, buildStats())

    const legendText = container.querySelector('.stats-legend')?.textContent
    expect(legendText).toContain('Bajo 77%')
    expect(legendText).toContain('Medio 15%')
    expect(legendText).toContain('Alto 8%')

    expect(container.querySelector('.stats-bar-segment.risk-low')).not.toBeNull()
    expect(container.querySelector('.stats-bar-segment.risk-medium')).not.toBeNull()
    expect(container.querySelector('.stats-bar-segment.risk-high')).not.toBeNull()
  })

  it('con historial vacío (total 0), no rompe y muestra 0% en todos lados', () => {
    const container = document.createElement('div')
    renderStatsPanel(
      container,
      buildStats({
        total: 0,
        counts: { low: 0, medium: 0, high: 0 },
        percentages: { low: 0, medium: 0, high: 0 },
        topDomains: [],
        topRules: [],
      }),
    )

    expect(container.querySelector('.stats-metric-total .stats-metric-value')?.textContent).toBe(
      '0',
    )
    expect(container.querySelector('.stats-legend')?.textContent).toContain('Bajo 0%')
    expect(container.querySelectorAll('.stats-rank-item')).toHaveLength(0)
    expect(container.querySelectorAll('.no-hits')).toHaveLength(2) // dominios y reglas
  })

  it('muestra "Últimos 7 días" con analizados/medio/alto', () => {
    const container = document.createElement('div')
    renderStatsPanel(
      container,
      buildStats({ recentActivity: { analyzed: 12, medium: 3, high: 2 } }),
    )

    const text = container.querySelector('.stats-recent-grid')?.textContent
    expect(text).toContain('12')
    expect(text).toContain('3')
    expect(text).toContain('2')
  })

  it('muestra hasta 3 dominios más analizados, ordenados', () => {
    const container = document.createElement('div')
    renderStatsPanel(container, buildStats())

    const items = [...container.querySelectorAll('.stats-section')].find((s) =>
      s.textContent?.includes('Dominios'),
    )
    const labels = [...(items?.querySelectorAll('.stats-rank-label') ?? [])].map(
      (el) => el.textContent,
    )
    expect(labels).toEqual(['google.com', 'youtube.com', 'example.com'])
  })

  it('muestra hasta 3 señales más frecuentes con etiquetas amigables (RULE_CHIP_LABELS)', () => {
    const container = document.createElement('div')
    renderStatsPanel(container, buildStats())

    const items = [...container.querySelectorAll('.stats-section')].find((s) =>
      s.textContent?.includes('Señales'),
    )
    const labels = [...(items?.querySelectorAll('.stats-rank-label') ?? [])].map(
      (el) => el.textContent,
    )
    expect(labels).toEqual([
      'Palabras de acceso o pago',
      'Dirección muy larga',
      'Conexión no cifrada',
    ])
  })

  it('siempre muestra el aviso de privacidad', () => {
    const container = document.createElement('div')
    renderStatsPanel(container, buildStats())

    expect(container.querySelector('.privacy-note')?.textContent).toBe(
      'Las estadísticas se calculan únicamente a partir de tu historial local.',
    )
  })

  it('reemplaza el contenido anterior en vez de acumularlo', () => {
    const container = document.createElement('div')
    renderStatsPanel(container, buildStats({ total: 1 }))
    renderStatsPanel(container, buildStats({ total: 2 }))

    expect(container.querySelectorAll('.stats-metrics-row')).toHaveLength(1)
    expect(container.querySelector('.stats-metric-total .stats-metric-value')?.textContent).toBe(
      '2',
    )
  })
})
