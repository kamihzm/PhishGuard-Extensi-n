/**
 * Coordinador de EJECUCIÓN de acciones de navegación entre subsistemas
 * independientes. No decide nada ni conoce las reglas de ninguno:
 *
 * - Phishing Engine: decide si una URL es peligrosa (sin cambios).
 * - Web Protection (Popup Guard): decide si una ventana es un popup
 *   publicitario confirmado.
 * - Este coordinador: si Web Protection está evaluando una ventana recién
 *   abierta (POPUP_PENDING), espera su decisión, como máximo
 *   `MAX_HOLD_MS`, antes de ejecutar la acción del otro subsistema.
 *
 * Política explícita:
 * - ventana confirmada como popup publicitario → la maneja Web Protection
 *   (la cierra) y la acción de phishing NO se ejecuta sobre esa pestaña;
 * - cualquier otro caso (legítima, ambigua, TTL vencido, sin datos, error,
 *   service worker reiniciado) → la acción se ejecuta como siempre.
 *
 * No importa módulos del motor de phishing ni de Web Protection: recibe un
 * proveedor de "retenciones" por inyección.
 */

export type HoldResult = 'handled-by-web-protection' | 'release'

export interface ActionHoldProvider {
  /** `null` si no hay nada que esperar para esa pestaña. */
  hold(tabId: number): Promise<HoldResult> | null
}

/** Tope absoluto de espera (el TTL de POPUP_PENDING es menor). */
export const MAX_HOLD_MS = 3000

let provider: ActionHoldProvider | null = null

export function setActionHoldProvider(next: ActionHoldProvider | null): void {
  provider = next
}

/**
 * Ejecuta `action` salvo que Web Protection confirme que la pestaña es un
 * popup publicitario que ya está manejando. Ante cualquier duda, ejecuta.
 */
export async function executeUnlessHandled(
  tabId: number,
  action: () => Promise<void>,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<'executed' | 'skipped'> {
  let pending: Promise<HoldResult> | null = null
  try {
    pending = provider?.hold(tabId) ?? null
  } catch {
    pending = null
  }
  if (pending) {
    const result = await Promise.race([
      pending.catch((): HoldResult => 'release'),
      wait(MAX_HOLD_MS).then((): HoldResult => 'release'),
    ])
    if (result === 'handled-by-web-protection') return 'skipped'
  }
  await action()
  return 'executed'
}
