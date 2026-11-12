import { decide } from '../../agent/orchestrator'
import { clearHistory, deleteHistoryEntry, getHistory } from '../../history/service'
import type { HistoryFilter } from '../../history/types'
import { getSettings, updateSetting } from '../../settings/service'
import type { Settings } from '../../settings/types'
import { calculateStats } from '../../stats/calculateStats'
import {
  addTrustedSite,
  clearTrustedSites,
  getTrustedSites,
  isTrustedUrl,
  removeTrustedSite,
} from '../../trustedSites/service'
import { renderHistoryPanel } from '../historyView'
import { renderPrivacySection } from '../privacySection'
import { renderDecision, renderUnavailable } from '../render'
import { renderSettingsPanel } from '../settingsView'
import { renderStatsPanel } from '../statsView'
import { clearTrustedBanner, renderTrustedBanner } from '../trustedBanner'
import { renderTrustedSitesPanel, renderTrustedSitesSummary } from '../trustedSitesView'
import { renderWebProtectionSettings } from '../webProtectionSettingsView'
import type { ReconcileSummary } from '../../webProtection/runtime/reconcile'
import {
  readWebProtectionSettings,
  updateWebProtectionSetting,
  WEB_PROTECTION_STATUS_KEY,
  type KeyValueStorage,
} from '../../webProtection/settings'

type PopupTab = 'analysis' | 'history' | 'stats' | 'config'

let historyFilter: HistoryFilter = 'all'
let confirmingClearAll = false
let confirmingClearAllTrusted = false
let trustedAddError: string | undefined
let confirmingClearHistoryFromSettings = false
let trustedSitesExpanded = false

const localStorageArea: KeyValueStorage = {
  get: (key) => chrome.storage.local.get(key),
  set: (items) => chrome.storage.local.set(items),
}

async function main(): Promise<void> {
  wireTabButtons()
  // El background actualiza el estado de Web Protection al reconciliar:
  // si la pestaña Configuración está visible, se vuelve a dibujar.
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'session' || !(WEB_PROTECTION_STATUS_KEY in changes)) return
    if (document.getElementById('config-panel')?.hidden !== false) return
    renderConfigTab().catch((error: unknown) =>
      console.error('[WebProtection] error mostrando el estado', error),
    )
  })
  await renderAnalysisTab()
}

async function renderWebProtectionSection(container: HTMLElement): Promise<void> {
  const [settings, stored] = await Promise.all([
    readWebProtectionSettings(localStorageArea),
    chrome.storage.session.get(WEB_PROTECTION_STATUS_KEY),
  ])
  const status = (stored[WEB_PROTECTION_STATUS_KEY] as ReconcileSummary | undefined) ?? null
  renderWebProtectionSettings(container, settings, status, (key, value) => {
    // Solo se guarda la preferencia; el background reconcilia los rulesets
    // al detectar el cambio en storage.
    updateWebProtectionSetting(localStorageArea, key, value)
      .then(() => renderConfigTab())
      .catch((error: unknown) =>
        console.error('[WebProtection] error actualizando configuración', error),
      )
  })
}

const TAB_ORDER: PopupTab[] = ['analysis', 'history', 'stats', 'config']

/**
 * Pestañas accesibles (patrón "tabs" de WAI-ARIA): clic o flechas
 * izquierda/derecha, Inicio y Fin. Solo la pestaña activa entra en el
 * orden de tabulación; el foco va del botón al panel con Tab.
 */
function wireTabButtons(): void {
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('.tab-button')]
  for (const button of buttons) {
    button.addEventListener('click', () => showTab(button.dataset.tab as PopupTab))
    button.addEventListener('keydown', (event) => {
      const current = TAB_ORDER.indexOf(button.dataset.tab as PopupTab)
      let next: number | undefined
      if (event.key === 'ArrowRight') next = (current + 1) % TAB_ORDER.length
      if (event.key === 'ArrowLeft') next = (current - 1 + TAB_ORDER.length) % TAB_ORDER.length
      if (event.key === 'Home') next = 0
      if (event.key === 'End') next = TAB_ORDER.length - 1
      if (next === undefined) return
      event.preventDefault()
      showTab(TAB_ORDER[next]!)
      document
        .querySelector<HTMLButtonElement>(`.tab-button[data-tab="${TAB_ORDER[next]}"]`)
        ?.focus()
    })
  }
}

