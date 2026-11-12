import { looksSensitive } from './popupClassifier'
import { sameDestination, siteOf } from './navigationIntent'
import type { AdEvidence, HopRecord, UserIntent } from './types'

/**
 * Evidencia COMPORTAMENTAL del Popup Guard, SOLO DIAGNÓSTICA: se evalúa cuando
 * NO hay evidencia de lista y su resultado se adjunta al veredicto SUSPICIOUS y
 * al registro, pero NUNCA confirma ni cierra ventanas (`confirmed` significa
 * "cumple el patrón 3/3", no una acción). Motivo, medido en Chrome real
 * (2026-09-30): OAuth y pagos legítimos abiertos por script desde un enlace del
 * propio sitio, con 3 dominios, 2 redirecciones y rutas neutras, dan 3/3 igual
 * que las cadenas publicitarias; la pestaña origen tampoco navega en ninguno de
 * los dos casos. Independiente del motor de phishing: no usa su score, nivel de
 * riesgo, ML ni reglas.
 *
 * No hay dominios en esta función: todas las señales son estructurales.
 *
 * COMPUERTAS (todas obligatorias; si falla una, no se confirma nada):
 *  A. ventana no solicitada: ninguna intención de pestaña nueva (Ctrl/Cmd/
 *     Shift, clic central, target=_blank) en la ventana de interacción;
 *  D. el usuario pidió EXPLÍCITAMENTE una navegación dentro del mismo sitio
 *     (clic o Enter sobre un enlace con destino conocido del propio sitio) y
 *     ningún salto de la ventana coincide con ese destino;
 *  G. la ventana se creó inmediatamente después de esa interacción
 *     (≤ `MAX_CREATION_DELAY_MS`; en Chrome real: 10–61 ms);
 *  C. el destino inicial es de otro sitio (distinto del origen y del pedido);
 *  B. el origen de la ventana es la pestaña donde ocurrió la interacción
 *     (garantizado por construcción: la intención se consulta a `sourceTabId`);
 *  exclusiones: formularios, destinos de login/OAuth/pago en cualquier salto
 *  de navegación, y excepciones de lista (`@@`).
 *
 * PUNTUACIÓN (0–3; se confirma solo con 3/3):
 *  E. ≥ 2 redirecciones (HTTP 3xx o navegaciones de cliente) en ≤ 5 s;
 *  F. ≥ 3 dominios registrables distintos entre los saltos de NAVEGACIÓN
 *     (inicial, redirecciones de servidor, onBeforeNavigate, commits; no
 *     cuentan peticiones sueltas sin navegación);
 *  H. el dominio final es distinto del inicial.
 *
 * Datos que fijan el umbral (Chrome real, JKanime, diagnóstico H3): las 3
 * ventanas publicitarias SIN evidencia de lista tenían 3 dominios, 2–3
 * redirecciones y destino final distinto (3/3). El caso legítimo más
 * parecido medido (window.open → 302 → sitio legítimo) tiene 2 dominios y
 * 1 redirección (1/3 → no se confirma).
 */
export const MAX_CREATION_DELAY_MS = 1000
export const REDIRECT_WINDOW_MS = 5000
export const MIN_REDIRECTS = 2
export const MIN_DISTINCT_SITES = 3
export const BEHAVIOR_THRESHOLD = 3

export type BehaviorGate =
  | 'unrequested'
  | 'explicit-same-site-navigation'
  | 'created-right-after-interaction'
  | 'cross-site-destination'
  | 'destination-differs-from-requested'
  | 'no-form'
  | 'no-sensitive-hop'
  | 'no-list-exception'

export type BehaviorSignal = 'fast-redirects' | 'registrable-domain-changes' | 'final-site-differs'

export interface BehaviorInput {
  sourceUrl: string
  createdAt: number
  intents: UserIntent[] | null
  hops: HopRecord[]
  evidence: AdEvidence
}

export interface BehaviorResult {
  confirmed: boolean
  score: number
  maxScore: 3
  gatesPassed: BehaviorGate[]
  /** Primera compuerta fallida (motivo por el que no se confirma), si la hay. */
  failedGate: BehaviorGate | null
  signals: BehaviorSignal[]
  redirects: number
  distinctSites: number
  reason: string
}

const isHttp = (url: string) => /^https?:/i.test(url)
const NAVIGATION_VIA = new Set<HopRecord['via']>([
  'initial',
  'navigation',
  'server-redirect',
  'commit',
])

