import type { MediumNoticeContent } from '../../shared/messages'

/**
 * Aviso de nivel medio dentro de la página (dirección B, "píldora"):
 * "Precaución · Ver motivo · ×" abajo a la izquierda, que se abre en un
 * panel hacia arriba. No bloquea ni tapa la página, no roba el foco y se
 * cierra con × o Esc.
 *
 * Aislamiento: todo vive en un Shadow DOM CERRADO (la página no puede leer
 * ni tocar sus nodos y su CSS no entra) dentro de un elemento propio que
 * se muestra en la capa superior del navegador (`popover="manual"`), por
 * encima de cualquier `z-index` de la página. Las propiedades del elemento
 * anfitrión van en línea con `!important`, para que reglas como
 * `* { all: unset !important }` no lo escondan ni lo muevan.
 */
export const NOTICE_TAG = 'phishguard-notice'

export interface NoticeActions {
  onDismiss: () => void
  onTrust: () => void
}

export interface NoticeOptions {
  /**
   * Solo se aceptan clics y teclas reales del usuario (`event.isTrusted`):
   * un script de la página no puede pulsar "Confiar en este sitio". Los
   * tests lo desactivan porque jsdom no genera eventos de confianza.
   */
  requireTrustedEvents?: boolean
  /** Retraso antes de escribir en la región `aria-live` (para que el lector de pantalla lo anuncie). */
  announceDelayMs?: number
}

export interface MountedNotice {
  host: HTMLElement
  /** Solo para pruebas: la raíz cerrada no es accesible desde fuera. */
  root: ShadowRoot
  remove: () => void
}

const HOST_STYLE: Record<string, string> = {
  all: 'initial',
  display: 'block',
  position: 'fixed',
  top: 'auto',
  right: 'auto',
  bottom: '16px',
  left: '16px',
  margin: '0',
  padding: '0',
  border: '0',
  width: 'auto',
  height: 'auto',
  'max-width': 'calc(100vw - 32px)',
  'max-height': 'calc(100vh - 32px)',
  overflow: 'visible',
  background: 'transparent',
  color: 'inherit',
  opacity: '1',
  visibility: 'visible',
  transform: 'none',
  filter: 'none',
  'clip-path': 'none',
  'pointer-events': 'auto',
  'z-index': '2147483647',
  contain: 'layout style',
}

const STYLES = `
:host { all: initial; }
* { box-sizing: border-box; }
.notice {
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  line-height: 1.45;
  color: #e8ecf6;
  text-align: left;
  transition: opacity 150ms ease-out;
}
@starting-style {
  .notice { opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .notice { transition: none; }
}
.sr {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
button {
  font: inherit; color: inherit; margin: 0; cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
button:focus-visible {
  outline: 3px solid #8db4ff;
  outline-offset: 2px;
}
.pill {
  display: flex; align-items: center; gap: 4px;
  background: #131a2e; border: 1px solid #5c4316; border-radius: 999px;
  padding: 4px 4px 4px 12px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.28);
}
.pill-label { font-weight: 700; color: #f5a524; padding: 0 6px 0 2px; }
.icon { display: flex; color: #f5a524; flex-shrink: 0; }
.more {
  font-weight: 700; font-size: 14px;
  padding: 7px 12px; border: 0; border-radius: 999px;
  background: #26304a; color: #8db4ff;
}
.more:hover { background: #313d5c; }
.close {
  width: 32px; height: 32px; border: 0; border-radius: 999px;
  background: transparent; color: #a9b2cc; font-size: 20px; line-height: 1;
  display: flex; align-items: center; justify-content: center;
}
.close:hover { background: #26304a; color: #e8ecf6; }
.panel {
  width: min(360px, calc(100vw - 32px));
  max-height: calc(100vh - 32px);
  overflow: auto;
  background: #131a2e; border: 1px solid #5c4316; border-radius: 14px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  padding: 14px 16px;
  display: flex; flex-direction: column; gap: 10px;
}
.panel[hidden], .pill[hidden], .confirm[hidden], .trust[hidden] { display: none; }
.panel-head { display: flex; align-items: center; gap: 8px; }
.title {
  flex-grow: 1; margin: 0;
  font-size: 16px; font-weight: 700; color: #f5a524;
}
.title:focus { outline: none; }
.title:focus-visible { outline: 3px solid #8db4ff; outline-offset: 2px; }
.headline { margin: 0; }
.destination {
  background: #0b1020; border: 1px solid #26304a; border-radius: 10px;
  padding: 10px 12px;
}
.destination-label { margin: 0; font-size: 13px; color: #a9b2cc; }
.destination-label strong { color: #e8ecf6; }
.domain { margin: 0; font-size: 17px; font-weight: 700; overflow-wrap: anywhere; }
.section-label { margin: 0; font-size: 13px; font-weight: 700; color: #a9b2cc; }
ol { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 6px; }
li::marker { color: #f5a524; font-weight: 700; }
.tip { margin: 0; color: #c9d0e3; }
.tip strong { color: #e8ecf6; }
.trust, .confirm-actions button {
  align-self: flex-start;
  background: none; border: 0; padding: 2px 0;
  color: #a9b2cc; font-size: 13px;
  text-decoration: underline; text-underline-offset: 3px;
}
.trust:hover { color: #e8ecf6; }
.confirm { display: flex; flex-direction: column; gap: 8px; }
.confirm p { margin: 0; font-size: 13px; }
.confirm-actions { display: flex; gap: 8px; }
.confirm-actions button {
  text-decoration: none; padding: 6px 12px; border-radius: 8px;
  background: #26304a; color: #e8ecf6; font-weight: 700;
}
.confirm-actions button:hover { background: #313d5c; }
`

