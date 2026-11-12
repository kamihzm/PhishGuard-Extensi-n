import { decide } from '../agent/orchestrator'
import { recordAnalysis } from '../history/service'
import { DEFAULT_SETTINGS } from '../settings/defaults'
import { getSettings } from '../settings/service'
import type { Settings } from '../settings/types'
import { storeWarningContext } from '../shared/warningContextStore'
import { isTrustedUrl } from '../trustedSites/service'
import { clearBadge, forgetBadge, updateBadge } from './badge'
import { forgetMediumNotice, notifyNoticeChanged, rememberMediumNotice } from './mediumNotice'
import { hasTemporaryAuthorization } from './navigationAuthorization'
import { executeUnlessHandled } from './navigationCoordinator'

export const WARNING_PAGE_PATH = 'src/ui/warning/warning.html'

/** Subconjunto de `chrome.webNavigation.WebNavigationTransitionCallbackDetails` que de verdad se usa — facilita probar sin construir un evento falso completo. */
export interface NavigationDetails {
  url: string
  tabId: number
  frameId: number
}

/**
 * Se llama en cada navegación (`chrome.webNavigation.onBeforeNavigate`).
 * Reutiliza `decide()`, la misma función que ya usa el popup — no hay
 * segunda implementación del motor acá. Solo bloquea si `riskLevel === 'high'`;
 * LOW y MEDIUM navegan normal. MEDIUM además deja preparado el aviso dentro
 * de la página (`mediumNotice.ts`), que el content script pide al cargar.
 */
export async function handleNavigation(details: NavigationDetails): Promise<void> {
  if (details.frameId !== 0) return // solo el frame principal, no iframes embebidos
  if (!details.url.startsWith('http')) return // ignora chrome://, about:blank, chrome-extension://, etc.

  // La autorización de "Continuar de todas formas" se lee ANTES que todo lo
  // demás: con páginas que cargan casi al instante, `onCompleted` la limpia
  // (background/index.ts) y, si esta lectura llega tarde, la navegación que
  // el usuario autorizó se vuelve a bloquear. Solo se lee; se usa más abajo.
  const authorized = await hasTemporaryAuthorization(details.tabId, details.url)

  // Cada navegación principal descarta el aviso de nivel medio de la página
  // anterior; solo se vuelve a guardar si ESTA dirección resulta "medio".
  await forgetMediumNotice(details.tabId).catch((error: unknown) =>
    console.error('[PhishGuard] error limpiando el aviso de nivel medio', error),
  )

  // Un fallo leyendo la configuración nunca debe tumbar la evaluación —
  // se usan los defaults (protección activada) en ese caso.
  let settings: Settings
  try {
    settings = await getSettings()
  } catch (error) {
    console.error('[PhishGuard] error leyendo configuración, usando defaults', error)
    settings = DEFAULT_SETTINGS
  }

  // Protección desactivada por el usuario: no se analiza ni se bloquea
  // automáticamente nada. El análisis manual desde el popup sigue
  // funcionando porque el popup llama a `decide()` directamente, sin pasar
  // por esta función. No se toca historial/estadísticas/sitios confiables.
  if (!settings.phishingProtectionEnabled) {
    await clearBadge(details.tabId).catch((error: unknown) =>
      console.error('[PhishGuard] error limpiando el badge', error),
    )
    return
  }

  if (authorized) {
    console.log('[CONTINUE] navegación permitida')
    // El usuario decidió continuar, pero el sitio sigue siendo de riesgo: la
    // insignia muestra su nivel real ("!!" en alto). Solo la insignia: no se
    // registra en el historial ni se vuelve a mostrar la advertencia.
    let level
    try {
      level = decide(details.url).riskLevel
    } catch {
      return
    }
    await updateBadge(details.tabId, level, settings.showBadgeEnabled).catch((error: unknown) =>
      console.error('[PhishGuard] error actualizando el badge', error),
    )
    return
  }

  // La insignia guardada es de la página anterior: hasta que llegue la
  // decisión de esta dirección, `reapplyBadge` (onCommitted) no la repone.
  await forgetBadge(details.tabId)

  // Sitio confiable: decisión PERMANENTE del usuario, no del modelo. Se
  // consulta ANTES de llamar a decide() a propósito — el modelo ni
  // siquiera se ejecuta para esta navegación, así que no hay forma de que
  // el resultado se confunda con "el modelo dijo bajo riesgo". No se
  // registra en el historial (eso requeriría datos de `decide()` que acá
  // nunca se calculan). Un fallo leyendo la allowlist nunca debe impedir
  // evaluar la URL — se trata como "no confiable" y sigue el flujo normal.
  let trusted = false
  try {
    trusted = await isTrustedUrl(details.url)
  } catch (error) {
    console.error('[PhishGuard] error consultando sitios confiables', error)
  }
  if (trusted) {
    console.log(`[TRUSTED] ${details.url} → permitido por el usuario, no se evalúa`)
    await clearBadge(details.tabId).catch((error: unknown) =>
      console.error('[PhishGuard] error limpiando el badge', error),
    )
    return
  }

  let decision
  try {
    decision = decide(details.url)
  } catch {
    return // URL no parseable; no debe tumbar el service worker
  }

  console.log(
    `[PhishGuard] ${details.url} → riskLevel=${decision.riskLevel} finalScore=${decision.finalScore}`,
  )

  // Se registra CUALQUIER análisis real (LOW/MEDIUM/HIGH) — nunca una
  // navegación autorizada por "continuar" (ya se filtró arriba, antes de
  // llegar acá) ni chrome://, warning.html, etc. (ya se filtró al principio
  // de la función). Un fallo al guardar el historial nunca debe impedir
  // mostrar la advertencia de una URL HIGH real. Si `saveHistoryEnabled`
  // está desactivado, simplemente no se llama a `recordAnalysis` — el
  // resto del flujo (badge, warning) no depende de esta preferencia.
  if (settings.saveHistoryEnabled) {
    try {
      await recordAnalysis({
        url: details.url,
        finalScore: decision.finalScore,
        ruleScore: decision.ruleScore,
        mlProbability: decision.mlProbability,
        riskLevel: decision.riskLevel,
        activatedRuleIds: decision.activatedRules.map((hit) => hit.id),
      })
    } catch (error) {
      console.error('[PhishGuard] error guardando historial', error)
    }
  }

  await updateBadge(details.tabId, decision.riskLevel, settings.showBadgeEnabled).catch(
    (error: unknown) => console.error('[PhishGuard] error actualizando el badge', error),
  )

  if (decision.riskLevel === 'medium') {
    await rememberMediumNotice(details.tabId, decision).catch((error: unknown) =>
      console.error('[PhishGuard] error preparando el aviso de nivel medio', error),
    )
  }

  if (decision.riskLevel !== 'high') return

  // "Advertencias de riesgo alto" desactivado: el análisis, el historial y
  // el badge ya ocurrieron arriba exactamente igual — lo único que cambia
  // es que NO se redirige a warning.html. El popup sigue mostrando HIGH
  // porque llama a `decide()` directamente, ajeno a esta preferencia.
  if (!settings.highRiskWarningEnabled) return

  // La DECISIÓN de phishing ya se tomó arriba (historial y badge incluidos) y
  // no cambia. Solo la EJECUCIÓN pasa por el coordinador: si Web Protection
  // confirma que esta pestaña es un popup publicitario que ya está cerrando,
  // no se abre la advertencia sobre ella; en cualquier otro caso, sí.
  await executeUnlessHandled(details.tabId, async () => {
    const safeReturnUrl = await resolveSafeReturnUrl(details.tabId, details.url)
    const warningId = crypto.randomUUID()
    await storeWarningContext(warningId, { decision, safeReturnUrl })
    await chrome.tabs.update(details.tabId, { url: buildWarningUrl(warningId) })
  })
}

