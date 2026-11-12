import {
  INTENT_RECORD_PREFIX,
  intentRecordKey,
  intentTokenKey,
  isExpiredRecord,
  parseIntentRecord,
} from '../popups/intentRecord'

/**
 * Almacenamiento del registro de intención (ver `popups/intentRecord.ts`):
 * - registro: `chrome.storage.local` (lo escribe el content script);
 * - token de correlación por pestaña: `chrome.storage.session` (solo
 *   contextos de la extensión; no se cambia su nivel de acceso).
 */

/** Lee y elimina el registro de la pestaña: consumo único. */
export async function takeIntentRecord(tabId: number): Promise<unknown> {
  const key = intentRecordKey(tabId)
  const stored = await chrome.storage.local.get(key)
  if (!(key in stored)) return null
  await chrome.storage.local.remove(key)
  return stored[key]
}

export async function getIntentToken(tabId: number): Promise<string | null> {
  const key = intentTokenKey(tabId)
  const stored = await chrome.storage.session.get(key)
  const token = stored[key]
  return typeof token === 'string' ? token : null
}

/**
 * Emisiones en curso por pestaña. No es estado persistente (regla 7 de los
 * service workers): es un candado que dura lo que dura la operación. Sin él,
 * dos pedidos simultáneos leen "sin token" y escriben UUID distintos, y el
 * documento que se queda con el perdedor ve sus registros rechazados. Si el
 * worker se reinicia, la promesa muere con él y el token se vuelve a leer de
 * `storage.session`. La entrada se borra al terminar, también si falla.
 */
const tokenIssuance = new Map<number, Promise<string>>()

/** Token estable por pestaña (sobrevive a reinicios del worker, no del navegador). */
export function issueIntentToken(tabId: number): Promise<string> {
  const inFlight = tokenIssuance.get(tabId)
  if (inFlight) return inFlight
  const issuance = readOrCreateIntentToken(tabId).finally(() => tokenIssuance.delete(tabId))
  tokenIssuance.set(tabId, issuance)
  return issuance
}

async function readOrCreateIntentToken(tabId: number): Promise<string> {
  const existing = await getIntentToken(tabId)
  if (existing) return existing
  const token = crypto.randomUUID()
  await chrome.storage.session.set({ [intentTokenKey(tabId)]: token })
  return token
}

export async function forgetIntentTab(tabId: number): Promise<void> {
  await Promise.all([
    chrome.storage.local.remove(intentRecordKey(tabId)),
    chrome.storage.session.remove(intentTokenKey(tabId)),
  ])
}

/**
 * Al arrancar el worker: elimina registros vencidos o inválidos (p. ej. tras
 * un cierre inesperado del navegador). Requiere `storage.local.getKeys`
 * (Chrome 130+); si no existe, quedan la limpieza al leer, al consumir y al
 * cerrar la pestaña.
 */
export async function sweepIntentRecords(now: number): Promise<void> {
  const area = chrome.storage.local as chrome.storage.StorageArea & {
    getKeys?: () => Promise<string[]>
  }
  if (typeof area.getKeys !== 'function') return
  const keys = (await area.getKeys()).filter((k) => k.startsWith(INTENT_RECORD_PREFIX))
  if (keys.length === 0) return
  const stored = await chrome.storage.local.get(keys)
  const stale = keys.filter((key) => {
    const record = parseIntentRecord(stored[key])
    return record === null || isExpiredRecord(record, now)
  })
  if (stale.length > 0) await chrome.storage.local.remove(stale)
}
