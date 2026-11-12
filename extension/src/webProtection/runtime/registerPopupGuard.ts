import popupIndexUrl from '../generated/popupIndex.json?url'
import {
  INTENT_QUERY_TYPE,
  parseIntentResponse,
  type IntentQuery,
} from '../popups/navigationIntent'
import { isIntentSessionQuery } from '../popups/intentRecord'
import type { WindowBounds } from '../popups/popupClassifier'
import { createAdEvidence, type PopupIndex } from '../popups/popupIndex'
import { createPopupGuard } from '../popups/popupGuard'
import type { PopupWindowGeometry } from '../popups/popupState'
import type { AdEvidence } from '../popups/types'
import { createWindowBirths } from '../popups/windowBirth'
import {
  mergeWebProtectionExperiments,
  mergeWebProtectionSettings,
  readWebProtectionSettings,
  WEB_PROTECTION_EXPERIMENTS_KEY,
  WEB_PROTECTION_SETTINGS_KEY,
} from '../settings'
import {
  forgetIntentTab,
  getIntentToken,
  issueIntentToken,
  sweepIntentRecords,
  takeIntentRecord,
} from './intentStore'

/** Tiempo máximo para que el content script responda la intención; si no, se trata como desconocida. */
const INTENT_QUERY_TIMEOUT_MS = 400

const boundsOf = (w: chrome.windows.Window): WindowBounds | null =>
  typeof w.left === 'number' &&
  typeof w.top === 'number' &&
  typeof w.width === 'number' &&
  typeof w.height === 'number'
    ? { left: w.left, top: w.top, width: w.width, height: w.height }
    : null

/**
 * Conecta el Popup Guard al service worker. APIs usadas (todas sin
 * bloquear peticiones):
 * - `webNavigation.onCreatedNavigationTarget`: una página abre pestaña/ventana;
 * - `webNavigation.onBeforeNavigate` / `onCommitted`: cadena de la ventana
 *   nueva y navegaciones de la pestaña original;
 * - `webRequest.onBeforeRequest` (solo `main_frame`, observación): saltos de
 *   redirección de SERVIDOR que `webNavigation` no reporta;
 * - `tabs.sendMessage` (consulta de intención), `tabs.remove`, `tabs.goBack`,
 *   `tabs.get`, `tabs.onRemoved`;
 * - `windows.onCreated` / `onRemoved`: posición de las ventanas popup al nacer (T8);
 * - `tabs.onCreated` + `windows.get`: pestañas con opener en una ventana
 *   `type: popup` (T6, popunders sin `onCreatedNavigationTarget`); cualquier
 *   pestaña con opener SOLO con el experimento `popupGuardTabCreated` activo
 *   (desactivado por defecto, ver `settings.ts`).
 * Todo queda inerte con "Anuncios" desactivado.
 */
/** Lo que el service worker expone al coordinador de acciones (solo `hold`). */
export interface PopupGuardHandle {
  hold(tabId: number): Promise<'handled-by-web-protection' | 'release'> | null
}

