import { normalizeNavigationUrl } from '../shared/normalizeNavigationUrl'
import { createAuthorization } from './navigationAuthorization'

/**
 * Atiende "Continuar de todas formas": crea la autorización temporal Y
 * ejecuta la navegación, las dos cosas acá, en `background` — nunca en
 * `warning.ts` (que no usa `location`/`history`, solo manda el mensaje).
 * Se espera a que la autorización quede guardada (`await`) antes de
 * navegar, para que `onBeforeNavigate` la encuentre siempre a tiempo.
 */
export async function handleContinueRequest(tabId: number, url: string): Promise<void> {
  console.log('[CONTINUE] solicitud recibida')
  console.log(`[CONTINUE] tabId=${tabId}`)
  console.log(`[CONTINUE] URL original=${url}`)
  console.log(`[CONTINUE] URL normalizada=${normalizeNavigationUrl(url)}`)

  await createAuthorization(tabId, url) // loguea "[CONTINUE] autorización creada"
  await chrome.tabs.update(tabId, { url })
}
