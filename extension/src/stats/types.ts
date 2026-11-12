import type { RuleId } from '../rules/weights'

export interface RiskCounts {
  low: number
  medium: number
  high: number
}

/** Redondeados, calculados solo con `total > 0` — ver `calculateStats.ts`. */
export interface RiskPercentages {
  low: number
  medium: number
  high: number
}

export interface RecentActivity {
  analyzed: number
  high: number
  medium: number
}

export interface DomainCount {
  hostname: string
  count: number
}

export interface RuleCount {
  ruleId: RuleId
  count: number
}

export interface Stats {
  total: number
  counts: RiskCounts
  percentages: RiskPercentages
  /** Últimos 7 días, calculado sobre `analyzedAt`. */
  recentActivity: RecentActivity
  /** Top 3 por cantidad de análisis, agrupado por `hostname`. */
  topDomains: DomainCount[]
  /** Top 3 por cantidad de activaciones, agrupado por `activatedRuleIds`. */
  topRules: RuleCount[]
}
