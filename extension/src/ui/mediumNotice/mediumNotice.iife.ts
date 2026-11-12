import {
  isMediumNoticeContent,
  NOTICE_DISMISS_MESSAGE_TYPE,
  NOTICE_QUERY_MESSAGE_TYPE,
  NOTICE_READY_MESSAGE_TYPE,
  NOTICE_TRUST_MESSAGE_TYPE,
  type NoticeMessageType,
} from '../../shared/messages'
import { mountMediumNotice, type MountedNotice } from './noticeView'

/**
 * Content script del aviso de nivel medio (mundo aislado, solo marco
 * principal, `document_idle`). No analiza nada ni lee la página: pregunta a
 * `background` si ESTA pestaña tiene un resultado "medio" para ESTA
 * dirección y, si lo tiene, muestra la píldora. Ningún mensaje lleva URL.
 */
function send(type: NoticeMessageType): Promise<unknown> {
  return chrome.runtime.sendMessage({ type })
}

/** Aviso montado y la dirección para la que se montó. */
let current: { notice: MountedNotice; href: string } | null = null
let querying = false
/** Llegó otro pedido de consulta mientras había una en curso: se repite al terminar. */
let queryAgain = false

function withoutHash(href: string): string {
  return href.split('#')[0]!
}

/**
 * Pregunta al background si ESTA dirección tiene aviso. Si ya no lo tiene
 * (la página cambió de dirección con `history.pushState`, el usuario lo
 * cerró o confió en el sitio), retira el que estaba montado.
 */
async function main(): Promise<void> {
  if (querying) {
    queryAgain = true
    return
  }
  querying = true
  let response: { notice?: unknown } | undefined
  try {
    response = (await send(NOTICE_QUERY_MESSAGE_TYPE)) as { notice?: unknown } | undefined
  } finally {
    querying = false
  }
  if (queryAgain) {
    // La respuesta puede ser vieja (p. ej. pushState justo antes de que el
    // background guardara el nivel de la dirección nueva): se pregunta otra vez.
    queryAgain = false
    return main()
  }
  const href = withoutHash(location.href)

  if (!isMediumNoticeContent(response?.notice)) {
    current?.notice.remove()
    current = null
    return
  }
  if (current && current.href === href) return // ya está el de esta dirección
  current?.notice.remove()

  const notice = mountMediumNotice(document, response.notice, {
    onDismiss: () => {
      send(NOTICE_DISMISS_MESSAGE_TYPE).catch(() => {})
    },
    onTrust: () => {
      send(NOTICE_TRUST_MESSAGE_TYPE).catch(() => {})
    },
  })
  current = { notice, href }
}

function run(): void {
  main().catch(() => {
    // Sin respuesta del background (p. ej. la extensión se actualizó): no se muestra nada.
  })
}

// El análisis puede terminar después de que la página cargó, o la página
// puede cambiar de dirección sin recargar: el background avisa y se vuelve
// a preguntar. Solo se aceptan avisos del background de esta extensión
// (sin `sender.tab`).
chrome.runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== chrome.runtime.id || sender.tab) return undefined
  if ((message as { type?: unknown } | null)?.type === NOTICE_READY_MESSAGE_TYPE) run()
  return undefined
})

// Respaldo dentro de la página: si la dirección cambia sin recargar
// (pushState/replaceState/atrás) y el aviso del background tarda, se vuelve
// a preguntar igual. La API Navigation existe en Chrome 102+.
function onAddressChange(): void {
  if (current && withoutHash(location.href) !== current.href) run()
}
const navigationApi = (window as unknown as { navigation?: EventTarget }).navigation
navigationApi?.addEventListener('currententrychange', onAddressChange)
window.addEventListener('popstate', onAddressChange)

run()
