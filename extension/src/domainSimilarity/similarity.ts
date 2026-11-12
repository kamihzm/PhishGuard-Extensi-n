/**
 * Distancia de Damerau-Levenshtein: cantidad mínima de ediciones
 * (inserción, eliminación, sustitución o transposición de dos caracteres
 * ADYACENTES) para convertir `a` en `b`. Se eligió sobre Levenshtein
 * simple porque la transposición es un error de tipeo/typosquatting real
 * y frecuente (`micikrosoft` → `microsoft`, `paypal` → `paypla`) que
 * Levenshtein cuenta como 2 ediciones en vez de 1, subestimando el
 * parecido. Costo O(n·m) — trivial para nombres de dominio (decenas de
 * caracteres) comparados contra una lista de referencia de ~13 entradas.
 */
export function damerauLevenshteinDistance(a: string, b: string): number {
  const lenA = a.length
  const lenB = b.length
  if (lenA === 0) return lenB
  if (lenB === 0) return lenA

  // Matriz (lenA+1) x (lenB+1); d[i][j] = distancia entre a[0..i) y b[0..j).
  const d: number[][] = Array.from({ length: lenA + 1 }, () => new Array<number>(lenB + 1).fill(0))
  for (let i = 0; i <= lenA; i++) d[i]![0] = i
  for (let j = 0; j <= lenB; j++) d[0]![j] = j

  for (let i = 1; i <= lenA; i++) {
    for (let j = 1; j <= lenB; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let value = Math.min(
        d[i - 1]![j]! + 1, // eliminación
        d[i]![j - 1]! + 1, // inserción
        d[i - 1]![j - 1]! + cost, // sustitución (0 si son iguales)
      )
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, d[i - 2]![j - 2]! + cost) // transposición de dos adyacentes
      }
      d[i]![j] = value
    }
  }

  return d[lenA]![lenB]!
}

/** Normaliza una distancia de edición a un score de similitud en [0, 1] — 1 significa cadenas idénticas. */
export function similarityFromDistance(a: string, b: string, distance: number): number {
  const maxLength = Math.max(a.length, b.length)
  if (maxLength === 0) return 1
  return 1 - distance / maxLength
}
