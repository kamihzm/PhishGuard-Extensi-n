import { describe, expect, it } from 'vitest'
import { decomposeUrl } from './urlParts'

describe('decomposeUrl', () => {
  it('descompone una URL simple', () => {
    const parts = decomposeUrl('https://www.example.com/path?a=1#section')
    expect(parts.protocol).toBe('https:')
    expect(parts.hostname).toBe('www.example.com')
    expect(parts.pathname).toBe('/path')
    expect(parts.query).toBe('a=1')
    expect(parts.fragment).toBe('section')
    expect(parts.username).toBe('')
    expect(parts.password).toBe('')
    expect(parts.port).toBe('')
  })

  it('separa subdominios del dominio registrable en un TLD simple', () => {
    const parts = decomposeUrl('https://mail.login.banco.example.com/')
    expect(parts.subdomainLabels).toEqual(['mail', 'login', 'banco'])
    expect(parts.registrableDomain).toBe('example.com')
    expect(parts.publicSuffix).toBe('com')
  })

  it('respeta sufijos compuestos como .com.co', () => {
    const parts = decomposeUrl('https://www.banco.com.co/login')
    expect(parts.subdomainLabels).toEqual(['www'])
    expect(parts.registrableDomain).toBe('banco.com.co')
    expect(parts.publicSuffix).toBe('com.co')
  })

  it('sin subdominios en un dominio de segundo nivel simple', () => {
    const parts = decomposeUrl('https://example.com/')
    expect(parts.subdomainLabels).toEqual([])
    expect(parts.registrableDomain).toBe('example.com')
  })

  it('extrae userinfo (usuario y contraseña) por separado', () => {
    const parts = decomposeUrl('http://usuario:password@evil.com/')
    expect(parts.username).toBe('usuario')
    expect(parts.password).toBe('password')
    expect(parts.hostname).toBe('evil.com')
  })

  it('un "@" en el pathname no se confunde con userinfo', () => {
    const parts = decomposeUrl('https://www.youtube.com/@MegaSawaya')
    expect(parts.username).toBe('')
    expect(parts.password).toBe('')
    expect(parts.pathname).toBe('/@MegaSawaya')
  })

  it('host IP no tiene subdominios ni sufijo público', () => {
    const parts = decomposeUrl('http://192.168.1.50/login')
    expect(parts.isIpHost).toBe(true)
    expect(parts.subdomainLabels).toEqual([])
    expect(parts.publicSuffix).toBe('')
    expect(parts.registrableDomain).toBe('192.168.1.50')
  })

  it('host IPv6 se detecta como IP', () => {
    const parts = decomposeUrl('http://[2001:db8::1]/login')
    expect(parts.isIpHost).toBe(true)
  })

  it('extrae el puerto explícito', () => {
    const parts = decomposeUrl('https://example.com:8443/path')
    expect(parts.port).toBe('8443')
  })

  it('query y fragment quedan vacíos cuando no existen (sin el separador colgante)', () => {
    const parts = decomposeUrl('https://example.com/path')
    expect(parts.query).toBe('')
    expect(parts.fragment).toBe('')
  })
})

describe('dominio registrable con la sección ICANN de la PSL (2026-10-01)', () => {
  it.each([
    ['https://www.roblox.com.mu/users/1/profile', 'roblox.com.mu', ['www']],
    ['https://www.amazon.co.uk/', 'amazon.co.uk', ['www']],
    ['https://www.bbc.co.uk/news', 'bbc.co.uk', ['www']],
    ['https://www.commbank.com.au/', 'commbank.com.au', ['www']],
    ['https://www.mercadolibre.com.mx/', 'mercadolibre.com.mx', ['www']],
    ['https://sucursal.banco.com.co/', 'banco.com.co', ['sucursal']],
    ['https://www.google.com/', 'google.com', ['www']],
    ['https://a.b.ck/', 'a.b.ck', []], // comodín *.ck
    ['https://www.ck/', 'www.ck', []], // excepción !www.ck
  ])('%s → %s', (url, registrable, subdomains) => {
    const parts = decomposeUrl(url)
    expect(parts.registrableDomain).toBe(registrable)
    expect(parts.subdomainLabels).toEqual(subdomains)
  })

  it('la sección PRIVADA no se usa: las plataformas las maneja HOSTING_PLATFORMS', () => {
    expect(decomposeUrl('https://usuario.github.io/').registrableDomain).toBe('github.io')
    expect(decomposeUrl('https://x.pages.dev/').registrableDomain).toBe('pages.dev')
  })

  it('TLD desconocido: regla por defecto (última etiqueta)', () => {
    expect(decomposeUrl('https://a.b.nosuchtld/').registrableDomain).toBe('b.nosuchtld')
  })
})
