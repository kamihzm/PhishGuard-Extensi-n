import { describe, expect, it } from 'vitest'
import {
  candidateDomains,
  compileCosmetic,
  MAX_SELECTORS_PER_PAGE,
  selectorsForHost,
} from './compileCosmetic'

const LIST = [
  '! comentario',
  '[Adblock Plus 2.0]',
  'example.com##.banner-ad',
  'example.com,news.example.org##div[data-ad="top"]',
  'shop.example.com#@#.banner-ad',
  'a.com,~b.a.com##.promo',
  '##.generic-ad',
  '~only-negated.com##.x',
  'example.com#?#div:-abp-has(.ad)',
  'example.com#$#body { overflow: auto !important; }',
  'example.com##+js(set-constant, foo, 1)',
  'example.com##.box:has-text(Anuncio)',
  'google.*##.tld-wildcard',
  'example.com##body',
  'example.com##.a{color:red}',
  'example.com##a[href="x]',
  '||ads.example.com^',
].join('\n')

describe('compileCosmetic: solo filtros cosméticos específicos de dominio, CSS puro', () => {
  const { index, report } = compileCosmetic(LIST)

  it('indexa selectores por dominio', () => {
    expect(index.hide['example.com']).toEqual(['.banner-ad', 'div[data-ad="top"]'])
    expect(index.hide['news.example.org']).toEqual(['div[data-ad="top"]'])
    expect(index.hide['a.com']).toEqual(['.promo'])
  })

  it('las excepciones #@# y los dominios negados quedan como excepción del subdominio', () => {
    expect(index.allow['shop.example.com']).toEqual(['.banner-ad'])
    expect(index.allow['b.a.com']).toEqual(['.promo'])
  })

  it('descarta y cuenta genéricos, solo-negados, sintaxis extendida, comodines de TLD e inseguros', () => {
    expect(report.skipped.generic).toBe(1)
    expect(report.skipped['negated-only']).toBe(1)
    // #?#, #$#, +js, :has-text
    expect(report.skipped['extended-syntax']).toBe(4)
    expect(report.skipped['invalid-domain']).toBe(1)
    // body (estructura raíz), llaves, comillas desbalanceadas
    expect(report.skipped['unsafe-selector']).toBe(3)
    expect(JSON.stringify(index)).not.toContain('generic-ad')
    expect(JSON.stringify(index)).not.toContain('color:red')
    expect(JSON.stringify(index)).not.toContain('"body"')
  })

  it('ignora comentarios, cabeceras y filtros de red', () => {
    // 14 líneas cosméticas; los conteos cuadran: aceptadas + excepciones + descartadas = total.
    expect(report.totalLines).toBe(14)
    const skippedTotal = Object.values(report.skipped).reduce((a, b) => a + b, 0)
    expect(report.domainSpecificHide + report.domainSpecificAllow + skippedTotal).toBe(14)
    expect(JSON.stringify(index)).not.toContain('ads.example.com')
  })

  it('es determinista: misma entrada → mismo índice', () => {
    expect(JSON.stringify(compileCosmetic(LIST).index)).toBe(JSON.stringify(index))
  })
})

describe('selectorsForHost', () => {
  const { index } = compileCosmetic(LIST)

  it('aplica los del dominio y de sus dominios padre', () => {
    expect(selectorsForHost(index, 'www.example.com')).toEqual(['.banner-ad', 'div[data-ad="top"]'])
  })

  it('respeta excepciones del subdominio', () => {
    expect(selectorsForHost(index, 'shop.example.com')).toEqual(['div[data-ad="top"]'])
    expect(selectorsForHost(index, 'b.a.com')).toEqual([])
    expect(selectorsForHost(index, 'x.b.a.com')).toEqual([])
    expect(selectorsForHost(index, 'c.a.com')).toEqual(['.promo'])
  })

  it('no aplica nada a dominios sin reglas ni a sufijos parciales', () => {
    expect(selectorsForHost(index, 'notexample.com')).toEqual([])
    expect(selectorsForHost(index, 'com')).toEqual([])
  })

  it('limita la cantidad de selectores por página', () => {
    const many = Array.from({ length: MAX_SELECTORS_PER_PAGE + 50 }, (_, i) => `big.com##.a${i}`)
    const big = compileCosmetic(many.join('\n')).index
    expect(selectorsForHost(big, 'big.com')).toHaveLength(MAX_SELECTORS_PER_PAGE)
  })

  it('candidateDomains recorre del más específico al registrable', () => {
    expect(candidateDomains('a.b.example.com.')).toEqual([
      'a.b.example.com',
      'b.example.com',
      'example.com',
    ])
  })
})
