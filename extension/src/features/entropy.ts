/**
 * Entropía de Shannon en bits: mide qué tan "aleatorio" se ve un texto.
 * Dominios generados automáticamente (ej. "kx7fq2z.com") tienden a tener
 * entropía alta; palabras reales ("bancolombia") tienden a tener entropía más baja.
 */
export function calculateShannonEntropy(text: string): number {
  if (text.length === 0) return 0

  const frequencies = new Map<string, number>()
  for (const char of text) {
    frequencies.set(char, (frequencies.get(char) ?? 0) + 1)
  }

  let entropy = 0
  for (const count of frequencies.values()) {
    const probability = count / text.length
    entropy -= probability * Math.log2(probability)
  }

  return entropy
}