const WARNING_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 3l10 18H2L12 3z"/><path d="M12 10v5"/><path d="M12 18h.01"/></svg>'

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

export function mountMediumNotice(
  doc: Document,
  content: MediumNoticeContent,
  actions: NoticeActions,
  options: NoticeOptions = {},
): MountedNotice {
  const requireTrusted = options.requireTrustedEvents ?? true
  const accepted = (event: Event) => !requireTrusted || event.isTrusted

  const host = doc.createElement(NOTICE_TAG)
  for (const [property, value] of Object.entries(HOST_STYLE)) {
    host.style.setProperty(property, value, 'important')
  }
  host.setAttribute('popover', 'manual')
  const root = host.attachShadow({ mode: 'closed' })

  const style = el(doc, 'style')
  style.textContent = STYLES
  root.appendChild(style)

  const notice = el(doc, 'div', 'notice')
  notice.lang = 'es'
  root.appendChild(notice)

  // Región viva: se escribe después de montarla para que se anuncie sin mover el foco.
  const live = el(doc, 'div', 'sr')
  live.setAttribute('role', 'status')
  notice.appendChild(live)

  // --- Píldora ---
  const pill = el(doc, 'div', 'pill')
  const pillIcon = el(doc, 'span', 'icon')
  pillIcon.innerHTML = WARNING_ICON
  pill.appendChild(pillIcon)
  pill.appendChild(el(doc, 'span', 'pill-label', 'Precaución'))
  const more = el(doc, 'button', 'more', 'Ver motivo')
  more.type = 'button'
  more.setAttribute('aria-expanded', 'false')
  more.setAttribute('aria-controls', 'phishguard-panel')
  pill.appendChild(more)
  const pillClose = el(doc, 'button', 'close', '×')
  pillClose.type = 'button'
  pillClose.setAttribute('aria-label', 'Cerrar aviso de PhishGuard')
  pill.appendChild(pillClose)
  notice.appendChild(pill)

  // --- Panel ---
  const panel = el(doc, 'section', 'panel')
  panel.id = 'phishguard-panel'
  panel.hidden = true
  panel.setAttribute('aria-labelledby', 'phishguard-title')

  const head = el(doc, 'div', 'panel-head')
  const headIcon = el(doc, 'span', 'icon')
  headIcon.innerHTML = WARNING_ICON
  head.appendChild(headIcon)
  const title = el(doc, 'h2', 'title', content.verdict)
  title.id = 'phishguard-title'
  title.tabIndex = -1
  head.appendChild(title)
  const panelClose = el(doc, 'button', 'close', '×')
  panelClose.type = 'button'
  panelClose.setAttribute('aria-label', 'Cerrar aviso de PhishGuard')
  head.appendChild(panelClose)
  panel.appendChild(head)

  panel.appendChild(el(doc, 'p', 'headline', content.headline))

  const destination = el(doc, 'div', 'destination')
  const label = el(doc, 'p', 'destination-label')
  if (content.apparent) {
    label.append('Parece ')
    label.appendChild(el(doc, 'strong', undefined, content.apparent))
    label.append(', pero en realidad te lleva a')
  } else {
    label.textContent = 'Estás en'
  }
  destination.appendChild(label)
  destination.appendChild(el(doc, 'p', 'domain', content.realDomain))
  panel.appendChild(destination)

  panel.appendChild(el(doc, 'p', 'section-label', content.signalsHeading))
  if (content.signals.length > 0) {
    const list = el(doc, 'ol')
    for (const signal of content.signals) list.appendChild(el(doc, 'li', undefined, signal))
    panel.appendChild(list)
  } else {
    panel.appendChild(el(doc, 'p', 'tip', content.noSignalsText))
  }

  const tip = el(doc, 'p', 'tip')
  tip.appendChild(el(doc, 'strong', undefined, 'Qué hacer: '))
  tip.append(content.tip)
  panel.appendChild(tip)

  const trust = el(doc, 'button', 'trust', 'Confiar en este sitio')
  trust.type = 'button'
  panel.appendChild(trust)

  const confirm = el(doc, 'div', 'confirm')
  confirm.hidden = true
  const confirmText = el(
    doc,
    'p',
    undefined,
    `¿Deseas confiar en ${content.trustHostname}? PhishGuard dejará de avisarte en este dominio hasta que lo quites de Sitios confiables.`,
  )
  confirmText.tabIndex = -1
  confirm.appendChild(confirmText)
  const confirmActions = el(doc, 'div', 'confirm-actions')
  const yes = el(doc, 'button', 'confirm-yes', 'Sí, confiar')
  yes.type = 'button'
  const no = el(doc, 'button', 'confirm-no', 'Cancelar')
  no.type = 'button'
  confirmActions.append(yes, no)
  confirm.appendChild(confirmActions)
  panel.appendChild(confirm)
  notice.appendChild(panel)

  // --- Comportamiento ---
  let removed = false
  function remove(): void {
    if (removed) return
    removed = true
    try {
      host.hidePopover?.()
    } catch {
      // ya no estaba en la capa superior
    }
    host.remove()
  }
  function expand(): void {
    pill.hidden = true
    panel.hidden = false
    more.setAttribute('aria-expanded', 'true')
    title.focus() // acción del usuario: el foco sigue al panel que acaba de abrir
  }
  function collapse(): void {
    panel.hidden = true
    pill.hidden = false
    more.setAttribute('aria-expanded', 'false')
    more.focus()
  }
  function dismiss(): void {
    remove()
    actions.onDismiss()
  }
  function showConfirm(show: boolean): void {
    confirm.hidden = !show
    trust.hidden = show
    if (show) confirmText.focus()
    else trust.focus()
  }

  more.addEventListener('click', (event) => accepted(event) && expand())
  pillClose.addEventListener('click', (event) => accepted(event) && dismiss())
  panelClose.addEventListener('click', (event) => accepted(event) && dismiss())
  trust.addEventListener('click', (event) => accepted(event) && showConfirm(true))
  no.addEventListener('click', (event) => accepted(event) && showConfirm(false))
  yes.addEventListener('click', (event) => {
    if (!accepted(event)) return
    remove()
    actions.onTrust()
  })
  // Esc solo cuando el foco está dentro del aviso: no interfiere con la página.
  notice.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !accepted(event)) return
    event.stopPropagation()
    if (!panel.hidden) collapse()
    else dismiss()
  })

  ;(doc.documentElement ?? doc.body).appendChild(host)
  try {
    host.showPopover?.()
  } catch {
    // Sin soporte de popover: queda como `position: fixed` con z-index máximo.
  }

  const announce = () => {
    live.textContent = `Aviso de PhishGuard: ${content.verdict.toLowerCase()}. Usa el botón «Ver motivo» para saber por qué.`
  }
  setTimeout(announce, options.announceDelayMs ?? 400)

  return { host, root, remove }
}
