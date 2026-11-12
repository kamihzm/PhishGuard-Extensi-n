import { containsFirstPartyLinks, containsProtectedContent } from '../../guards'

/**
 * Detección de anuncios en JKanime a partir de la evidencia medida en
 * Chrome real (docs/web-protection-audit.md, "Capa de página → JKanime").
 * Cada firma exige VARIAS condiciones; si falta una, no se toca nada.
 *
 * 1. Red "AdAngle" (banner JUGABET y capa invisible sobre el reproductor):
 *    los elementos que inyecta llevan ids del propio anunciante,
 *    `adangle-<uuid>-<parte>` y `adangle-pop-iframe-overlay`, dentro de un
 *    contenedor `ins-<uuid>`. `adangle` es una red publicitaria que
 *    EasyList ya bloquea por red (`||adangle.online^`). Cuando su script es
 *    bloqueado por DNR estos nodos no aparecen; el adaptador cubre el caso
 *    en que el script llega igualmente (otro dominio de la misma red).
 *
 * 2. Widget flotante "srcdoc" (bola animada y falso reCAPTCHA "CONFIRMA QUE
 *    NO ERES UN ROBOT"): un `div[data-shb]` con `position:fixed`, z-index en
 *    el máximo del navegador (≥ 2147483000) que contiene un iframe
 *    `srcdoc` SIN `src` (contenido fabricado por el script del anunciante,
 *    imágenes de un host de terceros). No lo cubre ninguna lista.
 *
 * En ambos casos el candidato se descarta si contiene contenido protegido
 * (reproductor, formularios, búsqueda, navegación) o enlaces del propio
 * sitio.
 */

export type JkanimeSignature = 'adangle-placement' | 'floating-srcdoc-widget'

export interface JkanimeDetection {
  element: Element
  signature: JkanimeSignature
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const ADANGLE_PART_ID = new RegExp(`^adangle-(${UUID})-[a-z0-9]+$`, 'i')
const ADANGLE_OVERLAY_ID = 'adangle-pop-iframe-overlay'
/** z-index mínimo para considerar que un elemento "se pone encima de todo". */
export const TOPMOST_Z_INDEX = 2147483000

const isJkanimeHost = (host: string) => host === 'jkanime.net' || host.endsWith('.jkanime.net')

/** El reproductor de JKanime es un iframe del propio sitio (`/jkplayer/…`): nunca se oculta. */
function containsFirstPartyFrame(element: Element): boolean {
  const frames = element.matches('iframe[src]')
    ? [element]
    : [...element.querySelectorAll('iframe[src]')]
  return frames.some((frame) => {
    try {
      return isJkanimeHost(new URL(frame.getAttribute('src') ?? '', frame.baseURI).hostname)
    } catch {
      return false
    }
  })
}

function isSafeToHide(element: Element): boolean {
  return (
    !containsProtectedContent(element) &&
    !containsFirstPartyLinks(element, isJkanimeHost) &&
    !containsFirstPartyFrame(element)
  )
}

function adAngleTarget(element: Element, doc: Document): Element | null {
  if (element.id === ADANGLE_OVERLAY_ID) return element
  const match = ADANGLE_PART_ID.exec(element.id)
  if (!match) return null
  // El contenedor `ins-<uuid>` agrupa las piezas de la misma colocación.
  const container = doc.getElementById(`ins-${match[1]}`)
  return container && container.contains(element) ? container : element
}

function findAdAnglePlacements(doc: Document): Element[] {
  const targets = new Set<Element>()
  for (const element of doc.querySelectorAll('[id^="adangle-"]')) {
    const target = adAngleTarget(element, doc)
    if (target && isSafeToHide(target)) targets.add(target)
  }
  return [...targets]
}

function isTopmostFixed(element: Element, win: Window): boolean {
  const style = win.getComputedStyle(element)
  const z = Number.parseInt(style.zIndex, 10)
  return style.position === 'fixed' && Number.isFinite(z) && z >= TOPMOST_Z_INDEX
}

function findFloatingSrcdocWidgets(doc: Document, win: Window): Element[] {
  const found: Element[] = []
  for (const element of doc.querySelectorAll('div[data-shb]')) {
    if (!isTopmostFixed(element, win)) continue
    if (!element.querySelector('iframe[srcdoc]:not([src])')) continue
    if (isSafeToHide(element)) found.push(element)
  }
  return found
}

export function detectJkanimeAds(doc: Document, win: Window): JkanimeDetection[] {
  return [
    ...findAdAnglePlacements(doc).map((element) => ({
      element,
      signature: 'adangle-placement' as const,
    })),
    ...findFloatingSrcdocWidgets(doc, win).map((element) => ({
      element,
      signature: 'floating-srcdoc-widget' as const,
    })),
  ]
}
