import { evaluateBehaviorEvidence } from './behaviorEvidence'
import { sameDestination, siteOf } from './navigationIntent'
import type { AdEvidence, Classification, HopRecord, PopupSignal, UserIntent } from './types'

/**
 * Clasificación de ventanas nuevas y de redirecciones. Funciones puras.
 *
 * Regla central: una sola señal NUNCA basta. CONFIRMED_* exige a la vez:
 * 1. que el usuario no la pidiera (sin intención de pestaña nueva hacia ese
 *    destino / sin intención de ir a ese destino);
 * 2. destino de OTRO sitio (distinto del origen y del destino pedido);
 * 3. evidencia de lista autorizada (EasyList) en algún salto de la cadena,
 *    antes de cualquier destino con aspecto de login, OAuth o pago; o, solo
 *    para ventanas nuevas, la técnica del popunder (T6, `isPopunderWindow`):
 *    ventana `type: popup` diminuta que nació en about:blank.
 * Si falta información (intención desconocida) o alguna señal: SUSPICIOUS
 * o LEGITIMATE, y el Popup Guard NO actúa.
 */

/** Ventana en la que una interacción se considera la causa de una ventana nueva. */
export const INTERACTION_WINDOW_MS = 2000

const SENSITIVE_HOST =
  /^(?:accounts?|login|signin|sso|auth|oauth|id|secure|checkout|pay|payments?|billing)\./i
