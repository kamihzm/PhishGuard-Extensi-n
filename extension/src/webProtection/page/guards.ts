import { isStructural } from './hider'

/**
 * Contenido legítimo que un candidato a anuncio NUNCA puede contener. Si lo
 * contiene, el candidato no se oculta (fail-open): ocultarlo rompería
 * navegación, búsqueda, formularios o el reproductor.
 */
const PROTECTED_DESCENDANTS = [
  'video',
  'audio',
  'form',
  'input',
  'textarea',
  'select',
  'nav',
  'header',
  'footer',
  'main',
  '[role="navigation"]',
  '[role="search"]',
  '[role="main"]',
  '[contenteditable="true"]',
].join(',')

export function containsProtectedContent(element: Element): boolean {
  if (isStructural(element)) return true
  if (element.matches(PROTECTED_DESCENDANTS)) return true
  return element.querySelector(PROTECTED_DESCENDANTS) !== null
}

/** Enlaces del propio sitio dentro del candidato: indicio de contenido legítimo (menús, listas). */
export function containsFirstPartyLinks(element: Element, isFirstParty: (host: string) => boolean) {
  for (const anchor of element.querySelectorAll('a[href]')) {
    try {
      const host = new URL(anchor.getAttribute('href') ?? '', element.ownerDocument.baseURI)
        .hostname
      if (host && isFirstParty(host)) return true
    } catch {
      // href inválido: no aporta evidencia en ningún sentido.
    }
  }
  return false
}
