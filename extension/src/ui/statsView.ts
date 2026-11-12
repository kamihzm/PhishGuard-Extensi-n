import type { Stats } from '../stats/types'
import { RULE_CHIP_LABELS } from './ruleLabels'

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** Puramente presentación: recibe `Stats` ya calculado, no hace ningún cálculo acá. */
export function renderStatsPanel(container: HTMLElement, stats: Stats): void {
  container.replaceChildren()

  container.appendChild(buildMetricsRow(stats))
  container.appendChild(buildDistributionSection(stats))
  container.appendChild(buildRecentActivitySection(stats))
  container.appendChild(buildTopDomainsSection(stats))
  container.appendChild(buildTopRulesSection(stats))
  container.appendChild(
    el(
      'p',
      'privacy-note',
      'Las estadísticas se calculan únicamente a partir de tu historial local.',
    ),
  )
}

function buildMetricsRow(stats: Stats): HTMLElement {
  const row = el('div', 'stats-metrics-row')
  row.appendChild(buildMetricCard('stats-metric-total', stats.total, 'URLs analizadas'))
  row.appendChild(buildMetricCard('stats-metric-low', stats.counts.low, 'Bajo riesgo'))
  row.appendChild(buildMetricCard('stats-metric-medium', stats.counts.medium, 'Riesgo medio'))
  row.appendChild(buildMetricCard('stats-metric-high', stats.counts.high, 'Riesgo alto'))
  return row
}

function buildMetricCard(modifierClass: string, value: number, label: string): HTMLElement {
  const card = el('div', `stats-metric ${modifierClass}`)
  card.appendChild(el('p', 'stats-metric-value', String(value)))
  card.appendChild(el('p', 'stats-metric-label', label))
  return card
}

function buildDistributionSection(stats: Stats): HTMLElement {
  const section = el('div', 'stats-section')
  section.appendChild(el('p', 'stats-section-title', 'Distribución de riesgo'))

  const bar = el('div', 'stats-bar')
  if (stats.total === 0) {
    bar.appendChild(el('div', 'stats-bar-segment stats-bar-empty'))
  } else {
    bar.appendChild(buildBarSegment('risk-low', stats.percentages.low))
    bar.appendChild(buildBarSegment('risk-medium', stats.percentages.medium))
    bar.appendChild(buildBarSegment('risk-high', stats.percentages.high))
  }
  section.appendChild(bar)

  const legend = el('div', 'stats-legend')
  legend.appendChild(buildLegendItem('risk-low', `Bajo ${stats.percentages.low}%`))
  legend.appendChild(buildLegendItem('risk-medium', `Medio ${stats.percentages.medium}%`))
  legend.appendChild(buildLegendItem('risk-high', `Alto ${stats.percentages.high}%`))
  section.appendChild(legend)

  return section
}

function buildBarSegment(riskClass: string, percentage: number): HTMLElement {
  const segment = el('div', `stats-bar-segment ${riskClass}`)
  segment.style.flexGrow = String(percentage)
  return segment
}

function buildLegendItem(riskClass: string, text: string): HTMLElement {
  const item = el('span', 'stats-legend-item')
  item.appendChild(el('span', `stats-legend-dot ${riskClass}`))
  item.appendChild(document.createTextNode(text))
  return item
}

function buildRecentActivitySection(stats: Stats): HTMLElement {
  const section = el('div', 'stats-section')
  section.appendChild(el('p', 'stats-section-title', 'Últimos 7 días'))

  const grid = el('div', 'stats-recent-grid')
  grid.appendChild(buildRecentStat(stats.recentActivity.analyzed, 'Analizados'))
  grid.appendChild(buildRecentStat(stats.recentActivity.medium, 'Medio'))
  grid.appendChild(buildRecentStat(stats.recentActivity.high, 'Alto'))
  section.appendChild(grid)

  return section
}

function buildRecentStat(value: number, label: string): HTMLElement {
  const stat = el('div', 'stats-recent-stat')
  stat.appendChild(el('p', 'stats-recent-value', String(value)))
  stat.appendChild(el('p', 'stats-recent-label', label))
  return stat
}

function buildTopDomainsSection(stats: Stats): HTMLElement {
  const section = el('div', 'stats-section')
  section.appendChild(el('p', 'stats-section-title', 'Dominios más analizados'))

  if (stats.topDomains.length === 0) {
    section.appendChild(el('p', 'no-hits', 'Todavía no hay suficientes datos.'))
    return section
  }

  const list = document.createElement('ol')
  list.className = 'stats-rank-list'
  for (const domain of stats.topDomains) {
    const item = document.createElement('li')
    item.className = 'stats-rank-item'
    item.appendChild(el('span', 'stats-rank-label', domain.hostname))
    item.appendChild(el('span', 'stats-rank-count', String(domain.count)))
    list.appendChild(item)
  }
  section.appendChild(list)

  return section
}

function buildTopRulesSection(stats: Stats): HTMLElement {
  const section = el('div', 'stats-section')
  section.appendChild(el('p', 'stats-section-title', 'Señales más frecuentes'))

  if (stats.topRules.length === 0) {
    section.appendChild(el('p', 'no-hits', 'Todavía no hay suficientes datos.'))
    return section
  }

  const list = document.createElement('ol')
  list.className = 'stats-rank-list'
  for (const rule of stats.topRules) {
    const item = document.createElement('li')
    item.className = 'stats-rank-item'
    item.appendChild(el('span', 'stats-rank-label', RULE_CHIP_LABELS[rule.ruleId]))
    item.appendChild(el('span', 'stats-rank-count', String(rule.count)))
    list.appendChild(item)
  }
  section.appendChild(list)

  return section
}