/**
 * Navegación dentro del mismo documento (`history.pushState` /
 * `replaceState`, `chrome.webNavigation.onHistoryStateUpdated`): la página
 * no se recarga, así que el aviso de nivel medio ya montado quedaría con la
 * dirección anterior. Se vuelve a consultar el nivel con el MISMO `decide()`
 * y se actualizan la insignia y el aviso; el content script vuelve a
 * preguntar y retira la píldora si ya no corresponde.
 *
 * A propósito NO redirige a la advertencia ni registra historial: eso sigue
 * reservado a las navegaciones completas (`handleNavigation`), como antes.
 */
export async function handleSameDocumentNavigation(details: NavigationDetails): Promise<void> {
  if (details.frameId !== 0) return
  if (!details.url.startsWith('http')) return

  let settings: Settings
  try {
    settings = await getSettings()
  } catch {
    settings = DEFAULT_SETTINGS
  }

  let decision
  let trusted = false
  if (settings.phishingProtectionEnabled) {
    try {
      trusted = await isTrustedUrl(details.url)
    } catch {
      trusted = false
    }
    if (!trusted) {
      try {
        decision = decide(details.url)
      } catch {
        decision = undefined
      }
    }
  }

  await forgetMediumNotice(details.tabId)
  if (!decision) {
    await clearBadge(details.tabId)
  } else {
    await updateBadge(details.tabId, decision.riskLevel, settings.showBadgeEnabled)
    if (decision.riskLevel === 'medium') {
      await rememberMediumNotice(details.tabId, decision) // avisa al content script
      return
    }
  }
  notifyNoticeChanged(details.tabId)
}

/**
 * La URL original NO viaja acá — solo el `warningId` (un identificador
 * temporal sin significado propio). `warning.ts` lo lee de su propia URL
 * con `URLSearchParams` y recupera el resto desde `chrome.storage.session`.
 */
function buildWarningUrl(warningId: string): string {
  const url = new URL(chrome.runtime.getURL(WARNING_PAGE_PATH))
  url.searchParams.set('id', warningId)
  return url.toString()
}

/**
 * Captura la URL que la pestaña tenía abierta justo antes de esta
 * navegación bloqueada — en `onBeforeNavigate` la navegación nueva todavía
 * no comprometió nada, así que `chrome.tabs.get()` todavía devuelve la
 * página anterior real. Devuelve `undefined` (sin página segura útil) si
 * no hay ninguna, si por alguna razón coincide con la URL bloqueada, o si
 * no es una página http(s) real (pestaña nueva, `about:blank`, otra página
 * de la propia extensión).
 */
async function resolveSafeReturnUrl(
  tabId: number,
  blockedUrl: string,
): Promise<string | undefined> {
  try {
    const tab = await chrome.tabs.get(tabId)
    const currentUrl = tab.url
    if (!currentUrl || !currentUrl.startsWith('http') || currentUrl === blockedUrl) return undefined
    return currentUrl
  } catch {
    return undefined
  }
}
