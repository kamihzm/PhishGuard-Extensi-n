import {
  mergeWebProtectionSettings,
  readWebProtectionSettings,
  WEB_PROTECTION_SETTINGS_KEY,
} from '../../settings'
import { isYoutubeHost } from '../adapters/youtube/adapter'
import {
  INTENT_SESSION_TYPE,
  intentRecordKey,
  parseIntentSession,
  recordFromIntent,
  type IntentSession,
  type IntentSessionQuery,
} from '../../popups/intentRecord'
import { isIntentQuery, startIntentRecorder } from '../../popups/navigationIntent'
import type { UserIntent } from '../../popups/types'
import { startPageLayer } from '../engine'
import { openIsolatedChannel } from '../mainChannel'
import { COSMETIC_REQUEST_TYPE, parseCosmeticResponse, type CosmeticRequest } from '../protocol'
import { createPageAdapters } from '../registry'

/**
 * Content script de la capa de página (mundo aislado, marco principal).
 * Registra solo el identificador del evento y conteos; nunca la URL, la
 * consulta, texto de la página ni HTML.
 */

// Canal privado hacia el mundo MAIN: se abre de forma SÍNCRONA en
// document_start (antes de cualquier script de la página) y solo en YouTube.
const youtubeChannel = isYoutubeHost(location.hostname) ? openIsolatedChannel(document) : null

// Popup Guard: intención reciente del usuario, solo en memoria. Se responde
// únicamente a consultas del background de ESTA extensión (sin `sender.tab`).
// Además, para el arranque en frío del service worker, la última intención que
// puede legitimar una navegación de esta pestaña se persiste en un único
// registro (ver `popups/intentRecord.ts`). Sin token de sesión no se escribe.
let intentSession: IntentSession | null = null
const sessionQuery: IntentSessionQuery = { type: INTENT_SESSION_TYPE, v: 1 }
chrome.runtime
  .sendMessage(sessionQuery)
  .then((response) => (intentSession = parseIntentSession(response)))
  .catch(() => undefined)
const persistIntent = (intent: UserIntent) => {
  if (!intentSession) return
  const record = recordFromIntent(intent, location.href, intentSession.token)
  if (!record) return
  chrome.storage.local
    .set({ [intentRecordKey(intentSession.tabId)]: record })
    .catch(() => undefined)
}
const intents = startIntentRecorder(window, document, Date.now, undefined, persistIntent)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isIntentQuery(message) || sender.id !== chrome.runtime.id || sender.tab) return undefined
  sendResponse({ v: 1, intents: intents.recent(Date.now()) })
  return undefined
})

startPageLayer({
  document,
  window,
  hostname: location.hostname,
  readSettings: () =>
    readWebProtectionSettings({
      get: (key) => chrome.storage.local.get(key),
      set: (items) => chrome.storage.local.set(items),
    }),
  subscribeSettings(onChange) {
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && WEB_PROTECTION_SETTINGS_KEY in changes) {
        onChange(mergeWebProtectionSettings(changes[WEB_PROTECTION_SETTINGS_KEY]?.newValue))
      }
    }
    chrome.storage.onChanged.addListener(listener)
    return () => chrome.storage.onChanged.removeListener(listener)
  },
  async requestCosmetic() {
    const request: CosmeticRequest = { type: COSMETIC_REQUEST_TYPE, v: 1 }
    return parseCosmeticResponse(await chrome.runtime.sendMessage(request))
  },
  adapters: createPageAdapters(youtubeChannel),
  log: (event, data) => console.debug('[WebProtection]', event, data ?? ''),
})
