import type { Hider } from './hider'

/**
 * Contrato común de los adaptadores de sitio de la capa de página.
 *
 * Un adaptador:
 * - declara con qué hostnames trabaja (`appliesTo`) y sus match patterns
 *   del manifest (`matches`, verificados por test contra el manifest);
 * - `start()` detecta y aplica; devuelve un handle con `stop()` que deshace
 *   TODO lo que hizo (marcas, observers, listeners, eventos);
 * - ante cualquier duda o error NO actúa (fail-open): el motor atrapa las
 *   excepciones, llama a `stop()` y deja la página como estaba.
 */
export interface PageAdapter {
  readonly id: string
  /** Match patterns de content script que el adaptador necesita. */
  readonly matches: readonly string[]
  appliesTo(hostname: string): boolean
  start(context: AdapterContext): AdapterHandle
  /** Opcional: se llama si la protección está desactivada y el adaptador no está en marcha. */
  announceInactive?(): void
}

export interface AdapterHandle {
  stop(): void
}

export interface AdapterContext {
  document: Document
  window: Window & typeof globalThis
  hider: Hider
  log: PageLogger
}

/** Solo identificadores y conteos: nunca URLs, consultas, texto ni HTML. */
export type PageLogger = (event: string, data?: Record<string, number | string | boolean>) => void

/** `hostname` es `domain` o un subdominio suyo. */
export function isHostOrSubdomain(hostname: string, domain: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  return host === domain || host.endsWith(`.${domain}`)
}
