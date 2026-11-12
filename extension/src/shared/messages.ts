/**
 * Contrato del mensaje que `ui/warning` le envía a `background` cuando el
 * usuario elige "Continuar de todas formas". Vive en `shared/` porque
 * ambos lados (que no se importan entre sí) necesitan el mismo `type` y
 * forma exacta — evita que un typo en un lado silenciosamente no matchee
 * con el otro.
 *
 * Nota: el mensaje solo lleva la URL — el `tabId` se toma de
 * `sender.tab.id` (lo entrega Chrome, no la página) en el listener de
 * `background`, porque es la pestaña real emisora del mensaje, no un dato
 * que la página tenga que reportar por su cuenta.
 */
export const CONTINUE_MESSAGE_TYPE = 'phishguard:continue' as const

export interface ContinueMessage {
  type: typeof CONTINUE_MESSAGE_TYPE
  url: string
}

export function isContinueMessage(message: unknown): message is ContinueMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === CONTINUE_MESSAGE_TYPE &&
    typeof (message as { url?: unknown }).url === 'string'
  )
}

/**
 * Mensaje que `ui/warning` le envía a `background` cuando el usuario
 * confirma "Confiar en este sitio". A diferencia de "continuar", esto no
 * es temporal: agrega el hostname a la allowlist permanente antes de
 * navegar.
 */
export const TRUST_MESSAGE_TYPE = 'phishguard:trust' as const

export interface TrustMessage {
  type: typeof TRUST_MESSAGE_TYPE
  url: string
}

export function isTrustMessage(message: unknown): message is TrustMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === TRUST_MESSAGE_TYPE &&
    typeof (message as { url?: unknown }).url === 'string'
  )
}

/**
 * Aviso de nivel medio dentro de la página (`ui/mediumNotice`). El content
 * script nunca manda una URL: `background` usa `sender.tab.id` y
 * `sender.url` (los entrega Chrome) y solo responde si esa pestaña tiene un
 * análisis "medio" guardado para ESA misma dirección.
 *
 * - `notice-query`: ¿hay aviso para esta página? Responde `{ notice }`.
 * - `notice-dismiss`: el usuario lo cerró; no se vuelve a mostrar en esta
 *   pestaña para esta dirección.
 * - `notice-trust`: "Confiar en este sitio", confirmado en el propio aviso.
 */
export const NOTICE_QUERY_MESSAGE_TYPE = 'phishguard:notice-query' as const
export const NOTICE_DISMISS_MESSAGE_TYPE = 'phishguard:notice-dismiss' as const
export const NOTICE_TRUST_MESSAGE_TYPE = 'phishguard:notice-trust' as const
/**
 * `background` → content script: "ya hay un resultado para esta pestaña,
 * vuelve a preguntar". Evita la carrera en la que la página termina de
 * cargar antes de que el análisis quede guardado. No lleva datos: el
 * content script vuelve a pedirlos con `notice-query`, que se valida igual.
 */
export const NOTICE_READY_MESSAGE_TYPE = 'phishguard:notice-ready' as const

export type NoticeMessageType =
  | typeof NOTICE_QUERY_MESSAGE_TYPE
  | typeof NOTICE_DISMISS_MESSAGE_TYPE
  | typeof NOTICE_TRUST_MESSAGE_TYPE

export interface NoticeMessage {
  type: NoticeMessageType
}

const NOTICE_TYPES: readonly string[] = [
  NOTICE_QUERY_MESSAGE_TYPE,
  NOTICE_DISMISS_MESSAGE_TYPE,
  NOTICE_TRUST_MESSAGE_TYPE,
]

export function isNoticeMessage(message: unknown): message is NoticeMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    NOTICE_TYPES.includes((message as { type?: unknown }).type as string)
  )
}

/** Textos ya preparados por `background` para el aviso (el content script no analiza nada). */
export interface MediumNoticeContent {
  verdict: string
  headline: string
  signalsHeading: string
  signals: string[]
  noSignalsText: string
  tip: string
  /** Dominio real al que lleva la dirección. */
  realDomain: string
  /** Lo que la dirección aparenta ser, si la disfraza. */
  apparent: string | null
  /** Hostname que se agregaría a Sitios confiables. */
  trustHostname: string
}

const isString = (value: unknown): value is string => typeof value === 'string'

export function isMediumNoticeContent(value: unknown): value is MediumNoticeContent {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    ['verdict', 'headline', 'signalsHeading', 'noSignalsText', 'tip', 'realDomain', 'trustHostname']
      .map((key) => v[key])
      .every(isString) &&
    Array.isArray(v.signals) &&
    v.signals.every(isString) &&
    (v.apparent === null || isString(v.apparent))
  )
}
