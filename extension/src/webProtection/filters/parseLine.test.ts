import { describe, expect, it } from 'vitest'
import { canonicalNetworkKey, parseLine, splitNetworkLine } from './parseLine'

describe('parseLine: comentarios y cabeceras', () => {
  it.each([
    '',
    '   ',
    '! Title: EasyList',
    '[Adblock Plus 2.0]',
    '! Licence: https://easylist.to/',
  ])('%j es comentario', (line) => {
    expect(parseLine(line)).toEqual({ kind: 'comment' })
  })
})

describe('parseLine: filtros cosméticos/de página se difieren (no se compilan en la Fase B)', () => {
  it.each([
    ['##.ad-banner', 'cosmetic-hide'],
    ['example.com,~sub.example.com##div[id^="ad-"]', 'cosmetic-hide'],
    ['example.com#@#.ad-banner', 'cosmetic-exception'],
    ['example.com#?#div:has-text(Sponsored)', 'procedural'],
    ['example.com#@?#div:has-text(Sponsored)', 'procedural'],
    ['example.com#$#body { overflow: auto !important; }', 'css-injection'],
    ['example.com#%#//scriptlet("abort-on-property-read", "x")', 'scriptlet'],
    ['example.com##+js(set-constant, x, 1)', 'scriptlet'],
    ['example.com##^script:has-text(ads)', 'html-filter'],
    ['example.com$$script[tag-content="ads"]', 'html-filter'],
  ])('%s → %s', (line, cosmeticKind) => {
    expect(parseLine(line)).toEqual({ kind: 'deferred-cosmetic', cosmeticKind })
  })

  it('un "#" dentro de un filtro de red con ruta NO se confunde con cosmético', () => {
    expect(parseLine('||example.com/page#anchor##x').kind).toBe('network')
  })
})

/** Un caso por motivo de rechazo de la §4.2: nunca producen regla. */
describe('parseLine: rechazos contabilizables (§4.2)', () => {
  it.each([
    ['/banner\\d+\\.gif/', 'regex-filter'],
    ['/ads/', 'regex-filter'],
    ['@@/tracking[0-9]/$script', 'regex-filter'],
    ['||ads.example^$popup', 'option-unsupported:popup'],
    ['||ads.example^$third-party,popup', 'option-unsupported:popup'],
    ['||ads.example^$redirect=noopjs', 'option-unsupported:redirect'],
    ['||ads.example^$redirect-rule=noopjs', 'option-unsupported:redirect-rule'],
    ['||ads.example^$removeparam=utm_source', 'option-unsupported:removeparam'],
    ["||ads.example^$csp=script-src'none'", 'option-unsupported:csp'],
    ['||ads example^', 'pattern-whitespace'],
    ['||ads.example^$rewrite=abp-resource:blank-js', 'option-unsupported:rewrite'],
    ['||ads.example^$method=post', 'option-unsupported:method'],
    ['||ads.example^$all', 'option-unsupported:all'],
    ['||ads.example^$denyallow=a.example', 'option-unsupported:denyallow'],
    ['@@||site.example^$generichide', 'option-cosmetic-scope'],
    ['@@||site.example^$elemhide', 'option-cosmetic-scope'],
    ['||ads.example^$frobnicate', 'option-unknown:frobnicate'],
    ['||ads.example^$document', 'document-block'],
    ['@@||site.example^$document,script', 'document-with-types'],
    ['||ads.example^$domain=google.*', 'domain-entity'],
    ['||ads.example^$domain=/goo+gle/', 'domain-regex'],
    ['||ads.example^$domain=bücher.example', 'domain-non-ascii'],
    ['||ads.example^$domain=bad_domain!', 'domain-invalid'],
    ['||ads.example^$third-party,~third-party', 'party-conflict'],
    ['||ads.example^$script,~script', 'no-resource-types'],
    ['||bücher.example^', 'pattern-non-ascii'],
    ['*', 'pattern-universal'],
    ['||*', 'pattern-universal'],
    ['$script', 'pattern-universal'],
    ['@@*$image', 'pattern-universal'],
    ['||*.example^', 'pattern-dnr-invalid'],
    ['ads|banner', 'pattern-dnr-invalid'],
    ['||ads.example^$', 'options-malformed'],
    ['||ads.example^$script,,image', 'options-malformed'],
    ['0.0.0.0 ads.example', 'hosts-format'],
    ['!#if env_mv3', 'preprocessor-directive'],
  ])('%s → %s', (line, reason) => {
    expect(parseLine(line)).toEqual({ kind: 'rejected', reason })
  })
})

describe('forma canónica para $badfilter', () => {
  it('ignora el orden de opciones, mayúsculas de nombres y la propia opción badfilter', () => {
    expect(
      canonicalNetworkKey(splitNetworkLine('||ads.example^$Script,third-party,badfilter')),
    ).toBe(canonicalNetworkKey(splitNetworkLine('||ads.example^$third-party,script')))
  })

  it('distingue excepción de bloqueo', () => {
    expect(canonicalNetworkKey(splitNetworkLine('@@||ads.example^$script'))).not.toBe(
      canonicalNetworkKey(splitNetworkLine('||ads.example^$script')),
    )
  })
})
