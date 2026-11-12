import { isPlayerEndpoint, sanitizePlayerPayload } from './sanitize'
import { createStreamSanitizer } from './streamSanitize'

// Primitivas capturadas al cargar (document_start, antes de cualquier script de
// la página): una página que las reemplace después no altera los ganchos.
const defineProperty = Object.defineProperty
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor

/**
 * Parte de YouTube que corre en el mundo MAIN (comparte el entorno de la
 * página). Reglas de seguridad aplicadas aquí:
 * - no se usa `eval`, `new Function` ni se ejecuta nada que venga de la
 *   página o del DOM; solo se leen y reescriben datos JSON;
 * - el único dato de control es un booleano validado (`setEnabled`);
 * - estado inicial "desconocido" = no se sanea nada (fail-open) hasta que
 *   el mundo aislado confirme que Anuncios está activo;
 * - cualquier error devuelve la respuesta ORIGINAL sin modificar;
 * - `setEnabled(false)` desinstala los ganchos y restaura `fetch` y
 *   `ytInitialPlayerResponse` como propiedades normales.
 *
 * Se inyecta como content script estático con `world: "MAIN"` y
 * `run_at: document_start` (sin permiso `scripting`): así los ganchos
 * existen antes de que el script en línea de YouTube asigne
 * `ytInitialPlayerResponse`.
 */

export const INITIAL_PLAYER_RESPONSE_KEY = 'ytInitialPlayerResponse'

export type GateState = 'unknown' | 'enabled' | 'disabled'

export interface YoutubeMainWorldStats {
  initialAssignments: number
  initialKeysRemoved: number
  playerFetches: number
  playerFetchesSanitized: number
  errors: number
}

export interface YoutubeMainWorld {
  setEnabled(enabled: boolean): void
  gate(): GateState
  installed(): boolean
  stats(): YoutubeMainWorldStats
}

type FetchFn = typeof fetch
type WindowLike = Window & typeof globalThis

