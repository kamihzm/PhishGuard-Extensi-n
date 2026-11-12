import type { RiskLevel } from '../agent/types'

/**
 * Insignia del ícono (dirección B, docs/ui-redesign/README.md): nada en bajo
 * (el ícono solo "habla" cuando hay algo que revisar), "!" en medio y "!!"
 * en alto, con un texto en español al pasar el ratón. Los fondos llevan
 * texto blanco con contraste AA: #b45309 → 5,02:1 y #b91c1c → 6,47:1.
 */
const BADGE_TEXT: Record<RiskLevel, string> = { low: '', medium: '!', high: '!!' }
const BADGE_COLOR: Record<RiskLevel, string> = {
  low: '#15803d',
  medium: '#b45309',
  high: '#b91c1c',
}
const BADGE_TEXT_COLOR = '#ffffff'
export const DEFAULT_TITLE = 'PhishGuard'
const BADGE_TITLE: Record<RiskLevel, string> = {
  low: 'PhishGuard: no encontramos señales de riesgo en este sitio',
  medium: 'PhishGuard: ten cuidado con este sitio. Abre PhishGuard para ver por qué',
  high: 'PhishGuard: este sitio podría robar tus datos',
}

/**
 * Carrera real (evidencia de Chrome, `docs/dom-overlay-scoring.md`):
 * `handleNavigation` (`navigationGate.ts`, disparado por `onBeforeNavigate`)
 * es async — puede seguir en vuelo (esperando `decide()`/historial) cuando
 * "Popup Early Gate" (un listener COMPLETAMENTE separado, ver
 * `docs/architecture.md`) ya cerró la MISMA pestaña con `chrome.tabs.remove()`
 * por su cuenta. Cuando `updateBadge` finalmente se ejecuta, la pestaña ya
 * no existe y `chrome.action.setBadgeText`/`setBadgeBackgroundColor`
 * rechazan con exactamente este mensaje. NO es un bug de lógica de
 * badge/riesgo — es una carrera esperable entre dos listeners
 * independientes que pueden actuar sobre la misma pestaña.
 *
 * Se descarta ÚNICAMENTE este error, por su mensaje exacto — cualquier otro
 * fallo (permisos, `tabId` inválido por otra razón, etc.) se sigue
 * propagando tal cual, para no esconder errores reales (Fase 1 del pedido).
 */
function isNoSuchTabError(error: unknown): boolean {
  return error instanceof Error && /No tab with id/i.test(error.message)
}

async function safeBadgeCall(call: () => Promise<void>): Promise<void> {
  try {
    await call()
  } catch (error) {
    if (isNoSuchTabError(error)) return // la pestaña se cerró (ej. Popup Early Gate) entre que se decidió actualizar el badge y que la llamada se ejecutó — nada que hacer.
    throw error
  }
}

/**
 * Última insignia de cada pestaña (`null` = limpia), en `chrome.storage.session`
 * porque el service worker puede dormirse entre una navegación y la siguiente.
 *
 * Por qué hace falta (prueba con sitios reales, 2026-10-06): la insignia se
 * escribe en `onBeforeNavigate`, ANTES de que la navegación se confirme, y
 * Chrome borra los valores de la insignia propios de la pestaña cuando la
 * navegación se confirma. Si la confirmación cae en medio de las cuatro
 * llamadas, o después, la insignia se pierde (entera o solo el texto).
 * `reapplyBadge` la vuelve a poner en `onCommitted` y `onCompleted`.
 */
type BadgeState = RiskLevel | null

export function badgeStateKey(tabId: number): string {
  return `phishguard:badge:${tabId}`
}

/** Un fallo de almacenamiento nunca debe impedir poner la insignia. */
async function rememberBadge(tabId: number, state: BadgeState): Promise<void> {
  try {
    await chrome.storage?.session?.set({ [badgeStateKey(tabId)]: state })
  } catch (error) {
    console.error('[PhishGuard] error guardando el estado de la insignia', error)
  }
}

/**
 * Olvida la insignia guardada de la pestaña. Se llama al empezar cada
 * navegación completa, para que una confirmación que llegue antes de la
 * decisión nueva no vuelva a poner el nivel de la página anterior.
 */
export async function forgetBadge(tabId: number): Promise<void> {
  try {
    await chrome.storage?.session?.remove(badgeStateKey(tabId))
  } catch (error) {
    console.error('[PhishGuard] error olvidando el estado de la insignia', error)
  }
}

async function applyBadge(tabId: number, state: BadgeState): Promise<void> {
  if (state === null) {
    await safeBadgeCall(() => chrome.action.setBadgeText({ tabId, text: '' }))
    await safeBadgeCall(() => chrome.action.setTitle({ tabId, title: DEFAULT_TITLE }))
    return
  }
  await safeBadgeCall(() => chrome.action.setBadgeText({ tabId, text: BADGE_TEXT[state] }))
  await safeBadgeCall(() => chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLOR[state] }))
  await safeBadgeCall(() => chrome.action.setBadgeTextColor({ tabId, color: BADGE_TEXT_COLOR }))
  await safeBadgeCall(() => chrome.action.setTitle({ tabId, title: BADGE_TITLE[state] }))
}

/**
 * Versión básica a propósito (texto, color y título por `riskLevel`, sin
 * lógica de expiración ni de multi-pestaña) — `showBadgeEnabled` se recibe
 * ya resuelto (no se lee `chrome.storage` acá) para no duplicar la lectura
 * de configuración que `navigationGate.ts` ya hizo para esta navegación.
 * El estado se guarda ANTES de tocar la insignia, para que `reapplyBadge`
 * lo encuentre aunque la navegación se confirme en medio de las llamadas.
 */
export async function updateBadge(
  tabId: number,
  riskLevel: RiskLevel,
  showBadgeEnabled: boolean,
): Promise<void> {
  if (!showBadgeEnabled) {
    await clearBadge(tabId)
    return
  }
  await rememberBadge(tabId, riskLevel)
  await applyBadge(tabId, riskLevel)
}

export async function clearBadge(tabId: number): Promise<void> {
  await rememberBadge(tabId, null)
  await applyBadge(tabId, null)
}

/**
 * Vuelve a poner la última insignia de la pestaña (texto, color, color de
 * texto y título) después de que Chrome la borre al confirmar la navegación.
 * Solo páginas http(s): la advertencia pone su propia insignia al cargar, y
 * en chrome:// o about:blank no hay nada que mostrar. Sin estado guardado
 * (la decisión de esta navegación todavía no llegó) no hace nada: la
 * decisión la pondrá al terminar.
 */
export async function reapplyBadge(tabId: number, url: string): Promise<void> {
  if (!url.startsWith('http')) return
  let stored: Record<string, unknown>
  try {
    stored = (await chrome.storage?.session?.get(badgeStateKey(tabId))) ?? {}
  } catch (error) {
    console.error('[PhishGuard] error leyendo el estado de la insignia', error)
    return
  }
  const state = stored[badgeStateKey(tabId)]
  if (state === undefined) return
  if (state !== null && !(state === 'low' || state === 'medium' || state === 'high')) return
  await applyBadge(tabId, state)
}
