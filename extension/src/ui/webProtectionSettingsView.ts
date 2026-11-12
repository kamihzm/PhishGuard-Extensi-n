import type { ReconcileSummary } from '../webProtection/runtime/reconcile'
import type { WebProtectionSettings } from '../webProtection/settings'

interface ToggleDefinition {
  key: keyof WebProtectionSettings
  label: string
  description: string
}

const TOGGLES: ToggleDefinition[] = [
  {
    key: 'adsEnabled',
    label: 'Bloqueo de anuncios',
    description: 'Bloquea recursos publicitarios conocidos (lista EasyList).',
  },
  {
    key: 'trackersEnabled',
    label: 'Bloqueo de rastreadores',
    description: 'Bloquea rastreadores conocidos (lista EasyPrivacy).',
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

/** Texto de estado a partir del último resumen del background (sin datos de navegación). */
export function webProtectionStatusText(
  settings: WebProtectionSettings,
  status: ReconcileSummary | null,
): string {
  if (!settings.adsEnabled && !settings.trackersEnabled) return 'Protección web desactivada.'
  if (!status) return 'Aplicando la configuración…'
  if (status.outcome !== 'applied') {
    return 'No se pudo aplicar la protección web; quedó desactivada por seguridad.'
  }
  const rules = status.activeRuleCount.toLocaleString('es')
  if (status.optionalSkippedForQuota > 0) {
    return `Activa en modo básico: ${rules} reglas (el navegador no tiene cuota para las listas completas).`
  }
  return `Activa: ${rules} reglas.`
}

/**
 * Sección "PROTECCIÓN WEB" de Configuración. Puramente presentación: el
 * popup guarda el cambio y el background reconcilia los rulesets. Es
 * independiente de la protección contra phishing (otra clave de storage).
 */
export function renderWebProtectionSettings(
  container: HTMLElement,
  settings: WebProtectionSettings,
  status: ReconcileSummary | null,
  onToggle: (key: keyof WebProtectionSettings, value: boolean) => void,
): void {
  container.replaceChildren()
  container.appendChild(el('p', 'stats-section-title', 'PROTECCIÓN WEB'))

  const list = el('div', 'settings-toggle-list')
  for (const definition of TOGGLES) {
    const row = el('label', 'settings-toggle-row')
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.className = 'settings-toggle-checkbox'
    checkbox.dataset.webProtectionToggle = definition.key
    checkbox.checked = settings[definition.key]
    checkbox.addEventListener('change', () => onToggle(definition.key, checkbox.checked))
    row.appendChild(checkbox)

    const text = el('div', 'settings-toggle-text')
    text.appendChild(el('p', 'settings-toggle-label', definition.label))
    text.appendChild(el('p', 'settings-toggle-desc', definition.description))
    row.appendChild(text)
    list.appendChild(row)
  }
  container.appendChild(list)
  container.appendChild(
    el(
      'p',
      'settings-toggle-desc web-protection-status',
      webProtectionStatusText(settings, status),
    ),
  )
}
