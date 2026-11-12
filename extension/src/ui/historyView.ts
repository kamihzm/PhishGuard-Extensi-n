import type { HistoryEntry, HistoryFilter } from '../history/types'
import { presentRisk } from './render'
import { RULE_CHIP_LABELS } from './ruleLabels'

export interface HistoryViewState {
  filter: HistoryFilter
  confirmingClearAll: boolean
}

export interface HistoryActions {
  onFilterChange: (filter: HistoryFilter) => void
  onDeleteEntry: (id: string) => void
  onRequestClearAll: () => void
  onConfirmClearAll: () => void
  onCancelClearAll: () => void
}

const FILTERS: { value: HistoryFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'low', label: 'Bajo' },
  { value: 'medium', label: 'Medio' },
  { value: 'high', label: 'Alto' },
]

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

/** Puramente presentación: no lee ni escribe `chrome.storage` — recibe los datos ya cargados y notifica intención vía `actions`. */
export function renderHistoryPanel(
  container: HTMLElement,
  entries: HistoryEntry[],
  state: HistoryViewState,
  actions: HistoryActions,
): void {
  container.replaceChildren()

  container.appendChild(buildFilterBar(state.filter, actions.onFilterChange))

  const visible =
    state.filter === 'all' ? entries : entries.filter((entry) => entry.riskLevel === state.filter)

  if (visible.length === 0) {
    const message =
      entries.length === 0
        ? 'Todavía no hay análisis guardados.'
        : 'No hay resultados para este filtro.'
    container.appendChild(el('p', 'no-hits', message))
  } else {
    const list = el('div', 'history-list')
    for (const entry of visible) {
      list.appendChild(buildHistoryItem(entry, actions.onDeleteEntry))
    }
    container.appendChild(list)
  }

  container.appendChild(buildClearAllSection(entries.length > 0, state.confirmingClearAll, actions))
  container.appendChild(
    el('p', 'privacy-note', 'El historial se guarda únicamente en este navegador.'),
  )
}

function buildFilterBar(
  active: HistoryFilter,
  onChange: (filter: HistoryFilter) => void,
): HTMLElement {
  const bar = el('div', 'history-filters')
  for (const { value, label } of FILTERS) {
    const button = el(
      'button',
      `filter-chip${value === active ? ' filter-chip-active' : ''}`,
      label,
    )
    button.type = 'button'
    button.addEventListener('click', () => onChange(value))
    bar.appendChild(button)
  }
  return bar
}

function buildHistoryItem(entry: HistoryEntry, onDelete: (id: string) => void): HTMLElement {
  const { label, className } = presentRisk(entry.riskLevel)

  const details = el('details', 'history-item')
  const summary = document.createElement('summary')
  summary.className = 'history-summary'

  const main = el('div', 'history-main')
  main.appendChild(el('p', 'history-hostname', entry.hostname))

  const riskLine = el('p', 'history-risk-line')
  riskLine.appendChild(el('span', `history-dot ${className}`))
  riskLine.appendChild(document.createTextNode(`${label} · ${entry.finalScore}/100`))
  main.appendChild(riskLine)

  main.appendChild(el('p', 'history-timestamp', formatHistoryTimestamp(entry.analyzedAt)))
  summary.appendChild(main)

  const deleteButton = el('button', 'history-delete', '✕')
  deleteButton.type = 'button'
  deleteButton.setAttribute('aria-label', `Eliminar del historial: ${entry.hostname}`)
  deleteButton.addEventListener('click', (event) => {
    event.preventDefault() // no togglear el <details> al eliminar
    event.stopPropagation()
    onDelete(entry.id)
  })
  summary.appendChild(deleteButton)

  details.appendChild(summary)
  details.appendChild(buildHistoryDetailBody(entry, label))
  return details
}

function buildHistoryDetailBody(entry: HistoryEntry, riskLabel: string): HTMLElement {
  const body = el('div', 'history-detail')

  const urlEl = el('p', 'history-detail-url', entry.url)
  urlEl.title = entry.url
  body.appendChild(urlEl)

  body.appendChild(el('p', 'history-detail-row', `Fecha: ${formatFullTimestamp(entry.analyzedAt)}`))
  body.appendChild(el('p', 'history-detail-row', `Nivel: ${riskLabel}`))
  body.appendChild(el('p', 'history-detail-row', `Score final: ${entry.finalScore}/100`))
  body.appendChild(el('p', 'history-detail-row', `Score de reglas: ${entry.ruleScore}/100`))
  body.appendChild(
    el('p', 'history-detail-row', `Score del modelo: ${Math.round(entry.mlProbability * 100)}%`),
  )

  if (entry.activatedRuleIds.length === 0) {
    body.appendChild(el('p', 'no-hits', 'No se activó ninguna regla.'))
  } else {
    const chips = el('div', 'chips')
    for (const ruleId of entry.activatedRuleIds) {
      chips.appendChild(el('span', 'chip', RULE_CHIP_LABELS[ruleId]))
    }
    body.appendChild(chips)
  }

  return body
}

function buildClearAllSection(
  hasEntries: boolean,
  confirming: boolean,
  actions: HistoryActions,
): HTMLElement {
  const section = el('div', 'clear-all-section')
  if (!hasEntries) return section

  if (!confirming) {
    const button = el('button', 'hist-btn hist-btn-ghost', 'Borrar todo el historial')
    button.type = 'button'
    button.addEventListener('click', actions.onRequestClearAll)
    section.appendChild(button)
    return section
  }

  section.appendChild(
    el(
      'p',
      'clear-all-confirm-text',
      '¿Borrar todo el historial? Esta acción no se puede deshacer.',
    ),
  )
  const row = el('div', 'clear-all-actions')

  const confirmButton = el('button', 'hist-btn hist-btn-danger', 'Sí, borrar todo')
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

function formatHistoryTimestamp(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const time = date.toLocaleTimeString('es', { hour: 'numeric', minute: '2-digit' })

  if (isSameDay(date, now)) return `Hoy · ${time}`

  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (isSameDay(date, yesterday)) return `Ayer · ${time}`

  const dateStr = date.toLocaleDateString('es', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
  return `${dateStr} · ${time}`
}

function formatFullTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' })
}