function showTab(tab: PopupTab): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>('.tab-button')) {
    const active = button.dataset.tab === tab
    button.classList.toggle('tab-button-active', active)
    button.setAttribute('aria-selected', String(active))
    button.tabIndex = active ? 0 : -1
  }

  const analysisPanel = document.getElementById('analysis-panel')
  const historyPanel = document.getElementById('history-panel')
  const statsPanel = document.getElementById('stats-panel')
  const configPanel = document.getElementById('config-panel')
  if (!analysisPanel || !historyPanel || !statsPanel || !configPanel) return

  analysisPanel.hidden = tab !== 'analysis'
  if (tab === 'analysis') {
    // Se vuelve a dibujar por si se cambió el modo avanzado en Ajustes.
    renderAnalysisTab().catch((error: unknown) =>
      console.error('[PhishGuard] error mostrando el análisis', error),
    )
  }
  historyPanel.hidden = tab !== 'history'
  statsPanel.hidden = tab !== 'stats'
  configPanel.hidden = tab !== 'config'

  if (tab === 'history') {
    renderHistoryTab().catch((error: unknown) =>
      console.error('[PhishGuard] error mostrando el historial', error),
    )
  }
  if (tab === 'stats') {
    renderStatsTab().catch((error: unknown) =>
      console.error('[PhishGuard] error mostrando las estadísticas', error),
    )
  }
  if (tab === 'config') {
    renderConfigTab().catch((error: unknown) =>
      console.error('[PhishGuard] error mostrando la configuración', error),
    )
  }
}

async function renderAnalysisTab(): Promise<void> {
  const bannerContainer = document.getElementById('analysis-trust-banner')
  const container = document.getElementById('analysis-content')
  if (!bannerContainer || !container) return

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })
  const url = activeTab?.url

  if (!url || !url.startsWith('http')) {
    clearTrustedBanner(bannerContainer)
    renderUnavailable(container, 'PhishGuard no analiza esta página (no es un sitio web).')
    return
  }

  // El score del modelo (si se puede calcular) se muestra igual que
  // siempre en #analysis-content — separado del banner de confianza, que
  // refleja una decisión del usuario, no un resultado del modelo.
  if (await isTrustedUrl(url)) {
    const hostname = new URL(url).hostname
    renderTrustedBanner(bannerContainer, hostname, {
      onUntrust: () => {
        removeTrustedSite(hostname)
          .then(() => renderAnalysisTab())
          .catch((error: unknown) =>
            console.error('[PhishGuard] error quitando el sitio confiable', error),
          )
      },
    })
  } else {
    clearTrustedBanner(bannerContainer)
  }

  let decision
  try {
    decision = decide(url)
  } catch {
    renderUnavailable(container, 'No se pudo analizar la dirección de esta pestaña.')
    return
  }

  const settings = await getSettings().catch(() => undefined)
  renderDecision(container, decision, { advanced: settings?.advancedModeEnabled ?? false })
}

async function renderHistoryTab(): Promise<void> {
  const container = document.getElementById('history-panel')
  if (!container) return

  const entries = await getHistory()

  renderHistoryPanel(
    container,
    entries,
    { filter: historyFilter, confirmingClearAll },
    {
      onFilterChange: (filter) => {
        historyFilter = filter
        renderHistoryTab().catch((error: unknown) =>
          console.error('[PhishGuard] error filtrando el historial', error),
        )
      },
      onDeleteEntry: (id) => {
        deleteHistoryEntry(id)
          .then(() => renderHistoryTab())
          .catch((error: unknown) =>
            console.error('[PhishGuard] error eliminando del historial', error),
          )
      },
      onRequestClearAll: () => {
        confirmingClearAll = true
        renderHistoryTab().catch((error: unknown) =>
          console.error('[PhishGuard] error mostrando la confirmación', error),
        )
      },
      onConfirmClearAll: () => {
        confirmingClearAll = false
        clearHistory()
          .then(() => renderHistoryTab())
          .catch((error: unknown) =>
            console.error('[PhishGuard] error borrando el historial', error),
          )
      },
      onCancelClearAll: () => {
        confirmingClearAll = false
        renderHistoryTab().catch((error: unknown) =>
          console.error('[PhishGuard] error cancelando', error),
        )
      },
    },
  )
}

