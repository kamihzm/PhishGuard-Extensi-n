import { describe, expect, it } from 'vitest'
import { analyzeIdn, isMixedScript, skeleton } from './homoglyph'

const idn = (url: string) => {
  const host = new URL(url).hostname
  return analyzeIdn(host, host.split('.').slice(-2).join('.'))
}

describe('homoglifos (UTS #39)', () => {
  it('el esqueleto pliega letras de otras escrituras a su forma latina', () => {
    expect(skeleton('pаypal')).toBe(skeleton('paypal'))
    expect(skeleton('аррӏе')).toBe(skeleton('apple'))
    expect(skeleton('münchen')).not.toBe(skeleton('munchen'))
  })

  it('mezcla de escrituras: latín + cirílico sí; japonés (han + kana) no', () => {
    expect(isMixedScript('pаypal')).toBe(true)
    expect(isMixedScript('сайт')).toBe(false)
    expect(isMixedScript('日本語のサイト')).toBe(false)
    // `ー` (U+30FC) es de escritura Common: no convierte en "mezclado" un nombre japonés.
    expect(isMixedScript('ワンルーム投資')).toBe(false)
  })

  it('detecta la marca imitada y dice cuál es', () => {
    expect(idn('https://pаypal.example/').homoglyphReferenceDomain).toBe('paypal.com')
    expect(idn('https://аррӏе.test/').homoglyphReferenceDomain).toBe('apple.com')
    expect(idn('https://gооgle-login.example/').homoglyphReferenceDomain).toBe('google.com')
  })

  it('marca con homoglifos en un subdominio', () => {
    const r = idn('https://login.pаypal.secure.example/')
    expect(r.homoglyphReferenceDomain).toBe('paypal.com')
    expect(r.homoglyphPart).toBe('subdominio')
  })

  it('IDN legítimos que no imitan marcas no se marcan', () => {
    for (const url of [
      'https://münchen.de/',
      'https://сайт.рф/',
      'https://日本語.jp/',
      'https://café.fr/',
    ]) {
      expect(idn(url).homoglyphReferenceDomain).toBeNull()
    }
  })

  it('sin xn-- no hay análisis IDN', () => {
    expect(idn('https://paypal.com/').unicodeHost).toBeNull()
  })
})
