import type { UserIntent } from './types'

/**
 * Intención de navegación del usuario.
 *
 * El content script (mundo aislado, marco principal) registra en MEMORIA
 * las últimas interacciones del usuario: tipo, modificadores, si pedía
 * pestaña nueva y el destino que pedía (href/action). Nada se persiste ni
 * se registra en logs. El background solo lo consulta cuando aparece una
 * ventana nueva o una navegación de la pestaña (modelo "bajo demanda": no
 * se envía nada por cada clic).
 *
 * Los listeners van en fase de CAPTURA sobre `window`, registrados en
 * `document_start`: se ejecutan antes que los de la página, así que un
 * script que intercepte el clic no puede ocultarlo.
 */

export const INTENT_QUERY_TYPE = 'phishguard:wp:intent-query'
/** Ventana de memoria: interacciones más antiguas se descartan. */
export const INTENT_TTL_MS = 5000
export const MAX_INTENTS = 5
export const MAX_EXPECTED_URL_LENGTH = 2048

export interface IntentQuery {
  type: typeof INTENT_QUERY_TYPE
  v: 1
}

export function isIntentQuery(message: unknown): message is IntentQuery {
  if (typeof message !== 'object' || message === null) return false
  const m = message as Record<string, unknown>
  return Object.keys(m).length === 2 && m.type === INTENT_QUERY_TYPE && m.v === 1
}

function httpUrl(value: string | null | undefined, base: string): string | null {
  if (!value) return null
  try {
    const url = new URL(value, base)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    const href = url.href
    return href.length <= MAX_EXPECTED_URL_LENGTH ? href : null
  } catch {
    return null
  }
}

/** Controles que pueden abrir una ventana al pulsarlos (sin navegar la pestaña). */
const CONTROL_SELECTOR =
  'button, [role="button"], summary, input[type="button" i], input[type="submit" i], input[type="image" i], input[type="reset" i]'

const NEW_CONTEXT_TARGET = (target: string | null) => {
  const t = (target ?? '').trim().toLowerCase()
  return t !== '' && t !== '_self' && t !== '_top' && t !== '_parent'
}

/** Convierte un evento del usuario en intención (null si no es una interacción relevante). */
export function intentFromEvent(event: Event, baseUrl: string, now: number): UserIntent | null {
  const target = event.target as Element | null
  if (event.type === 'submit') {
    const form = target as HTMLFormElement | null
    if (!form || form.tagName !== 'FORM') return null
    return {
      kind: 'submit',
      at: now,
      newTab: NEW_CONTEXT_TARGET(form.getAttribute('target')),
      expectedUrl: httpUrl(form.getAttribute('action') || baseUrl, baseUrl),
      form: true,
    }
  }
  const anchor =
    target && typeof target.closest === 'function' ? target.closest('a[href], area[href]') : null
  const href = anchor ? httpUrl(anchor.getAttribute('href'), baseUrl) : null
  const anchorNewTab = anchor ? NEW_CONTEXT_TARGET(anchor.getAttribute('target')) : false
  // T6: enlace que no navega (`#`, `javascript:`) o control fuera de enlaces.
  const rawHref = anchor?.getAttribute('href')?.trim() ?? ''
  const control = anchor
    ? href === null || rawHref.startsWith('#')
    : !!target && typeof target.closest === 'function' && target.closest(CONTROL_SELECTOR) !== null
  const controlField = control ? { control: true } : {}
  if (event.type === 'keydown') {
    const key = event as KeyboardEvent
    if (key.key !== 'Enter' || !anchor) return null
    return {
      kind: 'key',
      at: now,
      newTab: anchorNewTab || key.ctrlKey || key.metaKey || key.shiftKey,
      expectedUrl: href,
      form: false,
      ...controlField,
    }
  }
  if (event.type === 'click' || event.type === 'auxclick') {
    const mouse = event as MouseEvent
    if (event.type === 'auxclick' && mouse.button !== 1) return null
    return {
      kind: event.type === 'click' ? 'click' : 'auxclick',
      at: now,
      newTab:
        anchorNewTab || mouse.button === 1 || mouse.ctrlKey || mouse.metaKey || mouse.shiftKey,
      expectedUrl: href,
      form: false,
      ...controlField,
    }
  }
  return null
}

