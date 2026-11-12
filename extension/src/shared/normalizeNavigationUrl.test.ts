import { describe, expect, it } from 'vitest'
import { normalizeNavigationUrl } from './normalizeNavigationUrl'

describe('normalizeNavigationUrl', () => {
  it('una URL sin slash final y la misma con slash final normalizan igual', () => {
    expect(normalizeNavigationUrl('http://example.com')).toBe(
      normalizeNavigationUrl('http://example.com/'),
    )
  })

  it('elimina el userinfo (usuario@host) — Chrome lo despoja antes de navegar de verdad', () => {
    const withUserinfo = normalizeNavigationUrl('http://accounts.google.com@evil-login.top/')
    const withoutUserinfo = normalizeNavigationUrl('http://evil-login.top/')
    expect(withUserinfo).toBe(withoutUserinfo)
    expect(withUserinfo).not.toContain('accounts.google.com@')
  })

  it('ignora el hash', () => {
    expect(normalizeNavigationUrl('https://example.com/page#section')).toBe(
      normalizeNavigationUrl('https://example.com/page'),
    )
  })

  it('preserva el pathname y el query string: distingue páginas genuinamente distintas', () => {
    expect(normalizeNavigationUrl('https://example.com/login?verificar=1')).not.toBe(
      normalizeNavigationUrl('https://example.com/login?verificar=2'),
    )
    expect(normalizeNavigationUrl('https://example.com/a')).not.toBe(
      normalizeNavigationUrl('https://example.com/b'),
    )
  })

  it('normaliza protocolo y hostname (capitalización) vía el parser estándar', () => {
    expect(normalizeNavigationUrl('HTTP://EXAMPLE.com/')).toBe(
      normalizeNavigationUrl('http://example.com/'),
    )
  })

  it('http y https del mismo host NO normalizan igual (el protocolo se preserva) — el upgrade se tolera por ventana activa, no por igualar esquemas', () => {
    expect(normalizeNavigationUrl('http://example.com/')).not.toBe(
      normalizeNavigationUrl('https://example.com/'),
    )
  })

  it('propaga el error si la URL no es válida (no lo silencia acá)', () => {
    expect(() => normalizeNavigationUrl('no-es-una-url')).toThrow()
  })
})
