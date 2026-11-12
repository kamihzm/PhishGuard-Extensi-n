import type { Decision } from '../agent/types'
import {
  NOTICE_DISMISS_MESSAGE_TYPE,
  NOTICE_QUERY_MESSAGE_TYPE,
  NOTICE_READY_MESSAGE_TYPE,
  NOTICE_TRUST_MESSAGE_TYPE,
  type MediumNoticeContent,
  type NoticeMessage,
} from '../shared/messages'
import { normalizeTrustedHostname } from '../trustedSites/normalizeTrustedHostname'
import { addTrustedSite } from '../trustedSites/service'
import { describeDestination } from '../ui/destination'
import { buildHumanExplanation } from '../ui/humanExplanation'
import { clearBadge } from './badge'

/**
 * Aviso de nivel medio dentro de la página: `navigationGate` guarda aquí el
 * resultado "medio" de la navegación principal de cada pestaña, y el
 * content script `ui/mediumNotice` lo pide al cargar. Nada se recalcula: el
 * texto sale del mismo `Decision` que ya produjo `decide()`.
 *
 * Se guarda en `chrome.storage.session` (no en memoria) porque el service
 * worker puede dormirse entre la navegación y la carga de la página. Ese
 * almacenamiento no es accesible para los content scripts.
 */
interface NoticeRecord {
  url: string
  content: MediumNoticeContent
  dismissed: boolean
}

const keyFor = (tabId: number) => `mediumNotice:${tabId}`
/** Direcciones en las que el usuario cerró el aviso, por pestaña: no se repite al recargar. */
const dismissedKeyFor = (tabId: number) => `mediumNoticeDismissed:${tabId}`

export function buildNoticeContent(decision: Decision): MediumNoticeContent | null {
  const destination = describeDestination(decision)
  if (!destination) return null
  let trustHostname: string
  try {
    trustHostname = normalizeTrustedHostname(decision.url)
  } catch {
    return null
  }
  const human = buildHumanExplanation(decision)
  return {
    verdict: human.verdict,
    headline: human.headline,
    signalsHeading: human.signalsHeading,
    signals: human.signals,
    noSignalsText: human.noSignalsText,
    tip: human.tip,
    realDomain: destination.realDomain,
    apparent: destination.apparent,
    trustHostname,
  }
}

export async function rememberMediumNotice(tabId: number, decision: Decision): Promise<void> {
  const content = buildNoticeContent(decision)
  if (!content) return
  const dismissed = (await readDismissed(tabId)).some((url) => isSameDocument(url, decision.url))
  const record: NoticeRecord = { url: decision.url, content, dismissed }
  await chrome.storage.session.set({ [keyFor(tabId)]: record })
  if (dismissed) return
  // Si la página ya cargó, su content script preguntó antes de que esto
  // existiera: se le avisa para que vuelva a preguntar. Si todavía no cargó
  // (o es la página anterior de la pestaña), no pasa nada: la consulta se
  // valida contra `sender.url`.
  notifyNoticeChanged(tabId)
}

/**
 * Pide al content script del marco principal que vuelva a consultar (sin
 * datos en el mensaje). Si ya no hay aviso para su dirección, lo retira.
 */
export function notifyNoticeChanged(tabId: number): void {
  Promise.resolve()
    .then(() => chrome.tabs.sendMessage(tabId, { type: NOTICE_READY_MESSAGE_TYPE }, { frameId: 0 }))
    .catch(() => {})
}

/** Al navegar: se descarta el aviso de la página anterior (se conserva qué avisos cerró el usuario). */
export async function forgetMediumNotice(tabId: number): Promise<void> {
  await chrome.storage.session.remove(keyFor(tabId))
}

/** Al cerrar la pestaña: se descarta todo lo de esa pestaña. */
export async function forgetMediumNoticeTab(tabId: number): Promise<void> {
  await chrome.storage.session.remove([keyFor(tabId), dismissedKeyFor(tabId)])
}

async function readDismissed(tabId: number): Promise<string[]> {
  const stored = await chrome.storage.session.get(dismissedKeyFor(tabId))
  const value = stored[dismissedKeyFor(tabId)]
  return Array.isArray(value) ? (value as string[]) : []
}

async function readRecord(tabId: number): Promise<NoticeRecord | undefined> {
  const stored = await chrome.storage.session.get(keyFor(tabId))
  return stored[keyFor(tabId)] as NoticeRecord | undefined
}

/** Misma página: se ignoran el fragmento (#…) y el usuario/contraseña, que Chrome puede no reportar en `sender.url`. */
export function isSameDocument(analyzedUrl: string, pageUrl: string): boolean {
  try {
    const a = new URL(analyzedUrl)
    const b = new URL(pageUrl)
    return a.origin === b.origin && a.pathname === b.pathname && a.search === b.search
  } catch {
    return false
  }
}

export type NoticeResponse = { notice: MediumNoticeContent | null } | { ok: boolean }

/**
 * Atiende los mensajes del aviso. Solo acepta mensajes del marco principal
 * de una pestaña, de esta extensión, y solo si la pestaña tiene un análisis
 * medio guardado para la MISMA dirección que muestra.
 *
 * La dirección actual sale de `sender.tab.url` (la entrega Chrome, no la
 * página): tras `history.pushState`, `sender.url` sigue informando la
 * dirección con la que cargó el documento, mientras que la de la pestaña
 * sí se actualiza. Como solo se acepta el marco principal, ambas son la
 * misma página; `sender.url` queda como respaldo.
 */
export async function handleNoticeMessage(
  message: NoticeMessage,
  sender: chrome.runtime.MessageSender,
): Promise<NoticeResponse> {
  const tabId = sender.tab?.id
  const denied = message.type === NOTICE_QUERY_MESSAGE_TYPE ? { notice: null } : { ok: false }
  if (sender.id !== chrome.runtime.id || tabId === undefined || sender.frameId !== 0) return denied
  const pageUrl = sender.tab?.url ?? sender.url
  if (!pageUrl) return denied

  const record = await readRecord(tabId)
  if (!record || !isSameDocument(record.url, pageUrl)) return denied

  switch (message.type) {
    case NOTICE_QUERY_MESSAGE_TYPE:
      return { notice: record.dismissed ? null : record.content }
    case NOTICE_DISMISS_MESSAGE_TYPE:
      await chrome.storage.session.set({
        [keyFor(tabId)]: { ...record, dismissed: true },
        [dismissedKeyFor(tabId)]: [...(await readDismissed(tabId)), record.url].slice(-20),
      })
      return { ok: true }
    case NOTICE_TRUST_MESSAGE_TYPE:
      // La URL es la que analizó `navigationGate`, no una que mande la página.
      await addTrustedSite(record.url)
      await forgetMediumNotice(tabId)
      await clearBadge(tabId)
      return { ok: true }
  }
}
