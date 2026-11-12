import type { TrustedSite } from '../trustedSites/types'

export interface TrustedSitesViewState {
  confirmingClearAll: boolean
  /** Mensaje de error de la última llamada a `onAddDomain` (esquema inválido, hostname vacío, etc.), si la hubo. */
  addError?: string
}

export interface TrustedSitesActions {
  onAddDomain: (value: string) => void
  onDeleteHostname: (hostname: string) => void
  onRequestClearAll: () => void
  onConfirmClearAll: () => void
  onCancelClearAll: () => void
}

export interface TrustedSitesSummaryState {
  expanded: boolean
}

export interface TrustedSitesSummaryActions {
  onToggleExpanded: () => void
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

function pluralizeSites(count: number): string {
  if (count === 0) return 'Ningún sitio permitido'
  if (count === 1) return '1 sitio permitido'
  return `${count} sitios permitidos`
}

/**
 * Vista compacta (siempre visible en Configuración): solo el título, un
 * conteo y un botón para expandir/ocultar la administración completa — no
 * se muestra la lista entera directamente para no ocupar demasiado
 * espacio. Puramente presentación: no toca `chrome.storage`.
 */
export function renderTrustedSitesSummary(
  container: HTMLElement,
  count: number,
  state: TrustedSitesSummaryState,
  actions: TrustedSitesSummaryActions,
): void {
  container.replaceChildren()

  container.appendChild(el('p', 'stats-section-title', 'SITIOS CONFIABLES'))

  const row = el('div', 'trusted-summary-row')
  row.appendChild(el('p', 'trusted-summary-count', pluralizeSites(count)))

  const button = el('button', 'hist-btn hist-btn-ghost', state.expanded ? 'Ocultar' : 'Administrar')
  button.type = 'button'
  button.addEventListener('click', actions.onToggleExpanded)
  row.appendChild(button)

  container.appendChild(row)
}

/**
 * Vista expandida ("Administrar"): agregar, listar, eliminar uno, eliminar
 * todos. Puramente presentación: recibe la lista ya cargada de
 * `trustedSites/service.ts`, no toca `chrome.storage` acá. No repite el
 * título "SITIOS CONFIABLES" — ya lo muestra `renderTrustedSitesSummary`.
 */
export function renderTrustedSitesPanel(
  container: HTMLElement,
  sites: TrustedSite[],
  state: TrustedSitesViewState,
  actions: TrustedSitesActions,
): void {
  container.replaceChildren()

  container.appendChild(buildAddForm(state.addError, actions.onAddDomain))

  if (sites.length === 0) {
    container.appendChild(el('p', 'no-hits', 'Todavía no marcaste ningún sitio como confiable.'))
  } else {
    const list = el('div', 'trusted-list')
    for (const site of sites) {
      list.appendChild(buildTrustedItem(site, actions.onDeleteHostname))
    }
    container.appendChild(list)
  }

  container.appendChild(buildClearAllSection(sites.length > 0, state.confirmingClearAll, actions))
  container.appendChild(
    el(
      'p',
      'privacy-note',
      'Los sitios confiables se guardan únicamente en este navegador (chrome.storage.local).',
    ),
  )
}

function buildAddForm(
  addError: string | undefined,
  onAddDomain: (value: string) => void,
): HTMLElement {
  const form = el('form', 'trusted-add-form')

  const input = el('input', 'trusted-add-input')
  input.type = 'text'
  input.placeholder = 'ejemplo.com'
  input.setAttribute('aria-label', 'Agregar dominio a sitios confiables')

  const button = el('button', 'hist-btn hist-btn-ghost', 'Agregar')
  button.type = 'submit'

  form.appendChild(input)
  form.appendChild(button)

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const value = input.value.trim()
    if (value === '') return
    onAddDomain(value)
    input.value = ''
  })

  if (addError) {
    const wrap = el('div', 'trusted-add-wrap')
    wrap.appendChild(form)
    wrap.appendChild(el('p', 'trusted-add-error', addError))
    return wrap
  }

  return form
}

function buildTrustedItem(site: TrustedSite, onDelete: (hostname: string) => void): HTMLElement {
  const item = el('div', 'trusted-item')

  const main = el('div', 'trusted-item-main')
  main.appendChild(el('p', 'trusted-item-hostname', site.hostname))
  main.appendChild(el('p', 'trusted-item-added', formatAddedAt(site.addedAt)))
  item.appendChild(main)

  const deleteButton = el('button', 'history-delete', '✕')
  deleteButton.type = 'button'
  deleteButton.setAttribute('aria-label', `Eliminar de sitios confiables: ${site.hostname}`)
  deleteButton.addEventListener('click', () => onDelete(site.hostname))
  item.appendChild(deleteButton)

  return item
}

function buildClearAllSection(
  hasEntries: boolean,
  confirming: boolean,
  actions: TrustedSitesActions,
): HTMLElement {
  const section = el('div', 'clear-all-section')
  if (!hasEntries) return section

  if (!confirming) {
    const button = el('button', 'hist-btn hist-btn-ghost', 'Eliminar todos')
    button.type = 'button'
    button.addEventListener('click', actions.onRequestClearAll)
    section.appendChild(button)
    return section
  }

  section.appendChild(
    el(
      'p',
      'clear-all-confirm-text',
      '¿Eliminar todos los sitios confiables? Volverán a evaluarse normalmente.',
    ),
  )
  const row = el('div', 'clear-all-actions')

  const confirmButton = el('button', 'hist-btn hist-btn-danger', 'Sí, eliminar todos')
  confirmButton.type = 'button'
  confirmButton.addEventListener('click', actions.onConfirmClearAll)
  row.appendChild(confirmButton)

  const cancelButton = el('button', 'hist-btn hist-btn-ghost', 'Cancelar')
  cancelButton.type = 'button'
  cancelButton.addEventListener('click', actions.onCancelClearAll)
  row.appendChild(cancelButton)

  section.appendChild(row)
  return section
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function formatAddedAt(iso: string): string {
  const date = new Date(iso)
  const now = new Date()

  if (isSameDay(date, now)) return 'Agregado hoy'

  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (isSameDay(date, yesterday)) return 'Agregado ayer'

  const dateStr = date.toLocaleDateString('es', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
  return `Agregado el ${dateStr}`
}
