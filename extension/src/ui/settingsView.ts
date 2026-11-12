import type { Settings } from '../settings/types'

export interface SettingsViewState {
  confirmingClearHistory: boolean
}

export interface SettingsActions {
  onToggle: (key: keyof Settings, value: boolean) => void
  onRequestClearHistory: () => void
  onConfirmClearHistory: () => void
  onCancelClearHistory: () => void
}

interface ToggleDefinition {
  key: keyof Settings
  label: string
  description: string
}

/**
 * Toggles visibles: los 2 del MVP más "Modo avanzado" (rediseño de la
 * interfaz, apagado por defecto). Las
 * otras dos preferencias de `Settings` (`saveHistoryEnabled`,
 * `showBadgeEnabled`) siguen existiendo en `settings/types.ts` y
 * `navigationGate.ts` sigue leyéndolas — solo dejan de tener un control
 * visual, así que se quedan en su valor por defecto (`true`): el historial
 * sigue guardándose y el badge sigue funcionando automáticamente.
 */
const TOGGLES: ToggleDefinition[] = [
  {
    key: 'phishingProtectionEnabled',
    label: 'Protección contra phishing',
    description: 'Analiza las URLs mientras navegas.',
  },
  {
    key: 'highRiskWarningEnabled',
    label: 'Advertencias de riesgo alto',
    description: 'Detiene temporalmente páginas clasificadas como alto riesgo.',
  },
  {
    key: 'advancedModeEnabled',
    label: 'Modo avanzado (detalles técnicos)',
    description: 'Para ver cómo decide PhishGuard: reglas, modelo y puntuación.',
  },
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

/**
 * Puramente presentación: recibe `Settings` ya cargado, no toca
 * `chrome.storage` acá — `popup.ts` es quien llama a `settings/service.ts`.
 * Renderiza únicamente "CONFIGURACIÓN GENERAL" (3 toggles) y "DATOS"
 * (Borrar historial) — sitios confiables y privacidad se renderizan en sus
 * propios contenedores/módulos.
 */
export function renderSettingsPanel(
  container: HTMLElement,
  settings: Settings,
  state: SettingsViewState,
  actions: SettingsActions,
): void {
  container.replaceChildren()

  container.appendChild(el('p', 'stats-section-title', 'CONFIGURACIÓN GENERAL'))
  container.appendChild(buildTogglesList(settings, actions.onToggle))

  container.appendChild(el('p', 'stats-section-title', 'DATOS'))
  container.appendChild(buildClearHistorySection(state, actions))
}

function buildTogglesList(
  settings: Settings,
  onToggle: (key: keyof Settings, value: boolean) => void,
): HTMLElement {
  const list = el('div', 'settings-toggle-list')

  for (const definition of TOGGLES) {
    const row = el('label', 'settings-toggle-row')

    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.className = 'settings-toggle-checkbox'
    checkbox.checked = settings[definition.key]
    checkbox.addEventListener('change', () => onToggle(definition.key, checkbox.checked))
    row.appendChild(checkbox)

    const text = el('div', 'settings-toggle-text')
    text.appendChild(el('p', 'settings-toggle-label', definition.label))
    text.appendChild(el('p', 'settings-toggle-desc', definition.description))
    row.appendChild(text)

    list.appendChild(row)
  }

  return list
}

function buildClearHistorySection(state: SettingsViewState, actions: SettingsActions): HTMLElement {
  const section = el('div', 'clear-all-section')

  if (!state.confirmingClearHistory) {
    const button = el('button', 'hist-btn hist-btn-ghost', 'Borrar historial')
    button.type = 'button'
    button.addEventListener('click', actions.onRequestClearHistory)
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
  confirmButton.addEventListener('click', actions.onConfirmClearHistory)
  row.appendChild(confirmButton)

  const cancelButton = el('button', 'hist-btn hist-btn-ghost', 'Cancelar')
  cancelButton.type = 'button'
  cancelButton.addEventListener('click', actions.onCancelClearHistory)
  row.appendChild(cancelButton)

  section.appendChild(row)
  return section
}
