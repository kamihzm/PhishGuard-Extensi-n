import { describe, expect, it } from 'vitest'
import { extractFeatures } from './extractFeatures'

describe('señales de plataformas, acortadores y marcas en subdominios', () => {
  it('marca dentro del subdominio de una plataforma', () => {
    const f = extractFeatures('https://instagramlogin-ejemplo.blogspot.com/')
    expect(f.hostingPlatform).toBe('blogspot.com')
    expect(f.hostingBrand).toBe('instagram')
    expect(f.hostingSensitiveWord).toBe('login')
  })

  it('la cuenta con el nombre EXACTO de la marca no cuenta (páginas oficiales)', () => {
    const f = extractFeatures('https://microsoft.github.io/vscode/')
    expect(f.hostingPlatform).toBe('github.io')
    expect(f.hostingBrand).toBeNull()
  })

  it('marcas cortas solo como token: "dian" no se encuentra dentro de "guardian"', () => {
    expect(extractFeatures('https://guardian-docs.netlify.app/').hostingBrand).toBeNull()
    expect(extractFeatures('https://dian-pagos.netlify.app/').hostingBrand).toBe('dian')
  })

  it('lista ampliada', () => {
    expect(extractFeatures('https://ledgerapp-ejemplo.pages.dev/').hostingBrandExtended).toBe(
      'ledger',
    )
  })

  it('acortadores', () => {
    expect(extractFeatures('https://bit.ly/abc').urlShortener).toBe('bit.ly')
    expect(extractFeatures('https://example.com/').urlShortener).toBeNull()
  })

  it('marca en el subdominio de un dominio ajeno (no de la marca ni plataforma)', () => {
    expect(extractFeatures('https://paypal.com.verify-account.example/').subdomainBrand).toBe(
      'paypal',
    )
    expect(extractFeatures('https://accounts.google.com/').subdomainBrand).toBeNull()
  })

  it('dominios de la marca en ccTLD con segundo nivel genérico no cuentan (amazon.co.uk)', () => {
    for (const url of [
      'https://www.amazon.co.uk/',
      'https://www.google.com.br/',
      'https://www.apple.co.jp/',
      'https://www.paypal.com.mx/',
    ]) {
      expect(extractFeatures(url).subdomainBrand).toBeNull()
    }
  })

  it('guiones visibles: los de xn-- no cuentan', () => {
    const f = extractFeatures('https://xn--mnchen-3ya.de/')
    expect(f.hyphenCount).toBe(3)
    expect(f.visibleHyphenCount).toBe(0)
  })

  it('técnica homoglyph: activada por defecto desde 2026-10-01; con false, comportamiento anterior', () => {
    const url = 'https://xn--pypal-4ve.com/'
    expect(
      extractFeatures(url, { homoglyphImpersonation: false }).domainSimilarityTechnique,
    ).not.toBe('homoglyph')
    const f = extractFeatures(url)
    expect(f.isDomainImpersonation).toBe(true)
    expect(f.domainSimilarityTechnique).toBe('homoglyph')
    expect(f.domainSimilarityReferenceDomain).toBe('paypal.com')
  })
})
