import { describe, expect, it } from 'vitest'
import { calculateShannonEntropy } from './entropy'

describe('calculateShannonEntropy', () => {
  it('devuelve 0 para una cadena vacía', () => {
    expect(calculateShannonEntropy('')).toBe(0)
  })

  it('devuelve 0 cuando todos los caracteres son iguales (cero incertidumbre)', () => {
    expect(calculateShannonEntropy('aaaa')).toBe(0)
  })

  it('devuelve 1 bit para dos símbolos equiprobables', () => {
    expect(calculateShannonEntropy('abab')).toBeCloseTo(1, 10)
  })

  it('devuelve 2 bits para cuatro símbolos equiprobables', () => {
    expect(calculateShannonEntropy('abcd')).toBeCloseTo(2, 10)
  })

  it('un dominio con caracteres repetidos tiene menor entropía que uno con caracteres variados', () => {
    const repetitive = calculateShannonEntropy('aaaaaaaaaa')
    const varied = calculateShannonEntropy('kx7fq2z9wq')
    expect(varied).toBeGreaterThan(repetitive)
  })
})
