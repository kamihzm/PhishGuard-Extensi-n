import { isPlainCssSelector } from '../cosmetic/compileCosmetic'

/**
 * Ocultación reversible de elementos. Nunca se eliminan nodos de la
 * página (sus scripts podrían fallar al no encontrarlos): se marca cada
 * elemento con un atributo propio y UNA sola hoja de estilo con
 * `display:none !important` los oculta. `restoreAll()` quita las marcas
 * y la hoja: el DOM queda exactamente como estaba.
 *
 * Las marcas son cambios de ATRIBUTO, no de hijos: un MutationObserver
 * configurado solo con `childList` no se re-dispara por ellas (sin bucles).
 */

export const HIDDEN_ATTRIBUTE = 'data-phishguard-wp-hidden'
export const STYLE_ELEMENT_ID = 'phishguard-wp-page-layer'

/** Elementos que ningún adaptador ni regla cosmética puede ocultar. */
const STRUCTURAL_TAGS = new Set(['HTML', 'HEAD', 'BODY', 'MAIN'])

export interface Hider {
  /** Oculta el elemento a nombre de `owner`; `false` si es estructural o ya estaba oculto. */
  hide(element: Element, owner: string): boolean
  /** Hoja cosmética (selectores ya validados), reemplaza la anterior. */
  setCosmeticSelectors(selectors: string[]): void
  isOwnNode(node: Node): boolean
  hiddenCount(owner?: string): number
  /** Deshace solo lo que ocultó `owner` (teardown de un adaptador). */
  restoreOwner(owner: string): void
  restoreAll(): void
}

export function isStructural(element: Element): boolean {
  return STRUCTURAL_TAGS.has(element.tagName.toUpperCase())
}

export function createHider(doc: Document): Hider {
  const hidden = new Map<Element, string>()
  let style: HTMLStyleElement | null = null
  let cosmeticCss = ''

  const render = () => {
    const css =
      (hidden.size > 0 ? `[${HIDDEN_ATTRIBUTE}]{display:none!important}\n` : '') + cosmeticCss
    if (!css) {
      style?.remove()
      style = null
      return
    }
    if (!style) {
      style = doc.createElement('style')
      style.id = STYLE_ELEMENT_ID
    }
    if (style.textContent !== css) style.textContent = css
    // `document_start`: puede no existir <head> todavía; <html> sí.
    const parent = doc.head ?? doc.documentElement
    if (style.parentNode !== parent) parent.appendChild(style)
  }

  return {
    hide(element, owner) {
      if (isStructural(element) || hidden.has(element)) return false
      element.setAttribute(HIDDEN_ATTRIBUTE, owner)
      hidden.set(element, owner)
      render()
      return true
    },
    setCosmeticSelectors(selectors) {
      cosmeticCss = selectors.map((s) => `${s}{display:none!important}`).join('\n')
      render()
    },
    isOwnNode: (node) => node === style,
    hiddenCount: (owner) =>
      owner === undefined ? hidden.size : [...hidden.values()].filter((o) => o === owner).length,
    restoreOwner(owner) {
      for (const [element, o] of hidden) {
        if (o !== owner) continue
        element.removeAttribute(HIDDEN_ATTRIBUTE)
        hidden.delete(element)
      }
      render()
    },
    restoreAll() {
      for (const element of hidden.keys()) element.removeAttribute(HIDDEN_ATTRIBUTE)
      hidden.clear()
      cosmeticCss = ''
      render()
    },
  }
}

/**
 * ¿El selector apunta (como sujeto final) a html/head/body/main/:root?
 * No depende del DOM: en `document_start` <body> y <main> aún no existen.
 */
export function targetsStructure(selector: string): boolean {
  return selector
    .split(',')
    .some((part) => /(?:^|[\s>+~])(?:html|head|body|main|:root)\s*$/i.test(part.trim()))
}

/**
 * Selectores cosméticos seguros para la página: CSS válido según el propio
 * navegador y que no seleccionan la estructura raíz. Si una regla llegara a
 * ocultar <html>, <body>, <head> o <main> (p. ej. `body > …` mal escrita en
 * la lista), se descarta ESA regla, no toda la hoja.
 */
export function safeCosmeticSelectors(doc: Document, selectors: string[]): string[] {
  // Doble validación: el parser de selectores (lanza con pseudo-clases
  // desconocidas como `:-abp-has`) y, si existe, `CSS.supports`.
  const probe = doc.createDocumentFragment()
  const supports = (s: string) => {
    try {
      probe.querySelector(s)
      return typeof CSS === 'undefined' || typeof CSS.supports !== 'function'
        ? true
        : CSS.supports(`selector(${s})`)
    } catch {
      return false
    }
  }
  const structural = [doc.documentElement, doc.head, doc.body, doc.querySelector('main')].filter(
    (e): e is HTMLElement => e !== null,
  )
  return selectors.filter((s) => {
    if (/[{};\\]/.test(s) || !isPlainCssSelector(s) || targetsStructure(s) || !supports(s))
      return false
    try {
      return !structural.some((e) => e.matches(s))
    } catch {
      return false
    }
  })
}
