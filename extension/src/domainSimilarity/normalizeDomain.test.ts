import { describe, expect, it } from 'vitest'
import {
  canonicalizeDomain,
  foldVisualLookalikes,
  normalizeForVisualComparison,
} from './normalizeDomain'

describe('canonicalizeDomain', () => {
  it('convierte a minúsculas', () => {
    expect(canonicalizeDomain('Microsoft.COM')).toBe('microsoft.com')
  })

  it('quita el punto final de un FQDN', () => {
    expect(canonicalizeDomain('microsoft.com.')).toBe('microsoft.com')
  })

  it('un dominio ya canónico queda igual', () => {
    expect(canonicalizeDomain('microsoft.com')).toBe('microsoft.com')
  })
})

describe('foldVisualLookalikes', () => {
  it('"rn" se pliega a "m" — y cualquier "i" restante (incluida la de "microsoft") también se pliega a "l", de forma consistente en ambos lados de cualquier comparación', () => {
    // No es un error: "microsoft.com" (la referencia real) se pliega
    // exactamente igual (ver el test de abajo), así que la comparación de
    // similitud sigue siendo correcta — el objetivo de esta función es una
    // forma canónica COMPARTIDA, no una forma legible.
    expect(foldVisualLookalikes('rnicrosoft.com')).toBe('mlcrosoft.com')
    expect(foldVisualLookalikes('microsoft.com')).toBe('mlcrosoft.com')
  })

  it('"0" se pliega a "o"', () => {
    expect(foldVisualLookalikes('g00gle.com')).toBe('google.com')
  })

  it('"1" se pliega a "l"', () => {
    expect(foldVisualLookalikes('paypa1.com')).toBe('paypal.com')
  })

  it('"i" también se pliega a "l" (clase de equivalencia 1/l/i)', () => {
    expect(foldVisualLookalikes('paypai.com')).toBe('paypal.com')
  })

  it('un dominio sin patrones de sustitución queda igual', () => {
    expect(foldVisualLookalikes('example.com')).toBe('example.com')
  })

  describe('leetspeak (Fase 2 del audit de Seguridad-master — ver docs/reference-audit-seguridad-master.md)', () => {
    it.each([
      ['p4yp4l.com', 'paypal.com'], // "4" -> "a"
      ['n3tflix.com', 'netflix.com'], // "3" -> "e"
      ['am@zon.com', 'amazon.com'], // "@" -> "a"
      ['micro5oft.com', 'microsoft.com'], // "5" -> "s"
      ['micro$oft.com', 'microsoft.com'], // "$" -> "s"
      ['ne7flix.com', 'netflix.com'], // "7" -> "t"
      ['face8ook.com', 'facebook.com'], // "8" -> "b"
      ['g009le.com', 'google.com'], // "9" -> "g", "0" -> "o"
      ['examp|e.com', 'example.com'], // "|" -> "l"
      ['examp!e.com', 'example.com'], // "!" -> "i" (nota: "i" también pliega a "l", ver arriba)
    ])(
      'sustituye símbolos leetspeak de forma consistente en ambos lados: "%s"',
      (variant, plain) => {
        expect(foldVisualLookalikes(variant)).toBe(foldVisualLookalikes(plain))
      },
    )

    it('"vv" se pliega a "w"', () => {
      expect(foldVisualLookalikes('vvindows.com')).toBe(foldVisualLookalikes('windows.com'))
    })

    it('"cl" se pliega a "d"', () => {
      expect(foldVisualLookalikes('clave.com')).toBe(foldVisualLookalikes('dave.com'))
    })
  })
})

describe('normalizeForVisualComparison', () => {
  it('combina canonicalización + plegado visual, y ambos dominios terminan en la misma forma canónica', () => {
    expect(normalizeForVisualComparison('RNicrosoft.COM.')).toBe(
      normalizeForVisualComparison('microsoft.com'),
    )
  })
})