/** Saltos de navegación (sin peticiones sueltas), http(s), en orden. */
export function navigationHops(hops: HopRecord[]): HopRecord[] {
  return hops.filter((h) => NAVIGATION_VIA.has(h.via) && isHttp(h.url))
}

/** Redirecciones: 3xx de servidor + inicios de navegación posteriores al primero, dentro de la ventana. */
export function countRedirects(hops: HopRecord[], createdAt: number): number {
  const inWindow = hops.filter((h) => h.at - createdAt <= REDIRECT_WINDOW_MS)
  const server = inWindow.filter((h) => h.via === 'server-redirect').length
  const navigations = inWindow.filter((h) => h.via === 'navigation').length
  return server + Math.max(0, navigations - 1)
}

/** Secuencia de dominios registrables (sin repeticiones consecutivas) de los saltos de navegación. */
export function siteSequence(hops: HopRecord[]): string[] {
  const out: string[] = []
  for (const h of navigationHops(hops)) {
    const s = siteOf(h.url)
    if (s !== null && out[out.length - 1] !== s) out.push(s)
  }
  return out
}

export function evaluateBehaviorEvidence(input: BehaviorInput): BehaviorResult {
  const gatesPassed: BehaviorGate[] = []
  const result = (
    failedGate: BehaviorGate | null,
    extra: Partial<BehaviorResult> = {},
  ): BehaviorResult => ({
    confirmed: false,
    score: 0,
    maxScore: 3,
    gatesPassed: [...gatesPassed],
    failedGate,
    signals: [],
    redirects: 0,
    distinctSites: 0,
    reason: failedGate ? `compuerta no superada: ${failedGate}` : '',
    ...extra,
  })

  const intents = input.intents ?? []
  const recent = intents.filter(
    (i) => input.createdAt - i.at >= -50 && input.createdAt - i.at <= MAX_CREATION_DELAY_MS,
  )
  // A: nada de pestaña nueva pedida por el usuario.
  if (input.intents === null || recent.some((i) => i.newTab)) return result('unrequested')
  gatesPassed.push('unrequested')
  // Formularios: nunca por comportamiento.
  if (recent.some((i) => i.form || i.kind === 'submit')) return result('no-form')
  gatesPassed.push('no-form')
  // D + G: navegación explícita dentro del mismo sitio, inmediatamente antes.
  const sourceSite = siteOf(input.sourceUrl)
  const explicit = recent.filter(
    (i) =>
      (i.kind === 'click' || i.kind === 'key') &&
      i.expectedUrl !== null &&
      sourceSite !== null &&
      siteOf(i.expectedUrl) === sourceSite,
  )
  if (explicit.length === 0) return result('explicit-same-site-navigation')
  gatesPassed.push('explicit-same-site-navigation', 'created-right-after-interaction')

  const nav = navigationHops(input.hops)
  const first = nav[0]
  if (!first) return result('cross-site-destination')
  // C: destino inicial de otro sitio (distinto del origen y del pedido).
  const firstSite = siteOf(first.url)
  if (firstSite === null || firstSite === sourceSite) return result('cross-site-destination')
  gatesPassed.push('cross-site-destination')
  if (nav.some((h) => explicit.some((i) => sameDestination(h.url, i.expectedUrl!)))) {
    return result('destination-differs-from-requested')
  }
  gatesPassed.push('destination-differs-from-requested')
  // Exclusiones: login/OAuth/pago y excepciones de lista en cualquier salto.
  if (nav.some((h) => looksSensitive(h.url))) return result('no-sensitive-hop')
  gatesPassed.push('no-sensitive-hop')
  if (input.hops.some((h) => isHttp(h.url) && input.evidence.isException(h.url))) {
    return result('no-list-exception')
  }
  gatesPassed.push('no-list-exception')

  // Puntuación.
  const redirects = countRedirects(input.hops, input.createdAt)
  const sites = siteSequence(input.hops)
  const distinctSites = new Set(sites).size
  const signals: BehaviorSignal[] = []
  if (redirects >= MIN_REDIRECTS) signals.push('fast-redirects')
  if (distinctSites >= MIN_DISTINCT_SITES) signals.push('registrable-domain-changes')
  if (sites.length > 1 && sites[sites.length - 1] !== sites[0]) signals.push('final-site-differs')
  const score = signals.length
  const confirmed = score >= BEHAVIOR_THRESHOLD
  return {
    confirmed,
    score,
    maxScore: 3,
    gatesPassed,
    failedGate: null,
    signals,
    redirects,
    distinctSites,
    reason: confirmed
      ? `comportamiento de popup publicitario (${score}/3)`
      : `puntuación insuficiente (${score}/3)`,
  }
}
