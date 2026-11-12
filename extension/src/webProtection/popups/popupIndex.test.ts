import { describe, expect, it } from 'vitest'
import {
  abpPatternToRegExp,
  compilePopupIndex,
  createAdEvidence,
  MAX_URL_LENGTH,
} from './popupIndex'

const LIST = [
  '! comentario',
  '||adnetwork.example^',
  '||popnet.example^$popup',
  '||tracker.example^$script,third-party',
  '||sitead.example^$domain=news.example',
  '&popunder=$popup',
  '/landing/*?z=$popup,third-party',
  '/banner.gif',
  '@@||accounts.adnetwork.example^',
  '@@/oauth/*$popup',
  '||cancelled.example^$popup',
  '||cancelled.example^$popup,badfilter',
  '/^https?:\\/\\/regex\\.example/$popup',
  '||firstparty.example^$~third-party',
  '||csp.example^$csp=script-src',
  'example.com##.ad',
].join('\n')

describe('compilePopupIndex: evidencia desde EasyList (sin tocar el compilador DNR)', () => {
  const { index, report } = compilePopupIndex(LIST)

  it('extrae hosts anclados (con o sin opciones de tipo / $popup)', () => {
    expect(index.hosts).toEqual(['adnetwork.example', 'popnet.example', 'tracker.example'])
  })

  it('extrae patrones $popup con ruta o comodines; no las reglas de red sin $popup', () => {
    expect(index.patterns).toEqual(['&popunder=', '/landing/*?z='])
  })

  it('extrae excepciones', () => {
    expect(index.exceptionHosts).toEqual(['accounts.adnetwork.example'])
    expect(index.exceptionPatterns).toEqual(['/oauth/*'])
  })

  it('descarta y cuenta: limitadas a sitios, badfilter, regex, opciones no soportadas', () => {
    expect(report.skipped['domain-restricted']).toBe(1)
    expect(report.skipped.badfilter).toBe(2)
    expect(report.skipped.regex).toBe(1)
    expect(report.skipped.unsupported).toBe(2)
    expect(JSON.stringify(index)).not.toMatch(/sitead|cancelled|regex|firstparty|csp/)
  })

  it('es determinista', () => {
    expect(JSON.stringify(compilePopupIndex(LIST).index)).toBe(JSON.stringify(index))
  })
})

describe('createAdEvidence', () => {
  const evidence = createAdEvidence(compilePopupIndex(LIST).index)

  it('host listado y sus subdominios son evidencia; sufijos parciales no', () => {
    expect(evidence.isAdUrl('https://adnetwork.example/x')).toBe(true)
    expect(evidence.isAdUrl('https://pxl.rtb.adnetwork.example/?id=1')).toBe(true)
    expect(evidence.isAdUrl('https://notadnetwork.example/')).toBe(false)
    expect(evidence.isAdUrl('https://legit.example/')).toBe(false)
  })

  it('patrones $popup coinciden sobre la URL completa', () => {
    expect(evidence.isAdUrl('https://any.example/?a=1&popunder=1')).toBe(true)
    expect(evidence.isAdUrl('https://x.example/landing/abc?z=9')).toBe(true)
    expect(evidence.isAdUrl('https://x.example/landing/abc')).toBe(false)
  })

  it('las excepciones se reconocen', () => {
    expect(evidence.isException('https://accounts.adnetwork.example/login')).toBe(true)
    expect(evidence.isException('https://site.example/oauth/authorize')).toBe(true)
    expect(evidence.isException('https://site.example/')).toBe(false)
  })

  it('solo http(s) y con longitud acotada', () => {
    expect(evidence.isAdUrl('chrome-extension://abc/adnetwork.example')).toBe(false)
    expect(evidence.isAdUrl('https://adnetwork.example/' + 'a'.repeat(MAX_URL_LENGTH))).toBe(false)
    expect(evidence.isAdUrl('no es url')).toBe(false)
  })

  it('abpPatternToRegExp respeta anclas y separadores', () => {
    expect(abpPatternToRegExp('||ads.example^').test('https://x.ads.example/p')).toBe(true)
    expect(abpPatternToRegExp('||ads.example^').test('https://ads.example.evil.com/')).toBe(false)
    expect(abpPatternToRegExp('|https://a.example/').test('https://a.example/x')).toBe(true)
    expect(abpPatternToRegExp('|https://a.example/').test('see https://a.example/')).toBe(false)
  })
})
