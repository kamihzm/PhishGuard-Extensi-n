/**
 * Normalización para comparar dominios de forma exacta: minúsculas y sin
 * el punto final que a veces queda en un FQDN (`microsoft.com.` es el
 * mismo dominio que `microsoft.com`). Se usa ANTES de cualquier chequeo de
 * coincidencia exacta — nunca se debe marcar `microsoft.com` como
 * impersonation de sí mismo por una diferencia puramente cosmética.
 */
export function canonicalizeDomain(domain: string): string {
  return domain.toLowerCase().replace(/\.$/, '')
}

/**
 * Colapsa patrones que se VEN iguales en una fuente típica de navegador a
 * una forma canónica compartida, para que la distancia de edición entre
 * `rnicrosoft.com` y `microsoft.com` sea 0 en vez de 2-3. Las primeras
 * cuatro sustituciones (`rn`↔`m`, `0`↔`o`, `1`↔`l`, `1`↔`i`) son las
 * originales de esta fase; el resto (leetspeak: `3`,`4`,`@`,`5`,`$`,`7`,
 * `8`,`9`, y los dígrafos `vv`↔`w`, `cl`↔`d`) se agregó tras auditar el
 * proyecto de referencia `Seguridad-master` y MEDIR el impacto antes de
 * integrarlo: 0 falsos positivos nuevos sobre 381 dominios legítimos
 * reales del dataset (con la lista de 23 dominios de referencia ya
 * ampliada) y ganancia de recall real (ej. `p4yp4l.com` pasaba de 0.80 —
 * bajo el umbral 0.82 — a 1.00) — ver
 * `docs/reference-audit-seguridad-master.md`. No se agregaron más
 * combinaciones que las medidas para no arriesgar falsos positivos sin
 * evaluar (ver también `docs/domain-impersonation-detection.md`).
 *
 * Se aplica siempre a AMBOS lados de una comparación (candidato y
 * referencia) con la misma función, para que la equivalencia sea
 * simétrica — no es una lista de "trucos conocidos del atacante", es una
 * clase de equivalencia visual.
 */
export function foldVisualLookalikes(domain: string): string {
  return (
    domain
      .replace(/rn/g, 'm')
      .replace(/vv/g, 'w')
      .replace(/cl/g, 'd')
      // Símbolos/dígitos -> letra, ANTES de la colapsión final de `1`/`i`
      // (línea de abajo): si `!` se plegara a `i` DESPUÉS de esa colapsión,
      // esa `i` nunca terminaría de convertirse en `l` como el resto.
      .replace(/\|/g, 'l')
      .replace(/!/g, 'i')
      .replace(/3/g, 'e')
      .replace(/4/g, 'a')
      .replace(/@/g, 'a')
      .replace(/5/g, 's')
      .replace(/\$/g, 's')
      .replace(/7/g, 't')
      .replace(/8/g, 'b')
      .replace(/9/g, 'g')
      .replace(/0/g, 'o')
      .replace(/[1i]/g, 'l')
  )
}

/** Combina ambos pasos — la forma que realmente se usa para comparar similitud visual. */
export function normalizeForVisualComparison(domain: string): string {
  return foldVisualLookalikes(canonicalizeDomain(domain))
}
