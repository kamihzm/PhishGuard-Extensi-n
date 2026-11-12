import { isAtOpenerEdge, isPastOpenerFarEdge, type WindowBounds } from './popupClassifier'
import type { PopupWindowGeometry, WindowMeasure } from './popupState'

/**
 * Espera máxima a `windows.onCreated` cuando `tabs.onCreated` llegó primero
 * (T8). Chrome suele entregar primero el de la ventana; si no llega a tiempo
 * se mide con `windows.get` y el registro lo dice (`fuente=windows.get`).
 */
export const WINDOW_BIRTH_WAIT_MS = 100
/** Un nacimiento que ninguna pestaña reclamó se descarta pasado este tiempo. */
export const WINDOW_BIRTH_TTL_MS = 10_000

/** `chrome.windows.Window` reducido a lo que se usa. */
export interface WindowSnapshot {
  type?: string
  bounds: WindowBounds | null
}

export interface WindowBirthDeps {
  getWindow(windowId: number): Promise<WindowSnapshot | null>
  getOpenerBounds(openerTabId: number): Promise<WindowBounds | null>
  now(): number
  wait(ms: number): Promise<void>
}

/**
 * Posición de las ventanas `type: popup` AL NACER (T8). `windows.onCreated`
 * trae los límites capturados en el evento; un `windows.get` posterior (tras
 * despertar el service worker y leer la configuración) puede ver la ventana
 * ya crecida y movida por el script del popunder. Solo números en memoria.
 */
export function createWindowBirths(deps: WindowBirthDeps) {
  const births = new Map<number, { bounds: WindowBounds; at: number }>()
  const waiting = new Map<number, Array<() => void>>()

  const prune = (now: number) => {
    for (const [id, birth] of births) if (now - birth.at > WINDOW_BIRTH_TTL_MS) births.delete(id)
  }
  /** Espera el `windows.onCreated` de esa ventana hasta `WINDOW_BIRTH_WAIT_MS`. */
  const waitForBirth = async (windowId: number) => {
    let wake: () => void = () => undefined
    const born = new Promise<void>((resolve) => (wake = resolve))
    waiting.set(windowId, [...(waiting.get(windowId) ?? []), wake])
    await Promise.race([born, deps.wait(WINDOW_BIRTH_WAIT_MS)])
    const rest = (waiting.get(windowId) ?? []).filter((w) => w !== wake)
    if (rest.length > 0) waiting.set(windowId, rest)
    else waiting.delete(windowId)
  }

  return {
    /** `windows.onCreated`: guarda los límites al nacer (solo ventanas popup). */
    onWindowCreated(windowId: number, type: string | undefined, bounds: WindowBounds | null) {
      const now = deps.now()
      prune(now)
      if (type !== 'popup' || !bounds) return
      births.set(windowId, { bounds, at: now })
      for (const wake of waiting.get(windowId) ?? []) wake()
    },

    onWindowRemoved(windowId: number) {
      births.delete(windowId)
    },

    /**
     * Geometría de la ventana de una pestaña nueva con el tamaño de su
     * contenido al crearse (`tab.width/height`). Orden de los eventos:
     * - `windows.onCreated` antes que `tabs.onCreated` (lo habitual): se usa el
     *   nacimiento guardado, sin `windows.get`;
     * - `tabs.onCreated` primero: `windows.get` dice si es una popup y se
     *   espera su `windows.onCreated` hasta `WINDOW_BIRTH_WAIT_MS`; si no
     *   llega, se usa la posición de `windows.get` (tardía).
     * `null` si no es una ventana popup o no se pudo leer (fail-open). Sin la
     * ventana de origen, `atEdge`/`atFarEdge` quedan sin medir.
     */
    async measure(
      tab: { windowId: number; width: number; height: number },
      openerTabId: number,
      tabCreatedAt: number,
    ): Promise<PopupWindowGeometry | null> {
      const stored = births.get(tab.windowId)
      let birth = stored && deps.now() - stored.at <= WINDOW_BIRTH_TTL_MS ? stored : undefined
      let late: WindowSnapshot | null = null
      let lateAt = 0
      if (!birth) {
        late = await deps.getWindow(tab.windowId).catch(() => null)
        lateAt = deps.now()
        if (late?.type !== 'popup') return null
        if (births.get(tab.windowId) === stored) await waitForBirth(tab.windowId)
        birth = births.get(tab.windowId) === stored ? undefined : births.get(tab.windowId)
      }
      births.delete(tab.windowId)
      const opener = await deps.getOpenerBounds(openerTabId).catch(() => null)
      const popup = birth?.bounds ?? late?.bounds ?? null
      const measure: WindowMeasure = {
        source: birth ? 'windows.onCreated' : 'windows.get',
        delayMs: (birth ? birth.at : lateAt) - tabCreatedAt,
        ...(popup ? { popup } : {}),
        ...(opener ? { opener } : {}),
      }
      const edges =
        popup && opener
          ? { atEdge: isAtOpenerEdge(popup, opener), atFarEdge: isPastOpenerFarEdge(popup, opener) }
          : {}
      return { type: 'popup', width: tab.width, height: tab.height, ...edges, measure }
    },
  }
}
