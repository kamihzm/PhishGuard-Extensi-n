import { ICANN_EXACT, ICANN_EXCEPTION, ICANN_WILDCARD } from './publicSuffixes'

/**
 * Sufijo público según la sección ICANN de la Public Suffix List
 * (`publicSuffixes.ts`, generada por `tools/psl/buildIcannSuffixes.ts`).
 * Algoritmo de https://publicsuffix.org/list/: una regla de excepción
 * prevalece; si no, la regla más larga entre exactas y comodines; si ninguna
 * coincide, la regla por defecto `*` (la última etiqueta).
 *
 * Solo ICANN: los sufijos PRIVADOS (`github.io`, `pages.dev`…) NO cuentan
 * como sufijo, así `usuario.github.io` sigue teniendo `github.io` como
 * dominio registrable y las plataformas las maneja `HOSTING_PLATFORMS`.
 */
const EXACT = new Set(ICANN_EXACT.split(','))
const WILDCARD = new Set(ICANN_WILDCARD.split(','))
const EXCEPTION = new Set(ICANN_EXCEPTION.split(','))

/** Cantidad de etiquetas (contando desde la derecha) que forman el sufijo público. */
export function publicSuffixLabelCount(labels: readonly string[]): number {
  for (let i = 0; i < labels.length; i++) {
    if (EXCEPTION.has(labels.slice(i).join('.'))) return labels.length - i - 1
  }
  for (let i = 0; i < labels.length; i++) {
    const candidate = labels.slice(i).join('.')
    const parent = labels.slice(i + 1).join('.')
    if (EXACT.has(candidate) || (i + 1 < labels.length && WILDCARD.has(parent)))
      return labels.length - i
  }
  return 1
}
