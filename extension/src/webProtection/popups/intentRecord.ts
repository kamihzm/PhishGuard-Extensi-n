import { INTENT_TTL_MS, MAX_EXPECTED_URL_LENGTH } from './navigationIntent'
import type { UserIntent } from './types'

/**
 * Intención persistida para el ARRANQUE EN FRÍO del service worker.
 *
 * Medido en Chromium real: cuando el clic que dispara un hijack es lo que
 * despierta al service worker, los eventos de `webNavigation` llegan cuando el
 * documento original ya no existe, y un `runtime.sendMessage` enviado desde él
 * se pierde. Una escritura en `chrome.storage.local` hecha en el clic sí
 * sobrevive (la procesa el navegador, no el worker).
 *
 * Minimización: un único registro por pestaña (se sobrescribe), solo para
 * interacciones que pueden legitimar una navegación de ESA pestaña (enlace
 * http(s) o formulario, sin pestaña nueva), URLs sin consulta ni fragmento.
 * Nunca sale del navegador. Correlación: un token por pestaña que el worker
 * guarda en `chrome.storage.session` (no accesible a content scripts), así un
 * content script no puede fabricar intenciones para otra pestaña.
 *
 * `storage.local` es persistente: borrar la clave es lógico; el navegador no
 * garantiza cuándo desaparece físicamente del disco.
 */

export const INTENT_RECORD_PREFIX = 'phishguard:wp:intent:'
export const INTENT_TOKEN_PREFIX = 'phishguard:wp:intent-token:'
export const INTENT_SESSION_TYPE = 'phishguard:wp:intent-session'
/** Caducidad del registro: la misma memoria que usa el recorder. */
export const INTENT_RECORD_TTL_MS = INTENT_TTL_MS
/** Tolerancia de reloj entre el content script y el evento de navegación. */
const CLOCK_SKEW_MS = 50
const MAX_TOKEN_LENGTH = 64

export const intentRecordKey = (tabId: number) => `${INTENT_RECORD_PREFIX}${tabId}`
export const intentTokenKey = (tabId: number) => `${INTENT_TOKEN_PREFIX}${tabId}`

export interface IntentRecord {
  v: 1
  token: string
  at: number
  kind: UserIntent['kind']
  form: boolean
  expectedUrl: string | null
  documentUrl: string
}

export interface IntentSessionQuery {
  type: typeof INTENT_SESSION_TYPE
  v: 1
}

export interface IntentSession {
  tabId: number
  token: string
}

/** Origen + ruta de una URL http(s); sin consulta ni fragmento. */
export function stripUrl(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    const stripped = `${url.origin}${url.pathname}`
    return stripped.length <= MAX_EXPECTED_URL_LENGTH ? stripped : null
  } catch {
    return null
  }
}

/** `null` si la intención no puede legitimar una navegación de esta pestaña. */
export function recordFromIntent(
  intent: UserIntent,
  documentUrl: string,
  token: string,
): IntentRecord | null {
  if (intent.newTab) return null
  const expectedUrl = intent.expectedUrl === null ? null : stripUrl(intent.expectedUrl)
  if (!intent.form && expectedUrl === null) return null
  const doc = stripUrl(documentUrl)
  if (doc === null) return null
  return {
    v: 1,
    token,
    at: intent.at,
    kind: intent.kind,
    form: intent.form,
    expectedUrl,
    documentUrl: doc,
  }
}

const KINDS: ReadonlyArray<UserIntent['kind']> = ['click', 'auxclick', 'key', 'submit']
const RECORD_KEYS = ['v', 'token', 'at', 'kind', 'form', 'expectedUrl', 'documentUrl']
const isStripped = (value: unknown): value is string =>
  typeof value === 'string' && stripUrl(value) === value

const isToken = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_TOKEN_LENGTH

/** Valida lo leído de `storage.local` (lo escribe un contexto no confiable). */
export function parseIntentRecord(raw: unknown): IntentRecord | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const keys = Object.keys(r)
  if (keys.length !== RECORD_KEYS.length || !RECORD_KEYS.every((k) => keys.includes(k))) return null
  if (r.v !== 1 || !isToken(r.token)) return null
  if (typeof r.at !== 'number' || !Number.isFinite(r.at)) return null
  if (!KINDS.includes(r.kind as UserIntent['kind']) || typeof r.form !== 'boolean') return null
  if (r.expectedUrl !== null && !isStripped(r.expectedUrl)) return null
  if (!isStripped(r.documentUrl)) return null
  return {
    v: 1,
    token: r.token,
    at: r.at,
    kind: r.kind as UserIntent['kind'],
    form: r.form,
    expectedUrl: r.expectedUrl as string | null,
    documentUrl: r.documentUrl,
  }
}

export function isExpiredRecord(record: IntentRecord, now: number): boolean {
  return now - record.at > INTENT_RECORD_TTL_MS
}

/**
 * Correlación con una navegación de la pestaña: mismo token y la interacción
 * ocurrió antes de que empezara la navegación (dentro de la caducidad).
 */
export function acceptIntentRecord(
  record: IntentRecord,
  ctx: { token: string | null; navigationStartedAt: number },
): { documentUrl: string; intent: UserIntent } | null {
  if (ctx.token === null || record.token !== ctx.token) return null
  const age = ctx.navigationStartedAt - record.at
  if (age < -CLOCK_SKEW_MS || age > INTENT_RECORD_TTL_MS) return null
  return {
    documentUrl: record.documentUrl,
    intent: {
      kind: record.kind,
      at: record.at,
      newTab: false,
      expectedUrl: record.expectedUrl,
      form: record.form,
    },
  }
}

export function isIntentSessionQuery(message: unknown): message is IntentSessionQuery {
  if (typeof message !== 'object' || message === null) return false
  const m = message as Record<string, unknown>
  return Object.keys(m).length === 2 && m.type === INTENT_SESSION_TYPE && m.v === 1
}

export function parseIntentSession(response: unknown): IntentSession | null {
  if (typeof response !== 'object' || response === null) return null
  const r = response as Record<string, unknown>
  if (r.v !== 1 || !Number.isInteger(r.tabId) || (r.tabId as number) < 0) return null
  if (!isToken(r.token)) return null
  return { tabId: r.tabId as number, token: r.token }
}
