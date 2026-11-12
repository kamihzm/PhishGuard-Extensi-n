import type { WindowBounds } from './popupClassifier'
import type { HopRecord, UserIntent } from './types'

/**
 * Estado EN MEMORIA del Popup Guard (service worker). Nada se persiste ni
 * se registra: las URLs solo viven aquí mientras dura la observación.
 */
export const OBSERVATION_TTL_MS = 10_000
/** Tiempo mínimo entre dos acciones automáticas sobre la misma pestaña (evita bucles). */
export const ACTION_COOLDOWN_MS = 15_000

export interface PopupObservation {
  /**
   * Qué evento la registró: `navigation-target` (`onCreatedNavigationTarget`,
   * lo habitual), `tab-created` (`tabs.onCreated`, experimento
   * `popupGuardTabCreated`) o `popup-window` (`tabs.onCreated` de una
   * ventana `type: popup`, T6). Solo informativo (registros y medición).
   */
  origin?: 'navigation-target' | 'tab-created' | 'popup-window'
  tabId: number
  sourceTabId: number
  /**
   * Marco que abrió la ventana (`onCreatedNavigationTarget.sourceFrameId`);
   * -1 si solo se vio por `tabs.onCreated` (marco desconocido).
   */
  sourceFrameId?: number
  sourceUrl: string
  createdAt: number
  chain: string[]
  /** Saltos con procedencia (evidencia comportamental). Solo en memoria. */
  hops: HopRecord[]
  /** undefined = consulta en curso; null = no se pudo consultar. */
  intents: UserIntent[] | null | undefined
  siblings: number
  /** Ventana `type: popup` que la contiene, con el tamaño que Chrome reportó al crearla (T6). */
  window?: PopupWindowGeometry
  decided: boolean
  /** Último veredicto registrado (para no repetir el mismo registro). */
  lastVerdict?: string
  /** Resumen de la última evaluación comportamental (solo señales/compuerta; sin URLs). */
  lastBehavior?: string
  /** T7: condiciones de `popunder-window` que fallaron en la última evaluación (sin URLs). */
  lastPopunderMiss?: string
  /**
   * Ciclo de coordinación con otras acciones sobre esta pestaña:
   * - `evaluating`: aún sin intención/primer veredicto;
   * - `pending` (POPUP_PENDING): ventana no solicitada tras un clic, hacia otro
   *   sitio y distinta del destino pedido; se espera evidencia hasta el TTL;
   * - `handled`: confirmada y cerrada por Web Protection;
   * - `released`: legítima, ambigua o TTL vencido → las demás acciones siguen.
   */
  hold: 'evaluating' | 'pending' | 'handled' | 'released'
  waiters: Array<(result: HoldResult) => void>
  cancelTimer?: () => void
}

/**
 * Ventana de la pestaña al crearse, antes de que la página pueda cambiar su
 * tamaño: `type` de `chrome.windows.Window` y tamaño del área de contenido
 * (`chrome.tabs.Tab.width/height`, sin barras del navegador).
 */
export interface PopupWindowGeometry {
  type: string
  width: number
  height: number
  /**
   * Nació pegada o fuera del borde de la ventana que la abrió
   * (`isAtOpenerEdge`). `undefined` si no se pudo medir.
   */
  atEdge?: boolean
  /**
   * T7: nació en o más allá de su borde derecho o inferior
   * (`isPastOpenerFarEdge`; solo levanta el veto de un clic en un control).
   * `undefined` si no se pudo medir.
   */
  atFarEdge?: boolean
  /** T8: números usados para `atEdge`/`atFarEdge` (solo diagnóstico; sin URLs). */
  measure?: WindowMeasure
}