export interface IntentRecorder {
  recent(now: number): UserIntent[]
  stop(): void
}

/** Solo interacciones reales del usuario: los eventos sintéticos de la página se ignoran. */
export function startIntentRecorder(
  win: Window,
  doc: Document,
  clock: () => number = Date.now,
  /** Solo para tests (jsdom no produce eventos de confianza). */
  isTrusted: (event: Event) => boolean = (event) => event.isTrusted,
  /** Cada intención registrada (p. ej. para persistirla, ver `intentRecord.ts`). */
  onIntent?: (intent: UserIntent) => void,
): IntentRecorder {
  const intents: UserIntent[] = []
  const onEvent = (event: Event) => {
    if (!isTrusted(event)) return
    try {
      const intent = intentFromEvent(event, doc.baseURI, clock())
      if (!intent) return
      intents.push(intent)
      if (intents.length > MAX_INTENTS) intents.shift()
      onIntent?.({ ...intent })
    } catch {
      // Nunca interferir con la interacción del usuario.
    }
  }
  const types = ['click', 'auxclick', 'keydown', 'submit'] as const
  for (const type of types) win.addEventListener(type, onEvent, { capture: true, passive: true })
  return {
    recent(now) {
      return intents
        .filter((i) => now - i.at >= 0 && now - i.at <= INTENT_TTL_MS)
        .map((i) => ({ ...i }))
    },
    stop() {
      for (const type of types) win.removeEventListener(type, onEvent, { capture: true })
      intents.length = 0
    },
  }
}

/** Valida la respuesta del content script antes de usarla en el background. */
export function parseIntentResponse(response: unknown): UserIntent[] | null {
  if (typeof response !== 'object' || response === null) return null
  const r = response as Record<string, unknown>
  if (r.v !== 1 || !Array.isArray(r.intents) || r.intents.length > MAX_INTENTS) return null
  const out: UserIntent[] = []
  for (const raw of r.intents) {
    if (typeof raw !== 'object' || raw === null) return null
    const i = raw as Record<string, unknown>
    if (!['click', 'auxclick', 'key', 'submit'].includes(i.kind as string)) return null
    if (typeof i.at !== 'number' || !Number.isFinite(i.at)) return null
    if (typeof i.newTab !== 'boolean' || typeof i.form !== 'boolean') return null
    if (i.expectedUrl !== null && typeof i.expectedUrl !== 'string') return null
    const expectedUrl =
      typeof i.expectedUrl === 'string' ? httpUrl(i.expectedUrl, 'https://invalid.invalid/') : null
    if (typeof i.expectedUrl === 'string' && expectedUrl === null) return null
    if (i.control !== undefined && typeof i.control !== 'boolean') return null
    out.push({
      kind: i.kind as UserIntent['kind'],
      at: i.at,
      newTab: i.newTab,
      expectedUrl,
      form: i.form,
      ...(i.control === true ? { control: true } : {}),
    })
  }
  return out
}

/** Mismo documento de destino: mismo origen y ruta (se ignoran consulta y fragmento). */
export function sameDestination(a: string, b: string): boolean {
  try {
    const x = new URL(a)
    const y = new URL(b)
    return x.origin === y.origin && x.pathname.replace(/\/$/, '') === y.pathname.replace(/\/$/, '')
  } catch {
    return false
  }
}

/** Dominio "registrable" aproximado (sin lista PSL completa). Solo se usa como condición NECESARIA. */
export function siteOf(url: string): string | null {
  let host: string
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    host = u.hostname.toLowerCase().replace(/\.$/, '')
  } catch {
    return null
  }
  if (/^[\d.]+$/.test(host) || host.includes(':')) return host
  const labels = host.split('.')
  if (labels.length <= 2) return host
  const tld = labels[labels.length - 1]!
  const second = labels[labels.length - 2]!
  const twoLevel =
    tld.length === 2 &&
    ['com', 'co', 'org', 'net', 'gov', 'gob', 'edu', 'ac', 'mil', 'ne', 'or'].includes(second)
  return labels.slice(twoLevel ? -3 : -2).join('.')
}
