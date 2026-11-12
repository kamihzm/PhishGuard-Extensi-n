import { addTrustedSite } from '../trustedSites/service'

/**
 * Atiende "Confiar en este sitio": agrega el hostname a la allowlist
 * permanente Y ejecuta la navegación, acá en `background` — mismo
 * principio que "continuar" (nunca `location.href` en `warning.ts`).
 *
 * A diferencia del bypass temporal, acá no hace falta ningún token con
 * expiración: una vez que el hostname queda en `chrome.storage.local`,
 * CUALQUIER navegación futura a ese hostname lo encuentra en
 * `isTrustedUrl()` (en `navigationGate.ts`) antes de siquiera llamar a
 * `decide()` — la persistencia del registro es, en sí misma, lo que evita
 * el loop, sin necesitar una ventana de tiempo corta.
 */
export async function handleTrustRequest(tabId: number, url: string): Promise<void> {
  await addTrustedSite(url)
  await chrome.tabs.update(tabId, { url })
}
