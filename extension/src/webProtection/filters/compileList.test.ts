import { describe, expect, it } from 'vitest'
import { compileList } from './compileList'

const OPTIONS = { listId: 'test', category: 'ads' } as const

describe('compileList: conteos y contabilidad completa', () => {
  const list = [
    '[Adblock Plus 2.0]',
    '! Title: lista de prueba',
    '',
    '||ads.example^',
    '||ads.example^',
    '@@||cdn.example/ads.js$script',
    '||ads.example^$popup',
    '/regex\\d/',
    '##.ad-banner',
    'site.example#@#.ad-banner',
    '||tracker.example^$third-party',
  ].join('\n')
  const { rules, report } = compileList(`${list}\n`, OPTIONS)

  it('cada línea cae en exactamente una clase y los conteos suman el total', () => {
    expect(report.totalLines).toBe(11)
    expect(report.comments).toBe(3)
    expect(report.accepted).toBe(4)
    expect(report.acceptedExceptions).toBe(1)
    expect(report.duplicatesRemoved).toBe(1)
    expect(report.dnrRules).toBe(3)
    expect(report.rejected).toEqual({ 'option-unsupported:popup': 1, 'regex-filter': 1 })
    expect(report.rejectedTotal).toBe(2)
    expect(report.deferredCosmetic).toEqual({ 'cosmetic-hide': 1, 'cosmetic-exception': 1 })
    expect(report.deferredCosmeticTotal).toBe(2)
    expect(report.check.sumsToTotal).toBe(true)
  })

  it('una línea válida → como máximo una regla; ids consecutivos desde 1', () => {
    expect(rules.map((r) => r.id)).toEqual([1, 2, 3])
    expect(rules.map((r) => r.condition.urlFilter)).toEqual([
      '||ads.example^',
      '||cdn.example/ads.js',
      '||tracker.example^',
    ])
  })

  it('NO fusiona reglas distintas (§4.4): dos dominios distintos son dos reglas', () => {
    const { rules: separate } = compileList('||a.example^\n||b.example^\n', OPTIONS)
    expect(separate).toHaveLength(2)
    expect(separate.every((r) => r.condition.urlFilter !== undefined)).toBe(true)
  })

  it('es determinista: misma entrada → misma salida', () => {
    expect(JSON.stringify(compileList(list, OPTIONS))).toBe(
      JSON.stringify(compileList(list, OPTIONS)),
    )
  })

  it('acepta finales de línea CRLF', () => {
    expect(compileList('||a.example^\r\n||b.example^\r\n', OPTIONS).report.dnrRules).toBe(2)
  })
})

describe('compileList: $badfilter', () => {
  it('anula el filtro idéntico aunque aparezca antes, con opciones en otro orden', () => {
    const { rules, report } = compileList(
      [
        '||ads.example^$script,third-party',
        '||keep.example^',
        '||ads.example^$third-party,script,badfilter',
      ].join('\n'),
      OPTIONS,
    )
    expect(rules.map((r) => r.condition.urlFilter)).toEqual(['||keep.example^'])
    expect(report.badfilterCancelled).toBe(1)
    expect(report.badfilterDirectives).toBe(1)
    expect(report.check.sumsToTotal).toBe(true)
  })

  it('no anula filtros con opciones distintas', () => {
    const { rules, report } = compileList(
      ['||ads.example^$script', '||ads.example^$image,badfilter'].join('\n'),
      OPTIONS,
    )
    expect(rules).toHaveLength(1)
    expect(report.badfilterCancelled).toBe(0)
  })

  it('una excepción con $badfilter solo anula la excepción idéntica', () => {
    const { rules } = compileList(
      ['||ads.example^', '@@||ads.example^', '@@||ads.example^$badfilter'].join('\n'),
      OPTIONS,
    )
    expect(rules.map((r) => r.action.type)).toEqual(['block'])
  })
})

describe('compileList: preprocesador', () => {
  it('rechaza las directivas y todas las líneas dentro de un bloque !#if', () => {
    const { rules, report } = compileList(
      [
        '||before.example^',
        '!#if env_mv3',
        '||inside.example^',
        '##.inside',
        '!#endif',
        '||after.example^',
      ].join('\n'),
      OPTIONS,
    )
    expect(rules.map((r) => r.condition.urlFilter)).toEqual([
      '||before.example^',
      '||after.example^',
    ])
    expect(report.rejected).toEqual({ 'preprocessor-block': 2, 'preprocessor-directive': 2 })
    expect(report.check.sumsToTotal).toBe(true)
  })
})
