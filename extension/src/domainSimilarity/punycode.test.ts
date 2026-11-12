import { describe, expect, it } from 'vitest'
import { decodePunycode, hostToUnicode, labelToUnicode } from './punycode'

describe('punycode (RFC 3492, solo decodificación)', () => {
  it.each([
    ['mnchen-3ya', 'münchen'],
    ['pypal-4ve', 'pаypal'],
    ['80ak6aa92e', 'аррӏе'],
    ['80aswg', 'сайт'],
    ['fiqs8s', '中国'],
    ['wgv71a119e', '日本語'],
    ['caf-dma', 'café'],
  ])('xn--%s → %s', (encoded, decoded) => {
    expect(decodePunycode(encoded)).toBe(decoded)
  })

  it('etiquetas sin xn-- y etiquetas inválidas se devuelven tal cual', () => {
    expect(labelToUnicode('google')).toBe('google')
    expect(labelToUnicode('xn--!!!')).toBe('xn--!!!')
  })

  it('decodifica un host completo etiqueta por etiqueta', () => {
    expect(hostToUnicode('www.xn--mnchen-3ya.de')).toBe('www.münchen.de')
  })
})
