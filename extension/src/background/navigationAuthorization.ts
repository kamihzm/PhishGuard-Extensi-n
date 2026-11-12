import { normalizeNavigationUrl } from '../shared/normalizeNavigationUrl'

/**
 * Autorización temporal de navegación: cuando el usuario elige "Continuar
 * de todas formas", se activa para esa PESTAÑA (nunca para un dominio,
 * nunca permanente) durante una ventana muy corta. Mientras está activa,
 * cualquier navegación de frame principal en esa pestaña se deja pasar
 * sin llamar a `decide()` — así se tolera la cadena inmediata de
 * redirects que puede disparar la propia URL aprobada (ej. un upgrade
 * http→https) sin tener que comparar URL por URL en cada salto.
 *
 * Por qué NO se exige que cada navegación matchee la URL exacta
 * aprobada: se evaluó usar `details.transitionQualifiers` (como sugirió
 * el pedido) para distinguir "esto es un redirect de la navegación recién
 * aprobada" de "esto es una URL distinta" — pero `transitionQualifiers`
 * (y `transitionType`) NO están disponibles en
 * `chrome.webNavigation.onBeforeNavigate`, que es el evento en el que hay
 * que decidir esto. Ese dato solo llega en `onCommitted`, cuando la
 * navegación ya se comprometió — demasiado tarde para redirigir a
 * warning.html sin parpadeo. Sin esa señal, no hay forma confiable de
 * distinguir ambos casos en el momento que importa — por eso la
 * autorización se scope por PESTAÑA + VENTANA DE TIEMPO corta (no por URL
 * exacta), y se limpia apenas la navegación termina (`onCompleted`) para
 * que la ventana de exposición real sea mínima, no los 15s completos.
 *
 * Vive en `chrome.storage.session` — nunca se sincroniza ni se persiste
 * en disco.
 */
const AUTHORIZATION_TTL_MS = 15_000
const AUTHORIZATION_KEY_PREFIX = 'phishguard:continue-auth:'

export interface NavigationAuthorization {
  tabId: number
  initialUrl: string
  createdAt: number
  expiresAt: number
  active: boolean
}

function keyForTab(tabId: number): string {
  return `${AUTHORIZATION_KEY_PREFIX}${tabId}`
}

export async function createAuthorization(tabId: number, url: string): Promise<void> {
  const initialUrl = normalizeNavigationUrl(url)
  const now = Date.now()
  const authorization: NavigationAuthorization = {
    tabId,
    initialUrl,
    createdAt: now,
    expiresAt: now + AUTHORIZATION_TTL_MS,
    active: true,
  }
  await chrome.storage.session.set({ [keyForTab(tabId)]: authorization })
  console.log(
    `[CONTINUE] autorización creada tab=${tabId} url=${initialUrl} expira=${new Date(authorization.expiresAt).toISOString()}`,
  )
}

/** `true` si hay una autorización activa y vigente para esa pestaña. La consulta NO la elimina — sigue activa hasta que expire o se llame `clearAuthorization`. */
export async function hasTemporaryAuthorization(tabId: number, url: string): Promise<boolean> {
  const key = keyForTab(tabId)
  const stored = await chrome.storage.session.get(key)
  const authorization = stored[key] as NavigationAuthorization | undefined

  console.log(`[NAV] navegación detectada tab=${tabId} url=${safeNormalize(url)}`)

  if (!authorization || !authorization.active) {
    console.log(`[NAV] autorización ausente/expirada tab=${tabId}`)
    return false
  }

  if (Date.now() > authorization.expiresAt) {
    await chrome.storage.session.remove(key)
    console.log(`[NAV] autorización ausente/expirada tab=${tabId} (vencida)`)
    return false
  }

  console.log(`[NAV] autorización válida tab=${tabId}`)
  console.log(`[NAV] permitiendo navegación tab=${tabId} url=${safeNormalize(url)}`)
  return true
}

/** Se llama cuando la navegación termina (`onCompleted`) o cuando ya no hace falta conservarla. */
export async function clearAuthorization(tabId: number): Promise<void> {
  await chrome.storage.session.remove(keyForTab(tabId))
}

function safeNormalize(url: string): string {
  try {
    return normalizeNavigationUrl(url)
  } catch {
    return url
  }
}
