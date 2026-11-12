import type { Decision } from '../../agent/types'
import { normalizeTrustedHostname } from '../../trustedSites/normalizeTrustedHostname'
import { buildAnalysisDetails } from '../analysisDetails'
import { buildHumanExplanation } from '../humanExplanation'
import { buildDestinationCard, buildSignalsSection } from '../render'

export interface WarningActions {
  onGoBack: () => void
  onContinueAnyway: () => void
  onRequestTrust: () => void
  onConfirmTrust: () => void
  onCancelTrust: () => void
}

/** Único estado mutable de esta página: si se está mostrando la confirmación de "Confiar en este sitio". */
export interface WarningViewState {
  confirmingTrust: boolean
}

const SHIELD_ICON =
  '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z"/><path d="M12 8v5"/><path d="M12 16.5h.01"/></svg>'

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

/**
 * Renderiza la advertencia a partir del `Decision` ya calculado por
 * `agent/orchestrator.ts` — no recalcula nada, solo lo muestra. Se llama
 * únicamente para `riskLevel === 'high'` (lo decide `background`, no esta
 * función).
 *
 * Jerarquía de la dirección A: el veredicto en una frase, a dónde lleva de
 * verdad la dirección, los motivos numerados, qué hacer y UNA sola acción
 * principal ("Volver a un sitio seguro"). Continuar y confiar quedan como
 * enlaces discretos; la puntuación, en "Ver detalles técnicos" (solo con
 * el modo avanzado de Ajustes).
 */
export function renderWarning(
  container: HTMLElement,
  decision: Decision,
  viewState: WarningViewState,
  actions: WarningActions,
  options: { advanced?: boolean } = {},
): void {
  container.replaceChildren()
  const human = buildHumanExplanation(decision)

  const card = el('section', 'warning-card')
  card.setAttribute('aria-labelledby', 'warning-headline')

  const brand = el('p', 'brand')
  const icon = el('span', 'brand-icon')
  icon.innerHTML = SHIELD_ICON
  brand.appendChild(icon)
  brand.appendChild(el('span', undefined, 'PhishGuard detuvo esta página'))
  card.appendChild(brand)

  const headline = el('h1', 'headline', human.verdict)
  headline.id = 'warning-headline'
  card.appendChild(headline)
  card.appendChild(el('p', 'short-explanation', human.headline))

  const destination = buildDestinationCard(decision)
  destination.classList.add('target')
  card.appendChild(destination)

  const signals = buildSignalsSection(human)
  signals.classList.add('signals')
  card.appendChild(signals)

  const tip = el('section', 'tip')
  tip.appendChild(el('h2', 'section-label', 'Qué hacer'))
  tip.appendChild(el('p', 'tip-contextual', human.tip))
  card.appendChild(tip)

  card.appendChild(buildActions(actions))
  const secondary = el('div', 'secondary-actions')
  const continueAnyway = el('button', 'btn btn-continue', 'Continuar de todas formas')
  continueAnyway.type = 'button'
  continueAnyway.addEventListener('click', actions.onContinueAnyway)
  secondary.appendChild(continueAnyway)
  secondary.appendChild(buildTrustSection(decision, viewState, actions))
  card.appendChild(secondary)
  if (options.advanced) card.appendChild(buildAnalysisDetails(decision))
  card.appendChild(
    el(
      'p',
      'privacy-footnote',
      'PhishGuard revisa solo la dirección, en tu equipo, sin enviarla a ningún servidor. Puede equivocarse: si conoces el sitio, puedes continuar.',
    ),
  )

  container.appendChild(card)
}

/**
 * "Confiar en este sitio" — deliberadamente discreta (nunca botón primario)
 * y separada de la acción principal. Confirmación en línea (mismo patrón
 * que "Borrar todo" en el popup), no `window.confirm()`; se anuncia a los
 * lectores de pantalla con `aria-live`.
 */
function buildTrustSection(
  decision: Decision,
  viewState: WarningViewState,
  actions: WarningActions,
): HTMLElement {
  const wrap = el('div', 'trust-section')
  wrap.setAttribute('aria-live', 'polite')

  if (!viewState.confirmingTrust) {
    const link = el('button', 'link-trust', 'Confiar en este sitio')
    link.type = 'button'
    link.addEventListener('click', actions.onRequestTrust)
    wrap.appendChild(link)
    return wrap
  }

  let hostname: string
  try {
    hostname = normalizeTrustedHostname(decision.url)
  } catch {
    hostname = decision.url
  }

  const text = el(
    'p',
    'trust-confirm-text',
    `¿Deseas confiar en ${hostname}? PhishGuard dejará de mostrar advertencias para este dominio hasta que lo elimines de Sitios confiables.`,
  )
  text.tabIndex = -1
  wrap.appendChild(text)

  const confirmRow = el('div', 'trust-confirm-actions')

  const confirm = el('button', 'btn-trust-confirm', 'Sí, confiar')
  confirm.type = 'button'
  confirm.addEventListener('click', actions.onConfirmTrust)
  confirmRow.appendChild(confirm)

  const cancel = el('button', 'btn-trust-cancel', 'Cancelar')
  cancel.type = 'button'
  cancel.addEventListener('click', actions.onCancelTrust)
  confirmRow.appendChild(cancel)

  wrap.appendChild(confirmRow)
  return wrap
}

/** La única acción principal: volver a un lugar seguro. */
function buildActions(actions: WarningActions): HTMLElement {
  const wrap = el('div', 'actions')

  const goBack = el('button', 'btn btn-safe', 'Volver a un sitio seguro')
  goBack.type = 'button'
  goBack.addEventListener('click', actions.onGoBack)
  wrap.appendChild(goBack)

  return wrap
}

export interface UnavailableActions {
  onCloseTab: () => void
  onNewTab: () => void
}

/**
 * Fallback real: solo debería aparecer si el `warningId` de la URL no
 * corresponde a ningún contexto guardado (por ejemplo, la página se abrió
 * de una forma que la extensión no controla) — nunca durante el flujo
 * normal de una redirección HIGH.
 */
export function renderWarningUnavailable(
  container: HTMLElement,
  actions: UnavailableActions,
): void {
  container.replaceChildren()

  const card = el('section', 'warning-card')
  card.setAttribute('aria-labelledby', 'warning-headline')
  const brand = el('p', 'brand')
  const icon = el('span', 'brand-icon')
  icon.innerHTML = SHIELD_ICON
  brand.appendChild(icon)
  brand.appendChild(el('span', undefined, 'PhishGuard'))
  card.appendChild(brand)

  const headline = el('h1', 'headline', 'No se pudo recuperar el análisis')
  headline.id = 'warning-headline'
  card.appendChild(headline)
  card.appendChild(
    el(
      'p',
      'short-explanation',
      'No encontramos la información de esta advertencia. Por seguridad, no continuamos hacia el sitio original.',
    ),
  )

  const wrap = el('div', 'actions')

  const closeTab = el('button', 'btn btn-safe', 'Cerrar pestaña')
  closeTab.type = 'button'
  closeTab.addEventListener('click', actions.onCloseTab)
  wrap.appendChild(closeTab)

  const newTab = el('button', 'btn btn-continue', 'Ir a nueva pestaña')
  newTab.type = 'button'
  newTab.addEventListener('click', actions.onNewTab)
  wrap.appendChild(newTab)

  card.appendChild(wrap)
  container.appendChild(card)
}
