import type { Decision } from '../agent/types'

/**
 * Traspasa a la página de advertencia todo lo que necesita, vía
 * `chrome.storage.session` (nunca por query string): el `Decision` que
 * calculó `background`, y `safeReturnUrl` — la URL que la pestaña tenía
 * abierta justo ANTES de la navegación bloqueada.
 *
 * Se indexa por un `warningId` aleatorio (no por `tabId`). `background`
 * genera el id, lo guarda, y lo agrega como `?id=<warningId>` a la URL de
 * `warning.html` — la página lo lee directo de su propia URL con
 * `URLSearchParams`, sin tener que re-derivar nada vía
 * `chrome.tabs.getCurrent()` ni volver a calzar un `tabId`. Un id por cada
 * redirección, generado en el momento, garantiza además que dos pestañas
 * HIGH simultáneas nunca compartan ni se pisen la clave de storage.
 */
export interface WarningContext {
  decision: Decision
  safeReturnUrl: string | undefined
}

const CONTEXT_KEY_PREFIX = 'phishguard:warning:'

function keyForWarningId(warningId: string): string {
  return `${CONTEXT_KEY_PREFIX}${warningId}`
}

export async function storeWarningContext(
  warningId: string,
  context: WarningContext,
): Promise<void> {
  await chrome.storage.session.set({ [keyForWarningId(warningId)]: context })
}

export async function getWarningContext(warningId: string): Promise<WarningContext | undefined> {
  const key = keyForWarningId(warningId)
  const stored = await chrome.storage.session.get(key)
  return stored[key] as WarningContext | undefined
}

/** Se llama cuando el usuario ya actuó (volvió o continuó) — el contexto deja de servir para algo. */
export async function deleteWarningContext(warningId: string): Promise<void> {
  await chrome.storage.session.remove(keyForWarningId(warningId))
}