export function registerPopupGuard(): PopupGuardHandle {
  let enabled: Promise<boolean> | null = null
  const isEnabled = () =>
    (enabled ??= readWebProtectionSettings({
      get: (key) => chrome.storage.local.get(key),
      set: (items) => chrome.storage.local.set(items),
    })
      .then((s) => s.adsEnabled)
      .catch(() => false))
  let tabCreatedExperiment: Promise<boolean> | null = null
  const isTabCreatedExperimentOn = () =>
    (tabCreatedExperiment ??= chrome.storage.local
      .get(WEB_PROTECTION_EXPERIMENTS_KEY)
      .then(
        (stored) =>
          mergeWebProtectionExperiments(stored[WEB_PROTECTION_EXPERIMENTS_KEY])
            .popupGuardTabCreated,
      )
      .catch(() => false))
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && WEB_PROTECTION_SETTINGS_KEY in changes) {
      enabled = Promise.resolve(
        mergeWebProtectionSettings(changes[WEB_PROTECTION_SETTINGS_KEY]?.newValue).adsEnabled,
      )
    }
    if (area === 'local' && WEB_PROTECTION_EXPERIMENTS_KEY in changes) {
      tabCreatedExperiment = Promise.resolve(
        mergeWebProtectionExperiments(changes[WEB_PROTECTION_EXPERIMENTS_KEY]?.newValue)
          .popupGuardTabCreated,
      )
    }
  })

  let evidence: Promise<AdEvidence> | null = null
  const loadEvidence = () =>
    (evidence ??= fetch(chrome.runtime.getURL(popupIndexUrl))
      .then((r) => r.json() as Promise<PopupIndex>)
      .then((index) => createAdEvidence(index))
      .catch(() => {
        evidence = null
        // Sin índice no hay evidencia: nunca se confirma nada (fail-open).
        return { isAdUrl: () => false, isException: () => false }
      }))

  /**
   * Posición de cada ventana `type: popup` al nacer (T8, `windows.onCreated`),
   * antes de que el script del popunder la agrande o la mueva; la lectura con
   * `windows.get` queda de respaldo (`popups/windowBirth.ts`).
   */
  const births = createWindowBirths({
    getWindow: (windowId) =>
      chrome.windows.get(windowId).then((w) => ({ type: w.type, bounds: boundsOf(w) })),
    getOpenerBounds: (openerTabId) =>
      Promise.resolve()
        .then(() => chrome.tabs.get(openerTabId))
        .then((t) => chrome.windows.get(t.windowId))
        .then(boundsOf),
    now: () => Date.now(),
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  })
  // Registrados antes que `tabs.onCreated`: guardan los límites del evento sin
  // esperar a leer la configuración (solo números, en memoria).
  chrome.windows.onCreated.addListener((w) => {
    if (w.id !== undefined) births.onWindowCreated(w.id, w.type, boundsOf(w))
  })
  chrome.windows.onRemoved.addListener((windowId) => births.onWindowRemoved(windowId))

  /**
   * Ventana `type: popup` de la pestaña y el tamaño de su área de contenido al
   * crearse (T6), antes de que la página pueda agrandarla. Se usa el de la
   * pestaña (`tab.width/height`) y no el de la ventana: el de la ventana suma
   * barra de título y de dirección, que cambian con el sistema (medido: 5×5
   * pedidos → ventana 146×182, contenido 131×110). `null` si es otra clase de
   * ventana o no se pudo leer (fail-open: no se observa). Además se mide si
   * nació pegada al borde de la ventana que la abrió (`atEdge`) y, para el
   * veto de un clic en un control (T7), si fue en su borde derecho o inferior
   * (`atFarEdge`), con la posición del nacimiento (T8).
   */
  const popupWindowOf = (
    tab: chrome.tabs.Tab,
    openerTabId: number,
    tabCreatedAt: number,
  ): Promise<PopupWindowGeometry | null> => {
    const { windowId, width, height } = tab
    if (windowId === undefined || typeof width !== 'number' || typeof height !== 'number') {
      return Promise.resolve(null)
    }
    return births.measure({ windowId, width, height }, openerTabId, tabCreatedAt).catch(() => null)
  }

  const queryIntents = (tabId: number) => {
    const query: IntentQuery = { type: INTENT_QUERY_TYPE, v: 1 }
    const reply = chrome.tabs.sendMessage(tabId, query, { frameId: 0 }).then(parseIntentResponse)
    const timeout = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), INTENT_QUERY_TIMEOUT_MS),
    )
    return Promise.race([reply, timeout]).catch(() => null)
  }

  const guard = createPopupGuard({
    isEnabled,
    queryIntents,
    getTabUrl: (tabId) =>
      chrome.tabs
        .get(tabId)
        .then((t) => t.url ?? null)
        .catch(() => null),
    getTab: (tabId) =>
      chrome.tabs
        .get(tabId)
        .then((t) => ({ url: t.url, pendingUrl: t.pendingUrl }))
        .catch(() => null),
    getFrameUrl: (tabId, frameId) =>
      chrome.webNavigation
        .getFrame({ tabId, frameId })
        .then((frame) => frame?.url ?? null)
        .catch(() => null),
    getTabSize: (tabId) =>
      chrome.tabs
        .get(tabId)
        .then((t) =>
          typeof t.width === 'number' && typeof t.height === 'number'
            ? { width: t.width, height: t.height }
            : null,
        )
        .catch(() => null),
    takeIntentRecord,
    getIntentToken,
    loadEvidence,
    closeTab: (tabId) => chrome.tabs.remove(tabId),
    goBack: (tabId) => chrome.tabs.goBack(tabId),
    now: () => Date.now(),
    schedule: (fn, ms) => {
      const id = setTimeout(fn, ms)
      return () => clearTimeout(id)
    },
    log: (message) => console.log(message),
  })

  const swallow = (p: Promise<unknown>) =>
    p.catch((error: unknown) => console.error('[WebProtection] error en el Popup Guard', error))

  chrome.webNavigation.onCreatedNavigationTarget.addListener((d) => {
    swallow(guard.onCreatedNavigationTarget(d))
  })
  // Ventanas sin `onCreatedNavigationTarget` (popunder desde un iframe oculto):
  // solo las de una ventana `type: popup` (T6) o, con el experimento
  // (desactivado por defecto), cualquier pestaña con opener.
  chrome.tabs.onCreated.addListener((tab) => {
    const tabId = tab.id
    const openerTabId = tab.openerTabId
    if (tabId === undefined || openerTabId === undefined) return
    const timeStamp = Date.now()
    swallow(
      isEnabled().then(async (on) => {
        if (!on) return
        const [experiment, window] = await Promise.all([
          isTabCreatedExperimentOn(),
          popupWindowOf(tab, openerTabId, timeStamp),
        ])
        if (!experiment && !window) return
        await guard.onTabCreated({
          tabId,
          openerTabId,
          url: tab.pendingUrl ?? tab.url ?? '',
          timeStamp,
          origin: experiment ? 'tab-created' : 'popup-window',
          ...(window ? { window } : {}),
        })
      }),
    )
  })
  chrome.webNavigation.onBeforeNavigate.addListener((d) => {
    swallow(guard.onBeforeNavigate(d.tabId, d.frameId, d.url, d.timeStamp))
  })
  chrome.webNavigation.onCommitted.addListener((d) => {
    swallow(guard.onCommitted(d.tabId, d.frameId, d.url, d.transitionType, d.transitionQualifiers))
  })
  chrome.webRequest.onBeforeRequest.addListener(
    (d) => {
      if (d.tabId >= 0) guard.onMainFrameRequest(d.tabId, d.url)
      return undefined
    },
    { urls: ['http://*/*', 'https://*/*'], types: ['main_frame'] },
  )
  // Solo observación: destino de cada redirección 3xx (procedencia del salto).
  chrome.webRequest.onBeforeRedirect.addListener(
    (d) => {
      if (d.tabId >= 0) guard.onServerRedirect(d.tabId, d.redirectUrl, d.statusCode)
    },
    { urls: ['http://*/*', 'https://*/*'], types: ['main_frame'] },
  )
  chrome.tabs.onRemoved.addListener((tabId) => {
    guard.onTabRemoved(tabId)
    swallow(forgetIntentTab(tabId))
  })

  // Registro de intención para el arranque en frío (`popups/intentRecord.ts`):
  // el content script del marco principal pide el token de SU pestaña. Solo
  // con "Anuncios" activo; si no, no escribe nada.
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isIntentSessionQuery(message) || sender.id !== chrome.runtime.id) return undefined
    const tabId = sender.tab?.id
    if (tabId === undefined || tabId < 0 || sender.frameId !== 0) return undefined
    isEnabled()
      .then((on) => (on ? issueIntentToken(tabId) : null))
      .then((token) => sendResponse(token ? { v: 1, tabId, token } : null))
      .catch(() => sendResponse(null))
    return true
  })
  swallow(sweepIntentRecords(Date.now()))

  return { hold: (tabId) => guard.hold(tabId) }
}