const SENSITIVE_PATH =
  /\/(?:oauth2?|authorize|auth|login|log-in|signin|sign-in|sso|saml|openid|checkout|payment|pay|billing|cart)(?:[/?#.]|$)/i

/** Destinos que nunca se cierran ni se revierten automáticamente (login, OAuth, pagos). */
export function looksSensitive(url: string): boolean {
  try {
    const u = new URL(url)
    return SENSITIVE_HOST.test(u.hostname) || SENSITIVE_PATH.test(u.pathname)
  } catch {
    return false
  }
}

const httpOnly = (urls: string[]) =>
  urls.filter((u) => {
    try {
      const p = new URL(u).protocol
      return p === 'http:' || p === 'https:'
    } catch {
      return false
    }
  })

/**
 * Índice del primer salto con evidencia de lista, si aparece ANTES de
 * cualquier destino sensible y no está cubierto por una excepción.
 */
export function evidenceIndex(chain: string[], evidence: AdEvidence): number {
  for (let i = 0; i < chain.length; i++) {
    const url = chain[i]!
    if (looksSensitive(url) || evidence.isException(url)) return -1
    if (evidence.isAdUrl(url)) return i
  }
  return -1
}

export interface PopupInput {
  sourceUrl: string
  /** URLs http(s) por las que pasó la ventana nueva, en orden (inicial, redirecciones, commits). */
  chain: string[]
  createdAt: number
  /** null = no se pudo consultar la intención (fail-open: no se actúa). */
  intents: UserIntent[] | null
  /** Otras ventanas abiertas por la misma pestaña en la misma interacción. */
  siblings: number
  evidence: AdEvidence
  /** Saltos con procedencia (para la evidencia comportamental). Opcional. */
  hops?: HopRecord[]
  /** Ventana `type: popup` que contiene la pestaña (T6). Ausente si no se pudo leer. */
  window?: PopupWindowInfo
}

/**
 * Ventana que contiene la pestaña nueva, leída al crearse (antes de que la
 * página pueda agrandarla), más cómo nació su documento.
 */
export interface PopupWindowInfo {
  /** `chrome.windows.Window.type`. */
  type: string
  /** Área de contenido de la pestaña (`tab.width/height`), sin barras del navegador. */
  width: number
  height: number
  /** El primer documento confirmado fue about:blank: se abrió vacía y el script la navegó después. */
  bornBlank: boolean
  /** Nació pegada o fuera del borde de la ventana que la abrió; `undefined` si no se pudo medir. */
  atEdge?: boolean
  /** Nació en o más allá del borde derecho o inferior de esa ventana (T7); `undefined` si no se pudo medir. */
  atFarEdge?: boolean
}

/**
 * Tamaño máximo (área de contenido) de una ventana "diminuta" (T6, animeyt.cc
 * 2026-10-15). Chrome agranda `width=5,height=5` a su mínimo: medido 131×110
 * con ventana y 133×99 sin ella; una ventana OAuth de 516×735 da 520×744.
 * Deben cumplirse AMBAS dimensiones.
 */
export const POPUNDER_MAX_WIDTH = 200
export const POPUNDER_MAX_HEIGHT = 150
/**
 * Por debajo del mínimo de Chrome (~131×99) el tamaño aún no está calculado
 * (p. ej. 0×0): no prueba que la ventana sea diminuta.
 */
export const POPUNDER_MIN_SIZE = 50
/** El script del popunder navega la ventana enseguida (medido: ~1,1 s); después es otra cosa. */
export const POPUNDER_NAV_WINDOW_MS = 3000
/**
 * Margen para "pegada al borde" de la ventana que la abrió. Medido en
 * animeyt.cc: el popunder nace en `left=1366` (ancho de la pantalla), a 27 px
 * del borde derecho de la ventana que lo abrió (1383 px de ancho en x=10).
 */
export const POPUNDER_EDGE_PX = 50

/** Posición y tamaño exteriores de una ventana (`chrome.windows.Window`). */
export interface WindowBounds {
  left: number
  top: number
  width: number
  height: number
}

/**
 * ¿La popup nació pegada o fuera del borde de la ventana que la abrió? (T6).
 * Se compara con esa ventana porque el service worker no conoce el tamaño de
 * la pantalla. Una ventana legítima nace sobre la página (centrada o en
 * cascada); el popunder se esconde en el borde y se agranda al navegar.
 */
export function isAtOpenerEdge(popup: WindowBounds, opener: WindowBounds): boolean {
  return (
    popup.left >= opener.left + opener.width - POPUNDER_EDGE_PX ||
    popup.top >= opener.top + opener.height - POPUNDER_EDGE_PX ||
    popup.left + popup.width <= opener.left + POPUNDER_EDGE_PX ||
    popup.top + popup.height <= opener.top + POPUNDER_EDGE_PX
  )
}

/**
 * Banda del borde lejano (T8): el borde de la popup queda a ±50 px del de la
 * ventana que la abrió, o la popup entera queda más allá (regla de T7).
 */
const nearOrPast = (start: number, size: number, openerEnd: number) =>
  Math.abs(start + size - openerEnd) <= POPUNDER_EDGE_PX || start >= openerEnd - POPUNDER_EDGE_PX

/**
 * ¿La popup nació pegada al borde derecho o inferior de la ventana que la
 * abrió, o entera más allá? (T7, T8). Solo esto levanta el veto de un clic en
 * un control y cuenta como "nacida en el borde" en la relectura.
 * Chrome real mete la ventana dentro de la pantalla: con la ventana del
 * usuario maximizada en (-7,-7) 1552×832 y pantalla de 1536, un popunder
 * pedido en `left=1536` queda en `left=1418`, ancho 146 (borde derecho 1564,
 * 19 px del 1545 del opener) y su borde izquierdo nunca alcanza el derecho del
 * opener. Es una banda y no "borde derecho >= ...": una popup centrada en la
 * pantalla CRUZA el borde de una ventana anclada a la mitad izquierda
 * (borde 841 contra 768) y no debe contar. Una ventana legítima en
 * `left=0,top=0` cumple los bordes izquierdo/superior de `isAtOpenerEdge`
 * cuando la ventana del usuario no está maximizada: esos no cuentan.
 */
export function isPastOpenerFarEdge(popup: WindowBounds, opener: WindowBounds): boolean {
  return (
    nearOrPast(popup.left, popup.width, opener.left + opener.width) ||
    nearOrPast(popup.top, popup.height, opener.top + opener.height)
  )
}

/** ¿Área de contenido diminuta? (solo cota superior: también para releerla antes de cerrar). */
export function isTinySize(width: number, height: number): boolean {
  return width <= POPUNDER_MAX_WIDTH && height <= POPUNDER_MAX_HEIGHT
}

/** Primer salto http(s) de la ventana. */
function firstHttpHop(input: PopupInput): HopRecord | undefined {
  return (input.hops ?? []).find((h) => httpOnly([h.url]).length > 0)
}

/**
 * Condiciones de la técnica del popunder (popup diminuta, abierta vacía y
 * navegada enseguida por script) que NO se cumplen, en orden fijo; vacía si
 * se cumplen todas. Se usa para decidir y para el registro (T7: saber por
 * qué no se cerró). El clic en un control (botón de chat, enlace "#") veta la
 * regla salvo que la ventana haya nacido en el borde derecho o inferior de la
 * que la abrió (T7, `isPastOpenerFarEdge`: el popunder real se dispara con el
 * botón de play o de episodio); sin medición, el veto se mantiene (fail-open).
 */
function popunderMisses(
  w: PopupWindowInfo,
  input: PopupInput,
  recent: UserIntent[],
  firstParty: string[],
  target: string[],
): string[] {
  const miss: string[] = []
  if (w.type !== 'popup') miss.push(`type=${w.type}`)
  if (!w.bornBlank) miss.push('bornBlank=false')
  if (
    w.width < POPUNDER_MIN_SIZE ||
    w.height < POPUNDER_MIN_SIZE ||
    !isTinySize(w.width, w.height)
  ) {
    miss.push(`size=${w.width}x${w.height}`)
  }
  const hop = firstHttpHop(input)
  if (!hop) miss.push('nav=none')
  else if (hop.at - input.createdAt > POPUNDER_NAV_WINDOW_MS) miss.push('nav>3s')
  if (firstParty.length > 0) miss.push('first-party-redirect')
  if (recent.some((i) => i.control === true) && w.atFarEdge !== true) {
    miss.push(`control(atFarEdge=${w.atFarEdge === false ? 'false' : 'unmeasured'})`)
  }
  if (target.some((u) => looksSensitive(u) || input.evidence.isException(u))) {
    miss.push('sensitive-or-exception')
  }
  return miss
}

/**
 * Tramo de redirección de la ventana: URLs http(s) de sus saltos hasta el primer
 * commit inclusive. Lo posterior ocurre dentro de un documento ya cargado (p. ej.
 * un clic del usuario en la ventana) y no es una redirección.
 */
function redirectSegment(hops: HopRecord[]): string[] {
  const out: string[] = []
  for (const h of hops) {
    if (httpOnly([h.url]).length > 0 && out[out.length - 1] !== h.url) out.push(h.url)
    if (h.via === 'commit') break
  }
  return out
}

export function classifyPopup(input: PopupInput): Classification {
  const chain = httpOnly(input.chain)
  const signals: PopupSignal[] = []
  const first = chain[0]
  if (!first) return { verdict: 'LEGITIMATE', signals }
  const sourceSite = siteOf(input.sourceUrl)
  // URLs que deciden el veredicto. Si la ventana empieza en el propio sitio, solo
  // cuenta su redirección inicial cuando sale de él (P3: redirector propio que
  // responde 302 hacia una red publicitaria); `firstParty` son los saltos previos
  // del propio sitio. Sin saltos registrados, o sin salir del sitio: legítima.
  let target = chain
  let firstParty: string[] = []
  if (sourceSite !== null && siteOf(first) === sourceSite) {
    const segment = redirectSegment(input.hops ?? [])
    const exit = segment.findIndex((u) => siteOf(u) !== sourceSite)
    if (exit < 0) return { verdict: 'LEGITIMATE', signals: ['same-site'] }
    target = segment.slice(exit)
    firstParty = segment.slice(0, exit)
    signals.push('first-party-redirect')
  }
  if (input.intents === null) {
    return { verdict: 'SUSPICIOUS', signals: [...signals, 'intent-unknown'] }
  }

  const recent = input.intents.filter(
    (i) => input.createdAt - i.at >= -50 && input.createdAt - i.at <= INTERACTION_WINDOW_MS,
  )
  // Redirector propio sin interacción registrada (menú contextual "abrir en pestaña
  // nueva", clic dentro de un iframe): no hay forma de saber si la pidió el usuario.
  if (firstParty.length > 0 && recent.length === 0) {
    return { verdict: 'SUSPICIOUS', signals: [...signals, 'no-recent-intent'] }
  }
  // El usuario pidió pestaña nueva: si indicó destino, solo esa ventana es suya;
  // si no hay destino conocido (p. ej. clic central en un botón), se permite todo.
  for (const intent of recent) {
    if (!intent.newTab) continue
    if (intent.expectedUrl === null)
      return { verdict: 'LEGITIMATE', signals: ['user-new-tab-intent'] }
    if (chain.some((u) => sameDestination(u, intent.expectedUrl!))) {
      return {
        verdict: 'LEGITIMATE',
        signals: ['user-new-tab-intent', 'matches-expected-destination'],
      }
    }
  }
  // Clic en un enlace al redirector propio (p. ej. `/go/tienda` abierto con
  // window.open): el destino externo es el que pidió el usuario.
  if (
    recent.some(
      (i) => i.expectedUrl !== null && firstParty.some((u) => sameDestination(u, i.expectedUrl!)),
    )
  ) {
    return { verdict: 'LEGITIMATE', signals: [...signals, 'intended-destination'] }
  }
  signals.push('unrequested')

  const expectedSites = new Set(
    recent
      .map((i) => (i.expectedUrl ? siteOf(i.expectedUrl) : null))
      .filter((s): s is string => s !== null),
  )
  const firstSite = siteOf(target[0]!)
  if (firstSite === null || expectedSites.has(firstSite)) {
    return { verdict: 'LEGITIMATE', signals: [...signals, 'intended-destination'] }
  }
  signals.push('cross-site')
  if (input.siblings > 0) signals.push('multiple-popups')

  const w = input.window
  const miss = w ? popunderMisses(w, input, recent, firstParty, target) : null
  const diagnosis = miss && miss.length > 0 ? { popunderMiss: miss } : {}
  if (looksSensitive(target[0]!) || firstParty.some(looksSensitive))
    return { verdict: 'SUSPICIOUS', signals: [...signals, 'sensitive-destination'], ...diagnosis }
  // 1) Evidencia de lista (ruta original; una excepción en el redirector propio la anula).
  if (
    !firstParty.some((u) => input.evidence.isException(u)) &&
    evidenceIndex(target, input.evidence) >= 0
  ) {
    return { verdict: 'CONFIRMED_POPUP_AD', signals: [...signals, 'list-evidence'] }
  }
  // 2) Técnica del popunder (T6), sin depender de dominios: además de lo ya
  //    exigido arriba (intención conocida, sin pestaña nueva pedida, destino de
  //    otro sitio distinto del pedido y sin aspecto de login/pago), la ventana
  //    es una popup diminuta que nació en about:blank y el script la navegó
  //    enseguida (`popunderMisses`). Un clic en un control que puede abrir
  //    ventanas (botón de chat, enlace "#") la veta salvo que la ventana haya
  //    nacido en el borde derecho o inferior de la que la abrió (T7). Solo cadenas que salen
  //    directamente del sitio; un salto con excepción de lista la anula.
  if (miss && miss.length === 0) {
    return { verdict: 'CONFIRMED_POPUP_AD', signals: [...signals, 'popunder-window'] }
  }
  // 3) Sin evidencia de lista: la evidencia comportamental se evalúa SOLO como
  //    diagnóstico (se adjunta al veredicto y al registro) y NUNCA confirma.
  //    Validación en Chrome real (2026-09-30): flujos legítimos de OAuth y pago
  //    abiertos por script desde un enlace del propio sitio, con 3 dominios y
  //    2 redirecciones sin palabras sensibles en la ruta, puntúan 3/3 igual que
  //    las cadenas publicitarias de JKanime; ninguna señal disponible los
  //    separa sin falsos positivos → ante ambigüedad, se permite.
  if (input.hops) {
    const behavior = evaluateBehaviorEvidence({
      sourceUrl: input.sourceUrl,
      createdAt: input.createdAt,
      intents: input.intents,
      hops: input.hops,
      evidence: input.evidence,
    })
    return { verdict: 'SUSPICIOUS', signals, behavior, ...diagnosis }
  }
  // 4) Ninguna evidencia suficiente.
  return { verdict: 'SUSPICIOUS', signals, ...diagnosis }
}

/**
 * ¿La ventana entra en POPUP_PENDING? (esperar evidencia un tiempo acotado
 * antes de dejar actuar a otros subsistemas sobre esa pestaña). Exige:
 * - intención conocida con una interacción reciente del usuario en el origen;
 * - que el usuario no pidiera pestaña nueva hacia ese destino;
 * - destino de otro sitio y distinto del pedido, sin aspecto de login/pago.
 * No congela la ventana (sigue cargando): solo difiere acciones de otros
 * subsistemas mientras se reúne evidencia.
 */
export function isPendingCandidate(result: Classification, input: PopupInput): boolean {
  if (input.intents === null) return false
  const recent = input.intents.filter(
    (i) => input.createdAt - i.at >= -50 && input.createdAt - i.at <= INTERACTION_WINDOW_MS,
  )
  if (recent.length === 0) return false
  if (httpOnly(input.chain).length === 0) {
    // Aún sin destino http(s) (p. ej. about:blank): candidata si no pidió pestaña nueva.
    return !recent.some((i) => i.newTab)
  }
  return (
    result.verdict === 'SUSPICIOUS' &&
    result.signals.includes('unrequested') &&
    result.signals.includes('cross-site') &&
    !result.signals.includes('sensitive-destination') &&
    // Redirector propio: se libera al registrarse, como cualquier ventana del sitio.
    !result.signals.includes('first-party-redirect')
  )
}

/** Tipos de transición que expresan navegación voluntaria del usuario: nunca se revierten. */
const USER_TRANSITIONS = new Set([
  'typed',
  'auto_bookmark',
  'reload',
  'keyword',
  'keyword_generated',
  'start_page',
  'form_submit',
  'auto_toplevel',
  'manual_subframe',
])
const USER_QUALIFIERS = new Set(['forward_back', 'from_address_bar'])

export interface RedirectInput {
  previousUrl: string
  /** Saltos de la navegación: URL inicial, redirecciones de servidor y URL confirmada. */
  chain: string[]
  transitionType: string
  transitionQualifiers: string[]
  intents: UserIntent[] | null
  startedAt: number
  evidence: AdEvidence
}

export function classifyRedirect(input: RedirectInput): Classification {
  const chain = httpOnly(input.chain)
  const target = chain[chain.length - 1]
  if (!target) return { verdict: 'LEGITIMATE', signals: [] }
  if (
    USER_TRANSITIONS.has(input.transitionType) ||
    input.transitionQualifiers.some((q) => USER_QUALIFIERS.has(q))
  ) {
    return { verdict: 'LEGITIMATE', signals: ['user-navigation-type'] }
  }
  const previousSite = siteOf(input.previousUrl)
  if (previousSite !== null && chain.every((u) => siteOf(u) === previousSite)) {
    return { verdict: 'LEGITIMATE', signals: ['same-site'] }
  }
  if (input.intents === null) return { verdict: 'SUSPICIOUS', signals: ['intent-unknown'] }
  const recent = input.intents.filter(
    (i) => input.startedAt - i.at >= -50 && input.startedAt - i.at <= INTERACTION_WINDOW_MS,
  )
  // Si el usuario pidió ese destino (o su sitio), es su navegación.
  if (
    recent.some(
      (i) =>
        i.form ||
        (i.expectedUrl !== null &&
          (chain.some((u) => sameDestination(u, i.expectedUrl!)) ||
            siteOf(i.expectedUrl) === siteOf(chain[0]!))),
    )
  ) {
    return { verdict: 'LEGITIMATE', signals: ['intended-destination'] }
  }
  const signals: PopupSignal[] = ['redirect-without-intent', 'cross-site']
  if (looksSensitive(target) || looksSensitive(chain[0]!)) {
    return { verdict: 'SUSPICIOUS', signals: [...signals, 'sensitive-destination'] }
  }
  if (evidenceIndex(chain, input.evidence) >= 0) {
    return { verdict: 'CONFIRMED_REDIRECT_AD', signals: [...signals, 'list-evidence'] }
  }
  return { verdict: 'SUSPICIOUS', signals }
}
