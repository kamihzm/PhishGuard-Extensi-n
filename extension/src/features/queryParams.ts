import { CLICK_TRACKING_PARAM_NAMES, TRACKING_PARAM_NAMES } from '../shared/constants'

/**
 * Análisis estructurado de los query params de una URL, vía
 * `URLSearchParams` sobre el `query` ya descompuesto por `urlParts.ts`
 * (nunca se re-parsea la cadena cruda con regex). Puramente descriptivo:
 * NINGÚN campo de acá alimenta todavía una regla de `rules/` ni el vector
 * de ML (`ml/vectorize.ts`) — la evaluación empírica sobre el dataset
 * (`docs/tracking-parameter-analysis.md`) encontró separación
 * legítimo/phishing insignificante (Cohen's d < 0.08 en las 4 features),
 * así que agregarlas como señal de riesgo no tendría respaldo en datos.
 * Un parámetro de tracking NO implica phishing — se mantiene calculado acá
 * únicamente para explicación contextual y como insumo futuro del análisis
 * de redirecciones (`docs/navigation-redirect-detection-design.md`).
 */
export interface QueryParamAnalysis {
  /** Cantidad total de query params (sin filtrar por tracking). */
  queryParamCount: number
  /** Cuántos de esos params coinciden (en minúsculas) con `TRACKING_PARAM_NAMES`. */
  trackingParamCount: number
  /** Al menos un param identifica específicamente un click de red de afiliados/ads (`CLICK_TRACKING_PARAM_NAMES`), no solo atribución UTM genérica. */
  hasClickTrackingId: boolean
  /** `trackingParamCount / queryParamCount`, o 0 si no hay ningún query param (evita dividir por 0). */
  trackingParamRatio: number
}

/**
 * @param query Query string SIN el `?` inicial (mismo formato que devuelve `decomposeUrl().query`).
 */
export function analyzeQueryParams(query: string): QueryParamAnalysis {
  const names = [...new URLSearchParams(query).keys()].map((name) => name.toLowerCase())

  const queryParamCount = names.length
  const trackingParamCount = names.filter((name) => TRACKING_PARAM_NAMES.includes(name)).length
  const hasClickTrackingId = names.some((name) => CLICK_TRACKING_PARAM_NAMES.includes(name))
  const trackingParamRatio = queryParamCount === 0 ? 0 : trackingParamCount / queryParamCount

  return { queryParamCount, trackingParamCount, hasClickTrackingId, trackingParamRatio }
}
