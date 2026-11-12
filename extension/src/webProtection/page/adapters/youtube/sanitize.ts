/**
 * Saneamiento estructural de respuestas del reproductor de YouTube.
 *
 * Evidencia (Chrome real, docs/web-protection-audit.md "Capa de página →
 * YouTube"): los anuncios del reproductor NO llegan como peticiones que
 * DNR pueda bloquear sin romper el video (`videoplayback` sirve a la vez
 * video y anuncio), sino como datos dentro de la respuesta del reproductor:
 * `adPlacements`, `playerAds`, `adSlots` y `adBreakHeartbeatParams`.
 * - Carga inicial: `ytInitialPlayerResponse` (script en línea).
 * - Navegación interna: `fetch` a `/youtubei/v1/player` (claves en la raíz
 *   o bajo `playerResponse`) y a `/youtubei/v1/get_watch` (arreglo con
 *   `[i].playerResponse`).
 *
 * Solo se quitan esas cuatro claves y SOLO de objetos que tienen forma de
 * respuesta del reproductor (contienen `playabilityStatus`, `videoDetails`
 * o `streamingData`). No se toca `streamingData`, `currentTime`,
 * `playbackRate` ni el DOM del reproductor. Profundidad acotada.
 */

export const AD_KEYS = ['adPlacements', 'playerAds', 'adSlots', 'adBreakHeartbeatParams'] as const
export const PLAYER_ENDPOINTS: ReadonlySet<string> = new Set([
  '/youtubei/v1/player',
  '/youtubei/v1/get_watch',
])
const MAX_DEPTH = 3

export function isPlayerResponse(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return 'playabilityStatus' in value || 'videoDetails' in value || 'streamingData' in value
}

/** Quita las claves publicitarias en su lugar; devuelve cuántas quitó. */
export function sanitizePlayerPayload(node: unknown, depth = 0): number {
  if (typeof node !== 'object' || node === null || depth > MAX_DEPTH) return 0
  let removed = 0
  if (Array.isArray(node)) {
    for (const item of node) removed += sanitizePlayerPayload(item, depth + 1)
    return removed
  }
  const record = node as Record<string, unknown>
  if (isPlayerResponse(record)) {
    for (const key of AD_KEYS) {
      if (Object.prototype.hasOwnProperty.call(record, key)) {
        delete record[key]
        removed++
      }
    }
  }
  if (typeof record.playerResponse === 'object' && record.playerResponse !== null) {
    removed += sanitizePlayerPayload(record.playerResponse, depth + 1)
  }
  return removed
}

/** ¿La petición va a un endpoint del reproductor del mismo origen de YouTube? */
export function isPlayerEndpoint(requestUrl: string, pageOrigin: string): boolean {
  try {
    const url = new URL(requestUrl, pageOrigin)
    return url.origin === pageOrigin && PLAYER_ENDPOINTS.has(url.pathname)
  } catch {
    return false
  }
}
