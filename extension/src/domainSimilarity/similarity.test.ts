import { describe, expect, it } from 'vitest'
import { damerauLevenshteinDistance, similarityFromDistance } from './similarity'

describe('damerauLevenshteinDistance', () => {
  it('cadenas idénticas tienen distancia 0', () => {
    expect(damerauLevenshteinDistance('microsoft.com', 'microsoft.com')).toBe(0)
  })

  it('una inserción cuenta como 1', () => {
    expect(damerauLevenshteinDistance('google.com', 'gooogle.com')).toBe(1)
  })

  it('una eliminación cuenta como 1', () => {
    expect(damerauLevenshteinDistance('microsoft.com', 'microsft.com')).toBe(1)
  })

  it('una sustitución cuenta como 1', () => {
    expect(damerauLevenshteinDistance('paypal.com', 'paypa1.com')).toBe(1)
  })

  it('una transposición de dos caracteres adyacentes cuenta como 1 (no 2, como en Levenshtein simple)', () => {
    expect(damerauLevenshteinDistance('microsoft.com', 'micrsooft.com')).toBe(1)
  })

  it('es simétrica', () => {
    expect(damerauLevenshteinDistance('apple.com', 'aple.com')).toBe(
      damerauLevenshteinDistance('aple.com', 'apple.com'),
    )
  })

  it('contra cadena vacía, la distancia es la longitud de la otra', () => {
    expect(damerauLevenshteinDistance('', 'abc')).toBe(3)
    expect(damerauLevenshteinDistance('abc', '')).toBe(3)
  })
})

describe('similarityFromDistance', () => {
  it('distancia 0 da similitud 1', () => {
    expect(similarityFromDistance('abc', 'abc', 0)).toBe(1)
  })

  it('normaliza por la longitud más larga', () => {
    // "abc" vs "abcd": distancia 1, longitud máxima 4 -> similitud 0.75
    expect(similarityFromDistance('abc', 'abcd', 1)).toBeCloseTo(0.75, 5)
  })

  it('dos cadenas vacías dan similitud 1 (caso límite, no división por cero)', () => {
    expect(similarityFromDistance('', '', 0)).toBe(1)
  })
})
