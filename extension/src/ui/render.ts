import type { Decision, RiskLevel } from '../agent/types'
import { buildAnalysisDetails } from './analysisDetails'
import { describeDestination } from './destination'
import {
  buildHumanExplanation,
  RISK_LEVEL_LABELS,
  RISK_VERDICTS,
  type HumanExplanation,
} from './humanExplanation'

export type RiskClassName = 'risk-low' | 'risk-medium' | 'risk-high'

export interface RiskPresentation {
  label: string
  className: RiskClassName
  message: string
}

/** El nivel de riesgo ya lo decide `agent/combine.ts` — acá solo se traduce a texto/color/veredicto, sin repetir ningún umbral. */
const RISK_PRESENTATION: Record<RiskLevel, RiskPresentation> = {
  low: {
    label: RISK_LEVEL_LABELS.low,
    className: 'risk-low',
    message: RISK_VERDICTS.low,
  },
  medium: {
    label: RISK_LEVEL_LABELS.medium,
    className: 'risk-medium',
    message: RISK_VERDICTS.medium,
  },
  high: {
    label: RISK_LEVEL_LABELS.high,
    className: 'risk-high',
    message: RISK_VERDICTS.high,
  },
}

export function presentRisk(riskLevel: RiskLevel): RiskPresentation {
  return RISK_PRESENTATION[riskLevel]
}

/** Íconos del veredicto: además del color y la palabra, la forma distingue el nivel. */
const VERDICT_ICONS: Record<RiskLevel, string> = {
  low: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9.5"/><path d="M8 12.5l2.7 2.7L16.5 9.5"/></svg>',
  medium:
    '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 3.5l9.5 16.5h-19L12 3.5z"/><path d="M12 10v4.5"/><path d="M12 17.5h.01"/></svg>',
  high: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M8.2 2.5h7.6l5.7 5.7v7.6l-5.7 5.7H8.2l-5.7-5.7V8.2z"/><path d="M12 7.5v5.5"/><path d="M12 16.5h.01"/></svg>',
}

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

export interface RenderOptions {
  /** "Modo avanzado" de Ajustes: agrega "Ver detalles técnicos". Apagado por defecto. */
  advanced?: boolean
}

/**
 * Renderiza el `Decision` completo del agente. Es puramente presentación:
 * no recalcula `ruleScore`, `mlProbability`, `finalScore` ni `riskLevel` —
 * solo los muestra, tal como llegan de `agent/orchestrator.ts`.
 *
 * Jerarquía (hecho → destino → motivos → acción): el veredicto en una
 * frase, a qué sitio lleva de verdad la dirección, por qué avisamos (cada
 * motivo una sola vez) y qué hacer. La puntuación y todo lo técnico quedan
 * en "Ver detalles técnicos", que solo existe con el modo avanzado.
 */
export function renderDecision(
  container: HTMLElement,
  decision: Decision,
  options: RenderOptions = {},
): void {
  const human = buildHumanExplanation(decision)
  container.replaceChildren()
  container.appendChild(buildVerdict(decision.riskLevel, human))
  container.appendChild(buildDestinationCard(decision))
  if (human.signals.length > 0 || human.noSignalsText) {
    container.appendChild(buildSignalsSection(human))
  }
  container.appendChild(buildTipCard(human.tip))
  if (options.advanced) container.appendChild(buildAnalysisDetails(decision))
}

export function buildVerdict(riskLevel: RiskLevel, human: HumanExplanation): HTMLElement {
  const { label, className } = presentRisk(riskLevel)
  const section = el('section', `verdict ${className}`)
  section.setAttribute('aria-labelledby', 'verdict-title')

  const icon = el('span', 'verdict-icon')
  icon.innerHTML = VERDICT_ICONS[riskLevel]
  section.appendChild(icon)

  const body = el('div', 'verdict-body')
  body.appendChild(el('p', 'risk-label', label))
  const title = el('h1', 'verdict-title', human.verdict)
  title.id = 'verdict-title'
  body.appendChild(title)
  body.appendChild(el('p', 'risk-message', human.headline))
  section.appendChild(body)
  return section
}

/** "Estás en" o, si la dirección disfraza el destino, "Parece … pero en realidad te lleva a". */
export function buildDestinationCard(decision: Decision): HTMLElement {
  const card = el('section', 'card destination-card')
  const destination = describeDestination(decision)

  const label = el('p', 'card-label destination-label')
  if (destination?.apparent) {
    label.append('Parece ')
    label.appendChild(el('strong', 'destination-apparent', destination.apparent))
    label.append(', pero en realidad te lleva a')
  } else {
    label.textContent = 'Estás en'
  }
  card.appendChild(label)

  if (destination) card.appendChild(el('p', 'destination-domain', destination.realDomain))

  const urlEl = el('p', 'analyzed-url', decision.url)
  urlEl.title = decision.url
  card.appendChild(urlEl)
  return card
}

export function buildSignalsSection(human: HumanExplanation): HTMLElement {
  const section = el('section', 'card signals-card')
  const heading = el('h2', 'card-label', human.signalsHeading)
  heading.id = 'signals-heading'
  section.setAttribute('aria-labelledby', heading.id)
  section.appendChild(heading)

  if (human.signals.length === 0) {
    section.appendChild(el('p', 'no-hits', human.noSignalsText))
    return section
  }

  const list = el('ol', 'signal-list')
  for (const signal of human.signals) list.appendChild(el('li', undefined, signal))
  section.appendChild(list)
  return section
}

function buildTipCard(tip: string): HTMLElement {
  const card = el('section', 'card tips-card')
  card.appendChild(el('h2', 'card-label', 'Qué hacer'))
  card.appendChild(el('p', 'tip-contextual', tip))
  return card
}

export function renderUnavailable(container: HTMLElement, message: string): void {
  container.replaceChildren()
  container.appendChild(el('p', 'unavailable', message))
}