async function renderStatsTab(): Promise<void> {
  const container = document.getElementById('stats-content')
  if (!container) return

  const entries = await getHistory()
  renderStatsPanel(container, calculateStats(entries))
}

async function renderConfigTab(): Promise<void> {
  const settingsContainer = document.getElementById('config-settings')
  const trustedSummaryContainer = document.getElementById('config-trusted-summary')
  const trustedDetailsContainer = document.getElementById('config-trusted-details')
  const privacyContainer = document.getElementById('config-privacy')
  const webProtectionContainer = document.getElementById('config-web-protection')
  if (
    !settingsContainer ||
    !webProtectionContainer ||
    !trustedSummaryContainer ||
    !trustedDetailsContainer ||
    !privacyContainer
  ) {
    return
  }

  const [settings, sites] = await Promise.all([getSettings(), getTrustedSites()])

  renderSettingsPanel(
    settingsContainer,
    settings,
    { confirmingClearHistory: confirmingClearHistoryFromSettings },
    {
      onToggle: (key: keyof Settings, value) => {
        updateSetting(key, value)
          .then(() => renderConfigTab())
          .catch((error: unknown) =>
            console.error('[PhishGuard] error actualizando configuración', error),
          )
      },
      onRequestClearHistory: () => {
        confirmingClearHistoryFromSettings = true
        renderConfigTab().catch((error: unknown) =>
          console.error('[PhishGuard] error mostrando la confirmación', error),
        )
      },
      onConfirmClearHistory: () => {
        confirmingClearHistoryFromSettings = false
        clearHistory()
          .then(() => renderConfigTab())
          .catch((error: unknown) =>
            console.error('[PhishGuard] error borrando el historial', error),
          )
      },
      onCancelClearHistory: () => {
        confirmingClearHistoryFromSettings = false
        renderConfigTab().catch((error: unknown) =>
          console.error('[PhishGuard] error cancelando', error),
        )
      },
    },
  )

  await renderWebProtectionSection(webProtectionContainer)

  renderTrustedSitesSummary(
    trustedSummaryContainer,
    sites.length,
    { expanded: trustedSitesExpanded },
    {
      onToggleExpanded: () => {
        trustedSitesExpanded = !trustedSitesExpanded
        renderConfigTab().catch((error: unknown) =>
          console.error('[PhishGuard] error mostrando sitios confiables', error),
        )
      },
    },
  )

  if (trustedSitesExpanded) {
    renderTrustedSitesPanel(
      trustedDetailsContainer,
      sites,
      { confirmingClearAll: confirmingClearAllTrusted, addError: trustedAddError },
      {
        onAddDomain: (value) => {
          addTrustedSite(value)
            .then(() => {
              trustedAddError = undefined
              return renderConfigTab()
            })
            .catch((error: unknown) => {
              trustedAddError =
                error instanceof Error ? error.message : 'No se pudo agregar ese dominio.'
              return renderConfigTab()
            })
            .catch((error: unknown) =>
              console.error('[PhishGuard] error agregando sitio confiable', error),
            )
        },
        onDeleteHostname: (hostname) => {
          removeTrustedSite(hostname)
            .then(() => renderConfigTab())
            .catch((error: unknown) =>
              console.error('[PhishGuard] error eliminando sitio confiable', error),
            )
        },
        onRequestClearAll: () => {
          confirmingClearAllTrusted = true
          renderConfigTab().catch((error: unknown) =>
            console.error('[PhishGuard] error mostrando la confirmación', error),
          )
        },
        onConfirmClearAll: () => {
          confirmingClearAllTrusted = false
          clearTrustedSites()
            .then(() => renderConfigTab())
            .catch((error: unknown) =>
              console.error('[PhishGuard] error borrando sitios confiables', error),
            )
        },
        onCancelClearAll: () => {
          confirmingClearAllTrusted = false
          renderConfigTab().catch((error: unknown) =>
            console.error('[PhishGuard] error cancelando', error),
          )
        },
      },
    )
  } else {
    trustedDetailsContainer.replaceChildren()
  }

  renderPrivacySection(privacyContainer)
}

main()
