import { RISK_HIGH_THRESHOLD, RISK_LOW_THRESHOLD } from '../agent/combine'
import type { RiskLevel } from '../agent/types'

/**
 * Rangos de la leyenda calculados a partir de los umbrales REALES de
 * `agent/combine.ts` — nunca se escriben a mano, para que la UI no pueda
 * divergir de la lógica si esos umbrales cambian en el futuro.
 */
export interface LegendItem {
  riskLevel: RiskLevel
  label: string
  range: string
  className: string
}

export function buildLegendItems(): LegendItem[] {
  return [
    {
      riskLevel: 'low',
      label: 'Bajo',
      range: `0–${RISK_LOW_THRESHOLD - 1}`,
      className: 'legend-dot-low',
    },
    {
      riskLevel: 'medium',
      label: 'Medio',
      range: `${RISK_LOW_THRESHOLD}–${RISK_HIGH_THRESHOLD - 1}`,
      className: 'legend-dot-medium',
    },
    {
      riskLevel: 'high',
      label: 'Alto',
      range: `${RISK_HIGH_THRESHOLD}–100`,
      className: 'legend-dot-high',
    },
  ]
}