export function createYoutubeMainWorld(win: WindowLike): YoutubeMainWorld {
  let gate: GateState = 'unknown'
  let installed = false
  const stats: YoutubeMainWorldStats = {
    initialAssignments: 0,
    initialKeysRemoved: 0,
    playerFetches: 0,
    playerFetchesSanitized: 0,
    errors: 0,
  }
  const shouldSanitize = () => gate === 'enabled'

  // ── ytInitialPlayerResponse ──────────────────────────────────────────
  let stored: unknown = undefined
  let propertyHooked = false
  const getter = () => stored
  const setter = (value: unknown) => {
    stats.initialAssignments++
    if (shouldSanitize()) {
      try {
        stats.initialKeysRemoved += sanitizePlayerPayload(value)
      } catch {
        stats.errors++
      }
    }
    stored = value
  }

  const hookProperty = () => {
    const existing = getOwnPropertyDescriptor(win, INITIAL_PLAYER_RESPONSE_KEY)
    // Si la página ya definió la propiedad de forma no configurable o con
    // accessor propio, no se toca (fail-open).
    if (existing && (!existing.configurable || existing.get || existing.set)) return
    stored = existing?.value
    defineProperty(win, INITIAL_PLAYER_RESPONSE_KEY, {
      configurable: true,
      enumerable: true,
      get: getter,
      set: setter,
    })
    propertyHooked = true
  }

  const unhookProperty = () => {
    if (!propertyHooked) return
    const current = getOwnPropertyDescriptor(win, INITIAL_PLAYER_RESPONSE_KEY)
    if (current?.get === getter) {
      defineProperty(win, INITIAL_PLAYER_RESPONSE_KEY, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: stored,
      })
    }
    propertyHooked = false
  }

  // ── fetch ────────────────────────────────────────────────────────────
  const originalFetch: FetchFn = win.fetch
  const ResponseCtor = win.Response
  const HeadersCtor = win.Headers
  const RequestCtor = win.Request

  const requestUrl = (input: RequestInfo | URL): string | null => {
    try {
      if (typeof input === 'string') return input
      if (RequestCtor && input instanceof RequestCtor) return input.url
      if (input instanceof URL) return input.href
      return null
    } catch {
      return null
    }
  }

  const ReadableStreamCtor = win.ReadableStream
  const TextDecoderCtor = win.TextDecoder
  const TextEncoderCtor = win.TextEncoder

  const replacement = (response: Response, body: BodyInit): Response => {
    const headers = new HeadersCtor(response.headers)
    headers.delete('content-length')
    const replaced = new ResponseCtor(body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
    defineProperty(replaced, 'url', { value: response.url })
    return replaced
  }

  /**
   * Devuelve la respuesta EN CUANTO llegan las cabeceras: el cuerpo se
   * sanea por elementos a medida que llega (`streamSanitize.ts`), sin
   * esperar el cuerpo completo. Ante cualquier fallo antes de empezar a
   * transmitir, se devuelve la respuesta original.
   */
  const sanitizeResponse = (response: Response): Response => {
    try {
      if (!response.ok || !shouldSanitize() || !response.body) return response
      if (!ReadableStreamCtor || !TextDecoderCtor || !TextEncoderCtor) return response
      const reader = response.body.getReader()
      const decoder = new TextDecoderCtor()
      const encoder = new TextEncoderCtor()
      const sanitizer = createStreamSanitizer()
      const body = new ReadableStreamCtor<Uint8Array>({
        async pull(controller) {
          try {
            // Se sigue leyendo hasta tener algo que entregar: si `pull()`
            // terminara sin encolar nada, el stream no lo vuelve a llamar y el
            // lector de YouTube quedaría esperando para siempre.
            for (;;) {
              const { done, value } = await reader.read()
              if (done) {
                const tail = sanitizer.push(decoder.decode()) + sanitizer.end()
                if (tail) controller.enqueue(encoder.encode(tail))
                if (sanitizer.removed() > 0) stats.playerFetchesSanitized++
                controller.close()
                return
              }
              const out = sanitizer.push(decoder.decode(value, { stream: true }))
              if (out) {
                controller.enqueue(encoder.encode(out))
                return
              }
            }
          } catch (error) {
            // Error de red a mitad del cuerpo: se propaga igual que sin nosotros.
            stats.errors++
            controller.error(error)
          }
        },
        cancel(reason) {
          return reader.cancel(reason)
        },
      })
      return replacement(response, body)
    } catch {
      stats.errors++
      return response
    }
  }

  const wrappedFetch = function (
    this: unknown,
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const pending = originalFetch.call(win, input, init)
    if (!shouldSanitize()) return pending
    const url = requestUrl(input)
    if (url === null || !isPlayerEndpoint(url, win.location.origin)) return pending
    stats.playerFetches++
    return pending.then(sanitizeResponse)
  } as FetchFn

  const hookFetch = () => {
    if (typeof originalFetch === 'function' && win.fetch === originalFetch) win.fetch = wrappedFetch
  }
  const unhookFetch = () => {
    // Si otro script envolvió `fetch` después, no se pisa su envoltorio:
    // el nuestro queda en modo "pasar" porque el gate ya no está habilitado.
    if (win.fetch === wrappedFetch) win.fetch = originalFetch
  }

  const install = () => {
    if (installed) return
    try {
      hookProperty()
      hookFetch()
      installed = true
    } catch {
      stats.errors++
      uninstall()
    }
  }
  const uninstall = () => {
    try {
      unhookFetch()
      unhookProperty()
    } catch {
      stats.errors++
    }
    installed = false
  }

  // Se instala en modo "pasar" desde document_start: los ganchos existen
  // antes del script en línea, pero no modifican nada hasta `setEnabled(true)`.
  install()

  return {
    setEnabled(enabled) {
      gate = enabled ? 'enabled' : 'disabled'
      if (enabled) install()
      else uninstall()
    },
    gate: () => gate,
    installed: () => installed,
    stats: () => ({ ...stats }),
  }
}
