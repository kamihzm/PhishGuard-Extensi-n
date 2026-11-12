import cosmeticIndexUrl from '../generated/cosmeticIndex.json?url'
import rulesetIndex from '../generated/rulesetIndex.json'
import type { RulesetIndex } from '../quota/types'
import {
  readWebProtectionSettings,
  WEB_PROTECTION_SETTINGS_KEY,
  WEB_PROTECTION_STATUS_KEY,
} from '../settings'
import { isCosmeticRequest } from '../page/protocol'
import { answerCosmeticRequest, createIndexLoader } from './cosmeticService'
import { registerPopupGuard, type PopupGuardHandle } from './registerPopupGuard'
import { createReconciler, type LogLevel, type ReconcileSummary } from './reconcile'

const INDEX = rulesetIndex as RulesetIndex

function log(level: LogLevel, message: string): void {
  if (level === 'error') console.error(message)
  else if (level === 'warn') console.warn(message)
  else console.log(message)
}

/**
 * Conecta Web Protection al service worker. Es independiente del motor de
 * phishing: no escucha navegaciones, no lee ni modifica ninguna decisión
 * de phishing y solo habilita o deshabilita los rulesets estáticos
 * declarados en el manifest (todos con `enabled: false` por defecto).
 *
 * Reconcilia en tres momentos:
 * - `onInstalled` (instalación y actualización: Chrome restablece los
 *   rulesets a su estado del manifest);
 * - `onStartup` (inicio del navegador);
 * - `storage.onChanged` de la clave propia de Web Protection (cambio de
 *   toggles desde el popup).
 *
 * Registra también el Popup Guard (`registerPopupGuard.ts`): ventanas y
 * redirecciones publicitarias, inerte con "Anuncios" desactivado.
 *
 * Además atiende las peticiones de selectores cosméticos de la capa de
 * página (`runtime/cosmeticService.ts`); cualquier otro mensaje lo ignora
 * (devuelve `undefined`) para que lo procese el listener de phishing.
 */
const readSettings = () =>
  readWebProtectionSettings({
    get: (key) => chrome.storage.local.get(key),
    set: (items) => chrome.storage.local.set(items),
  })

export function registerWebProtection(): { popupGuard: PopupGuardHandle } {
  const reconciler = createReconciler({
    dnr: {
      getAvailableStaticRuleCount: () => chrome.declarativeNetRequest.getAvailableStaticRuleCount(),
      getEnabledRulesets: () => chrome.declarativeNetRequest.getEnabledRulesets(),
      updateEnabledRulesets: (options) =>
        chrome.declarativeNetRequest.updateEnabledRulesets(options),
    },
    index: INDEX,
    readSettings,
    writeStatus: (summary: ReconcileSummary) =>
      chrome.storage.session.set({ [WEB_PROTECTION_STATUS_KEY]: summary }),
    log,
  })

  const run = (reason: Parameters<typeof reconciler.run>[0]) => {
    reconciler.run(reason).catch((error: unknown) => {
      console.error('[WebProtection] error inesperado reconciliando', error)
    })
  }

  chrome.runtime.onInstalled.addListener(() => run('installed'))
  chrome.runtime.onStartup.addListener(() => run('startup'))
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && WEB_PROTECTION_SETTINGS_KEY in changes) run('settings-changed')
  })

  const loadCosmeticIndex = createIndexLoader(async () => {
    const response = await fetch(chrome.runtime.getURL(cosmeticIndexUrl))
    return response.json()
  })
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Mensajes ajenos (p. ej. los de la página de advertencia de phishing): no se tocan.
    if (!isCosmeticRequest(message)) return undefined
    answerCosmeticRequest(message, sender, {
      extensionId: chrome.runtime.id,
      loadIndex: loadCosmeticIndex,
      readSettings,
    })
      .then((response) => sendResponse(response ?? { ok: false, selectors: [] }))
      .catch(() => sendResponse({ ok: true, selectors: [] }))
    return true // respuesta asíncrona
  })

  return { popupGuard: registerPopupGuard() }
}
