import { MEDIUM_FLOOR_MIN_RULES, STRONG_RULE_IDS } from '../agent/combine'
import type { Decision, RiskLevel } from '../agent/types'
import type { RuleHit } from '../rules/types'
import { RULE_SIGNAL_TEXTS } from './ruleLabels'

/**
 * Explicación en lenguaje natural de un `Decision` YA calculado. Es solo
 * presentación: no recalcula scores, no cambia el nivel de riesgo y solo
 * afirma lo que el propio `Decision` respalda (qué reglas se activaron,
 * en qué nivel quedó y si el análisis automático empujó hacia arriba).
 * Los términos técnicos (sistema experto, modelo, puntuación) quedan para
 * "Ver detalles técnicos" (`analysisDetails.ts`).
 */

export const RISK_LEVEL_LABELS: Record<RiskLevel, string> = {
  low: 'Bajo riesgo',
  medium: 'Riesgo medio',
  high: 'Riesgo alto',
}

/**
 * Punto medio del score del modelo, usado SOLO para elegir la frase sobre el
 * análisis automático ("se parece" / "no se parece" a un sitio falso). No es
 * un umbral de clasificación: el nivel de riesgo lo decide `agent/combine.ts`.
 */
const MODEL_LEANS_PHISHING = 0.5

export interface HumanExplanation {
  /** Veredicto en una frase, el texto más grande de la vista. Nunca dice "seguro". */
  verdict: string
  /** Frase bajo el veredicto: qué vimos, en una línea. */
  headline: string
  /** Título de la lista de motivos ("Por qué te avisamos" o "Lo que vimos"). */
  signalsHeading: string
  /** Una frase por regla activada, sin repetirse en otra parte de la vista. Vacío si no hubo señales. */
  signals: string[]
  /** Qué decir en lugar de la lista cuando no hubo señales concretas; vacío si no hace falta decir nada. */
  noSignalsText: string
  /** "Qué hacer": consejo según el nivel. */
  tip: string
  /** Cómo se llegó al nivel (va en "Ver detalles técnicos", sin repetir las señales). */
  reasoning: string[]
}

/** Veredicto base por nivel (bajo añade "importantes" si hubo alguna señal menor). */
export const RISK_VERDICTS: Record<RiskLevel, string> = {
  low: 'No encontramos señales de riesgo',
  medium: 'Ten cuidado con este sitio',
  high: 'Este sitio podría robar tus datos',
}

const TIPS: Record<RiskLevel, string> = {
  low: 'Antes de escribir contraseñas o datos de pago, revisa que la dirección sea la del sitio oficial.',
  medium:
    'Si vas a iniciar sesión o pagar, escribe tú mismo la dirección oficial en lugar de usar este enlace.',
  high: 'No escribas contraseñas ni datos de pago en esta página. Si necesitas entrar, escribe tú mismo la dirección oficial.',
}

export function buildHumanExplanation(decision: Decision): HumanExplanation {
  const { riskLevel, activatedRules } = decision
  const signals = activatedRules.map(signalTextFor)
  const hasSignals = signals.length > 0

  return {
    verdict:
      riskLevel === 'low' && hasSignals
        ? `${RISK_VERDICTS.low} importantes`
        : RISK_VERDICTS[riskLevel],
    headline: headlineFor(riskLevel, signals.length),
    signalsHeading: riskLevel === 'low' ? 'Lo que vimos' : 'Por qué te avisamos',
    signals,
    noSignalsText:
      riskLevel === 'low'
        ? ''
        : 'No hay un motivo concreto, pero la dirección en conjunto se parece a la de sitios falsos.',
    tip: TIPS[riskLevel],
    reasoning: reasoningFor(decision, decision.mlProbability >= MODEL_LEANS_PHISHING),
  }
}

/**
 * Marca imitada con homoglifos (técnica `homoglyph`), tomada de la explicación
 * que arma la propia regla `punycode-deceptive` ("…para imitar a "paypal.com".").
 * Solo presentación: si la explicación no trae la marca (mezcla de escrituras
 * sin marca reconocida), se usa la frase genérica de la regla.
 */
const HOMOGLYPH_TARGET = /para imitar a "([^"]+)"/

/** Marca que la regla `brand-in-subdomain` encontró delante de un dominio ajeno ("La marca "paypal.com" aparece…"). */
const SUBDOMAIN_BRAND = /^La marca "([^"]+)"/

/** Frase de la lista de motivos para un hit; nombra la marca cuando la regla la conoce. */
export function signalTextFor(hit: RuleHit): string {
  if (hit.id === 'punycode-deceptive') {
    const brand = HOMOGLYPH_TARGET.exec(hit.explanation)?.[1]
    if (brand) return `Usa letras de otro alfabeto para imitar a ${brand}.`
  }
  if (hit.id === 'brand-in-subdomain') {
    const brand = SUBDOMAIN_BRAND.exec(hit.explanation)?.[1]
    if (brand) return `Usa el nombre ${brand} delante de un sitio que no es de esa marca.`
  }
  return RULE_SIGNAL_TEXTS[hit.id]
}

function headlineFor(riskLevel: RiskLevel, signalCount: number): string {
  const counted = `${signalCount} señal${signalCount === 1 ? '' : 'es'}`
  switch (riskLevel) {
    case 'low':
      return signalCount === 0
        ? 'Revisamos la dirección de este sitio y no vimos nada que indique un engaño.'
        : 'Vimos un detalle menor en la dirección, pero en conjunto no indica un engaño.'
    case 'medium':
      return signalCount === 0
        ? 'La forma de la dirección se parece a la de sitios falsos conocidos. Revisa antes de escribir tus datos.'
        : `Encontramos ${counted} que suelen aparecer en sitios falsos. Revisa antes de escribir tus datos.`
    case 'high':
      return signalCount === 0
        ? 'La forma de la dirección se parece mucho a la de sitios falsos conocidos.'
        : 'Encontramos señales típicas de sitios que roban contraseñas o datos de pago.'
  }
}

function reasoningFor(decision: Decision, modelLeansPhishing: boolean): string[] {
  const reasoning: string[] = []
  const ids = decision.activatedRules.map((hit) => hit.id)
  const hasStrongSignal = ids.some((id) => STRONG_RULE_IDS.includes(id))
  const nonStrongCount = ids.filter((id) => !STRONG_RULE_IDS.includes(id)).length

  if (ids.length === 0) reasoning.push('No se activó ninguna regla.')
  if (hasStrongSignal) {
    reasoning.push('Al menos una de las señales es, por sí sola, un indicador fuerte de engaño.')
  } else if (nonStrongCount >= MEDIUM_FLOOR_MIN_RULES) {
    reasoning.push('Varias señales aparecieron a la vez, lo que por sí solo justifica precaución.')
  }
  reasoning.push(
    modelLeansPhishing
      ? 'El análisis automático encontró que la forma de la dirección se parece a la de sitios falsos.'
      : 'El análisis automático no encontró patrones importantes de sitios falsos en la forma de la dirección.',
  )
  return reasoning
}