/**
 * De dónde salió la posición de la popup: `windows.onCreated` (límites al
 * nacer) o `windows.get` (lectura tardía, la ventana pudo haber crecido), y
 * cuántos ms después de `tabs.onCreated` (negativo: el evento de la ventana
 * llegó antes). Se mide con el reloj del service worker al correr cada
 * listener, no con la hora del evento en Chrome: si el worker estaba dormido,
 * ambos incluyen el arranque y la demora real puede ser mayor. Sin
 * `popup`/`opener`: no se pudo leer.
 */
export interface WindowMeasure {
  source: 'windows.onCreated' | 'windows.get'
  delayMs: number
  popup?: WindowBounds
  opener?: WindowBounds
}

/** Resultado que Web Protection entrega al coordinador de acciones. */
export type HoldResult = 'handled-by-web-protection' | 'release'

/**
 * TTL de POPUP_PENDING, medido en Chrome real (JKanime, 32 ventanas): la
 * evidencia de lista llegó entre 125 y 1764 ms después de abrirse la ventana.
 * 2500 ms cubre el máximo observado con margen; después se libera.
 */
export const POPUP_PENDING_TTL_MS = 2500

export interface NavigationContext {
  /** `null` si no se pudo establecer (p. ej. service worker reiniciado sin respaldo). */
  previousUrl: string | null
  /**
   * `true` si la página anterior salió de la memoria o de `tabs.get` con
   * navegación pendiente: el documento original seguía vivo y la consulta de
   * intención la respondió él (no el documento nuevo).
   */
  liveDocument: boolean
}

export interface PendingNavigation {
  tabId: number
  /** Página anterior y si el documento original seguía vivo al empezar la navegación. */
  context: Promise<NavigationContext>
  /** "Anuncios" activo; se resuelve al decidir, no antes de registrar la navegación. */
  enabled: Promise<boolean>
  startedAt: number
  chain: string[]
  intents: Promise<UserIntent[] | null>
}

export interface PopupState {
  observations: Map<number, PopupObservation>
  navigations: Map<number, PendingNavigation>
  /** Última URL http(s) confirmada del marco principal de cada pestaña. */
  lastUrl: Map<number, string>
  /**
   * ¿El PRIMER documento confirmado del marco principal fue about:blank? (T6).
   * `window.open(url)` confirma directamente `url`; un popunder abre una
   * ventana vacía (about:blank confirmado) y la navega después por script.
   */
  bornBlank: Map<number, boolean>
  canAct(tabId: number, now: number): boolean
  recordAction(tabId: number, now: number): void
  siblingsOf(sourceTabId: number, now: number, windowMs: number): number
  prune(now: number): void
  forget(tabId: number): void
}

export const MAX_CHAIN = 20

export function createPopupState(): PopupState {
  const observations = new Map<number, PopupObservation>()
  const navigations = new Map<number, PendingNavigation>()
  const lastUrl = new Map<number, string>()
  const bornBlank = new Map<number, boolean>()
  const actions = new Map<number, number>()
  return {
    observations,
    navigations,
    lastUrl,
    bornBlank,
    canAct: (tabId, now) => now - (actions.get(tabId) ?? -Infinity) >= ACTION_COOLDOWN_MS,
    recordAction: (tabId, now) => void actions.set(tabId, now),
    siblingsOf(sourceTabId, now, windowMs) {
      let n = 0
      for (const o of observations.values()) {
        if (o.sourceTabId === sourceTabId && now - o.createdAt <= windowMs) n++
      }
      return n
    },
    prune(now) {
      for (const [id, o] of observations)
        if (now - o.createdAt > OBSERVATION_TTL_MS) observations.delete(id)
      for (const [id, n] of navigations)
        if (now - n.startedAt > OBSERVATION_TTL_MS) navigations.delete(id)
      for (const [id, t] of actions) if (now - t > ACTION_COOLDOWN_MS) actions.delete(id)
    },
    forget(tabId) {
      observations.delete(tabId)
      navigations.delete(tabId)
      lastUrl.delete(tabId)
      bornBlank.delete(tabId)
      actions.delete(tabId)
    },
  }
}
