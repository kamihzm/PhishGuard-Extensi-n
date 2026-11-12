import type { HistoryEntry } from '../history/types'
import type { RuleId } from '../rules/weights'
import type {
  DomainCount,
  RecentActivity,
  RiskCounts,
  RiskPercentages,
  RuleCount,
  Stats,
} from './types'

const RECENT_ACTIVITY_DAYS = 7
const TOP_DOMAINS_LIMIT = 3
const TOP_RULES_LIMIT = 3

/**
 * Función pura: recibe el historial ya cargado y devuelve las
 * estadísticas — no toca `chrome.storage`, no sabe que existe un popup.
 * `now` es un parámetro (no `new Date()` interno) para que "últimos 7
 * días" se pueda probar de forma determinista.
 */
export function calculateStats(history: HistoryEntry[], now: Date = new Date()): Stats {
  const counts = countByRiskLevel(history)

  return {
    total: history.length,
    counts,
    percentages: toPercentages(counts, history.length),
    recentActivity: calculateRecentActivity(history, now),
    topDomains: calculateTopDomains(history),
    topRules: calculateTopRules(history),
  }
}

function countByRiskLevel(history: HistoryEntry[]): RiskCounts {
  const counts: RiskCounts = { low: 0, medium: 0, high: 0 }
  for (const entry of history) {
    counts[entry.riskLevel] += 1
  }
  return counts
}

/** Evita la división por cero explícitamente: con `total === 0` los tres quedan en 0%, no `NaN`. */
function toPercentages(counts: RiskCounts, total: number): RiskPercentages {
  if (total === 0) return { low: 0, medium: 0, high: 0 }
  return {
    low: Math.round((counts.low / total) * 100),
    medium: Math.round((counts.medium / total) * 100),
    high: Math.round((counts.high / total) * 100),
  }
}

/** `undefined` si `analyzedAt` no es una fecha válida — una entrada corrupta no debe romper el cálculo de las demás. */
function parseValidDate(iso: string): Date | undefined {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? undefined : date
}

function calculateRecentActivity(history: HistoryEntry[], now: Date): RecentActivity {
  const cutoff = now.getTime() - RECENT_ACTIVITY_DAYS * 24 * 60 * 60 * 1000

  const recent = history.filter((entry) => {
    const date = parseValidDate(entry.analyzedAt)
    return date !== undefined && date.getTime() >= cutoff && date.getTime() <= now.getTime()
  })

  return {
    analyzed: recent.length,
    high: recent.filter((entry) => entry.riskLevel === 'high').length,
    medium: recent.filter((entry) => entry.riskLevel === 'medium').length,
  }
}

/** `Map` conserva el orden de inserción y `Array.sort` es estable — un empate mantiene el orden en que el dominio apareció primero en `history`, siempre igual para la misma entrada. */
function calculateTopDomains(history: HistoryEntry[]): DomainCount[] {
  const counts = new Map<string, number>()
  for (const entry of history) {
    counts.set(entry.hostname, (counts.get(entry.hostname) ?? 0) + 1)
  }

  return [...counts.entries()]
    .map(([hostname, count]) => ({ hostname, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_DOMAINS_LIMIT)
}

function calculateTopRules(history: HistoryEntry[]): RuleCount[] {
  const counts = new Map<RuleId, number>()
  for (const entry of history) {
    for (const ruleId of entry.activatedRuleIds) {
      counts.set(ruleId, (counts.get(ruleId) ?? 0) + 1)
    }
  }

  return [...counts.entries()]
    .map(([ruleId, count]) => ({ ruleId, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_RULES_LIMIT)
}
