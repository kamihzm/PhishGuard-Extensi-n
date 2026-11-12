import { describe, expect, it } from 'vitest'
import { normalizeTrustedHostname } from './normalizeTrustedHostname'

describe('normalizeTrustedHostname', () => {
  it('convierte una URL completa con path y query a solo el hostname', () => {
    expect(normalizeTrustedHostname('https://Example.com/login?q=1')).toBe('example.com')
  })

  it('convierte mayúsculas a minúsculas', () => {
    expect(normalizeTrustedHostname('https://ACCOUNTS.GOOGLE.COM/')).toBe('accounts.google.com')
  })

  it('acepta un hostname suelto (sin esquema), como lo tipearía el usuario a mano', () => {
    expect(normalizeTrustedHostname('example.com')).toBe('example.com')
    expect(normalizeTrustedHostname('Example.com')).toBe('example.com')
  })

  it('elimina espacios (trim)', () => {
    expect(normalizeTrustedHostname('  example.com  ')).toBe('example.com')
  })

  it('nunca incluye protocolo, path, query ni hash en el resultado', () => {
    expect(normalizeTrustedHostname('https://example.com:8443/a/b?c=1#d')).toBe('example.com')
  })

  it('rechaza chrome://', () => {
    expect(() => normalizeTrustedHostname('chrome://settings')).toThrow()
  })

  it('rechaza chrome-extension://', () => {
    expect(() => normalizeTrustedHostname('chrome-extension://abc123/warning.html')).toThrow()
  })

  it('rechaza about:', () => {
    expect(() => normalizeTrustedHostname('about:blank')).toThrow()
  })

  it('rechaza file:', () => {
    expect(() => normalizeTrustedHostname('file:///etc/passwd')).toThrow()
  })

  it('rechaza un string vacío', () => {
    expect(() => normalizeTrustedHostname('   ')).toThrow()
  })
})
