/**
 * Técnica que produjo la mejor coincidencia contra un dominio de
 * referencia. `edit-distance` cubre inserción/eliminación/sustitución/
 * transposición de caracteres (Damerau-Levenshtein) tal cual está escrito
 * el dominio. `visual-substitution` significa que la coincidencia solo
 * aparece (o mejora claramente) después de normalizar patrones que se ven
 * iguales a simple vista (`rn`→`m`, `0`→`o`, `1`/`i`→`l`) — es la técnica
 * que detecta específicamente casos como `rnicrosoft.com`. `homoglyph`
 * (2026-10-01): el dominio usa Punycode y, decodificado y plegado con la tabla
 * oficial de confundibles de Unicode (UTS #39), se lee como una marca de
 * referencia (`pаypal.com` con `а` cirílica) — ver `homoglyph.ts`.
 */
export type ImpersonationTechnique = 'edit-distance' | 'visual-substitution' | 'homoglyph'

/**
 * Resultado explicable de comparar un dominio registrable contra la lista
 * de dominios de referencia (`referenceDomains.ts`). Nunca es un simple
 * booleano: `similarityScore` y `referenceDomain` son necesarios para que
 * cualquier consumidor (regla, feature de ML, o un futuro mensaje al
 * usuario) pueda explicar la decisión, no solo mostrarla.
 */
export interface ImpersonationResult {
  isImpersonation: boolean
  /** Dominio de referencia más parecido, o `null` si no hay ninguna coincidencia relevante. */
  referenceDomain: string | null
  /** 0 (sin parecido) a 1 (idéntico tras normalizar). */
  similarityScore: number
  technique: ImpersonationTechnique | null
}
