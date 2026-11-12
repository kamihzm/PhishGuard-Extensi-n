/**
 * Destinos de respaldo, en orden, cuando no hay una página anterior segura
 * y cerrar la pestaña falla (por ejemplo, política del navegador). No se
 * usa `history.back()` como estrategia: por qué, ver `shared/warningContextStore.ts`.
 */
const FALLBACK_SAFE_URLS = ['chrome://newtab/', 'about:blank']

/**
 * Comportamiento del botón "Volver a un sitio seguro":
 * 1. Si hay `safeReturnUrl` (y no es la propia URL bloqueada), navega ahí.
 * 2. Si no, intenta cerrar la pestaña.
 * 3. Si cerrar falla, prueba cada URL de `FALLBACK_SAFE_URLS` en orden.
 *
 * Nunca navega a `blockedUrl` — esa es la garantía central contra el loop.
 */
export async function goToSafety(
  tabId: number,
  safeReturnUrl: string | undefined,
  blockedUrl: string,
): Promise<void> {
  const destination = safeReturnUrl && safeReturnUrl !== blockedUrl ? safeReturnUrl : undefined

  if (destination) {
    await chrome.tabs.update(tabId, { url: destination })
    return
  }

  try {
    await chrome.tabs.remove(tabId)
    return
  } catch {
    // cerrar no fue posible (p. ej. política del navegador) — seguir con la cadena de respaldo
  }

  for (const fallbackUrl of FALLBACK_SAFE_URLS) {
    try {
      await chrome.tabs.update(tabId, { url: fallbackUrl })
      return
    } catch {
      // esta URL de respaldo no funcionó (bloqueada por el navegador) — probar la siguiente
    }
  }
}
