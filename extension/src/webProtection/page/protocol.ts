/**
 * Protocolo de la capa de página de Web Protection. Todo mensaje que cruza
 * un límite (content script ↔ background, mundo aislado ↔ mundo MAIN) se
 * valida aquí campo por campo: tipo, versión, acción y datos esperados.
 * Cualquier otro campo o forma se rechaza (nunca se "repara").
 */

// ── Content script (mundo aislado) → background ────────────────────────

export const COSMETIC_REQUEST_TYPE = 'phishguard:wp:cosmetic-request'

export interface CosmeticRequest {
  type: typeof COSMETIC_REQUEST_TYPE
  v: 1
}

export function isCosmeticRequest(message: unknown): message is CosmeticRequest {
  if (typeof message !== 'object' || message === null) return false
  const m = message as Record<string, unknown>
  return Object.keys(m).length === 2 && m.type === COSMETIC_REQUEST_TYPE && m.v === 1
}

export interface CosmeticResponse {
  ok: boolean
  selectors: string[]
}

/** Límites que el content script exige a la respuesta del background. */
export const MAX_RESPONSE_SELECTORS = 2000
export const MAX_RESPONSE_SELECTOR_LENGTH = 500

export function parseCosmeticResponse(response: unknown): string[] | null {
  if (typeof response !== 'object' || response === null) return null
  const r = response as Record<string, unknown>
  if (r.ok !== true || !Array.isArray(r.selectors)) return null
  if (r.selectors.length > MAX_RESPONSE_SELECTORS) return null
  const selectors: string[] = []
  for (const s of r.selectors) {
    if (typeof s !== 'string' || s.length === 0 || s.length > MAX_RESPONSE_SELECTOR_LENGTH)
      return null
    selectors.push(s)
  }
  return selectors
}

/**
 * Datos del emisor que entrega Chrome (`chrome.runtime.MessageSender`),
 * reducidos a lo que el background comprueba.
 */
export interface SenderInfo {
  id?: string
  url?: string
  frameId?: number
  tab?: { id?: number }
}

/**
 * Hostname de la página que pidió selectores, solo si el mensaje viene de
 * un content script de ESTA extensión, en el marco principal de una
 * pestaña http(s). El hostname sale de `sender.url` (lo entrega Chrome),
 * nunca de un campo del mensaje.
 */
export function trustedSenderHostname(sender: SenderInfo, extensionId: string): string | null {
  if (sender.id !== extensionId) return null
  if (sender.frameId !== 0 || typeof sender.tab?.id !== 'number') return null
  if (typeof sender.url !== 'string') return null
  try {
    const url = new URL(sender.url)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.hostname || null
  } catch {
    return null
  }
}

// El canal mundo aislado → MAIN está en `mainChannel.ts` (sin payload).
