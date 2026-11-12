/**
 * Canal privado mundo aislado → mundo MAIN (solo YouTube).
 *
 * Problema: ambos mundos comparten el DOM con la página. Un evento
 * despachado en `document` puede escucharlo y FORJARLO cualquier script de
 * la página. No existe autenticación criptográfica posible entre el mundo
 * MAIN y la página: comparten el mismo entorno JavaScript.
 *
 * Diseño (sin afirmar autenticación):
 * 1. Ambos scripts corren en `document_start`, ANTES de cualquier script de
 *    la página (garantía de Chrome para content scripts `document_start`).
 * 2. En ese momento, el lado MAIN crea un nodo propio NUNCA insertado en el
 *    documento salvo durante el despacho síncrono del anuncio (se inserta,
 *    se despacha un evento que burbujea hasta `document` y se retira en el
 *    mismo bloque síncrono). El lado aislado lo toma de `event.target`.
 *    Como la página todavía no ejecutó nada, no puede haber escuchado el
 *    anuncio, y después no tiene ninguna referencia al nodo.
 * 3. El orden entre los dos scripts no se asume: si el MAIN corre primero,
 *    el aislado pide un único re-anuncio (`REQUEST`, presupuesto 1).
 * 4. El canal se CIERRA en cuanto queda establecido (ACK del aislado), al
 *    recibir la primera orden, o por tiempo: ningún anuncio o petición
 *    posterior se atiende.
 * 5. Las órdenes son eventos SIN datos sobre el nodo privado: el tipo del
 *    evento es la orden (`enable`/`disable`). No hay payload que validar,
 *    ni selectores, URLs, endpoints ni código.
 *
 * Qué puede hacer una página hostil: despachar eventos con esos nombres en
 * `document` o en sus propios nodos; se ignoran (no llegan al nodo privado).
 * Riesgo residual documentado: la página siempre puede modificar SUS
 * propias respuestas o `fetch` por su cuenta; el protocolo no le da ninguna
 * capacidad adicional.
 */

export const CHANNEL_ANNOUNCE = 'phishguard:wp:channel-announce'
export const CHANNEL_REQUEST = 'phishguard:wp:channel-request'
export const CHANNEL_ACK = 'phishguard:wp:channel-ack'
export const COMMAND_ENABLE = 'phishguard:wp:youtube-enable'
export const COMMAND_DISABLE = 'phishguard:wp:youtube-disable'

// Constructor capturado al cargar: una página no puede sustituirlo antes.
const EventCtor = Event

export interface MainChannel {
  /** ¿Se cerró la fase de establecimiento? (no se atienden más anuncios/peticiones) */
  locked(): boolean
  lock(): void
  close(): void
}

/** Lado MAIN: crea el nodo privado, lo anuncia y escucha órdenes solo en él. */
export function openMainChannel(doc: Document, onCommand: (enabled: boolean) => void): MainChannel {
  const node = doc.createElement('span')
  let locked = false
  let requestBudget = 1

  const announce = () => {
    const parent = doc.documentElement
    if (!parent) return
    parent.appendChild(node)
    try {
      node.dispatchEvent(new EventCtor(CHANNEL_ANNOUNCE, { bubbles: true }))
    } finally {
      node.remove()
    }
  }
  const onRequest = () => {
    if (locked || requestBudget <= 0) return
    requestBudget--
    announce()
  }
  const lock = () => {
    if (locked) return
    locked = true
    doc.removeEventListener(CHANNEL_REQUEST, onRequest, true)
  }
  const onEnable = () => {
    lock()
    onCommand(true)
  }
  const onDisable = () => {
    lock()
    onCommand(false)
  }

  node.addEventListener(COMMAND_ENABLE, onEnable)
  node.addEventListener(COMMAND_DISABLE, onDisable)
  node.addEventListener(CHANNEL_ACK, lock)
  doc.addEventListener(CHANNEL_REQUEST, onRequest, true)
  announce()

  return {
    locked: () => locked,
    lock,
    close() {
      lock()
      node.removeEventListener(COMMAND_ENABLE, onEnable)
      node.removeEventListener(COMMAND_DISABLE, onDisable)
      node.removeEventListener(CHANNEL_ACK, lock)
    },
  }
}

export interface IsolatedChannel {
  /** Envía la orden; `false` si el canal no llegó a establecerse (fail-open). */
  send(enabled: boolean): boolean
  established(): boolean
}

/**
 * Lado aislado: toma el nodo del PRIMER anuncio (y deja de escuchar), o pide
 * un re-anuncio si el MAIN corrió antes. Debe llamarse de forma síncrona en
 * `document_start`.
 */
export function openIsolatedChannel(doc: Document): IsolatedChannel {
  let node: EventTarget | null = null

  const onAnnounce = (event: Event) => {
    if (node) return
    const target = event.target
    if (!target || target === doc || !(target instanceof Element)) return
    node = target
    doc.removeEventListener(CHANNEL_ANNOUNCE, onAnnounce, true)
    node.dispatchEvent(new EventCtor(CHANNEL_ACK))
  }
  doc.addEventListener(CHANNEL_ANNOUNCE, onAnnounce, true)
  // El anuncio legítimo llega en document_start. Si al terminar el parseo no
  // llegó (script MAIN no inyectado), se deja de escuchar: un anuncio
  // posterior solo podría venir de la página.
  doc.addEventListener(
    'DOMContentLoaded',
    () => doc.removeEventListener(CHANNEL_ANNOUNCE, onAnnounce, true),
    { once: true },
  )
  // Si el MAIN ya corrió, su anuncio se perdió: se pide uno (síncrono).
  doc.dispatchEvent(new EventCtor(CHANNEL_REQUEST))

  return {
    send(enabled) {
      if (!node) return false
      node.dispatchEvent(new EventCtor(enabled ? COMMAND_ENABLE : COMMAND_DISABLE))
      return true
    },
    established: () => node !== null,
  }
}
