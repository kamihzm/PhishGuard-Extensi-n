import { describe, expect, it } from 'vitest'
import { parseLine } from './parseLine'
import { toDnrRule } from './toDnrRule'
import type { DnrRule } from './types'

function compileOne(line: string): DnrRule {
  const result = parseLine(line)
  if (result.kind !== 'network')
    throw new Error(`se esperaba filtro de red: ${JSON.stringify(result)}`)
  return toDnrRule(result.filter)
}

/** Un caso por fila de la tabla §4.1 de docs/web-protection-audit.md: texto ABP → regla DNR exacta. */
describe('transformación exacta ABP → DNR (§4.1)', () => {
  it.each<[string, string, DnrRule]>([
    [
      'patrón con ancla de dominio, sin opciones',
      '||ads.example^',
      { id: 0, priority: 1, action: { type: 'block' }, condition: { urlFilter: '||ads.example^' } },
    ],
    [
      'patrón con comodín y rutas',
      '/banner/*/img^',
      { id: 0, priority: 1, action: { type: 'block' }, condition: { urlFilter: '/banner/*/img^' } },
    ],
    [
      'anclas de inicio y fin',
      '|https://track.example/pixel.gif|',
      {
        id: 0,
        priority: 1,
        action: { type: 'block' },
        condition: { urlFilter: '|https://track.example/pixel.gif|' },
      },
    ],
    [
      '$match-case',
      '||ads.example/Banner$match-case',
      {
        id: 0,
        priority: 1,
        action: { type: 'block' },
        condition: { urlFilter: '||ads.example/Banner', isUrlFilterCaseSensitive: true },
      },
    ],
    [
      'tipos de recurso (subdocument → sub_frame, orden estable)',
      '||ads.example^$subdocument,script,image',
      {
        id: 0,
        priority: 1,
        action: { type: 'block' },
        condition: { urlFilter: '||ads.example^', resourceTypes: ['image', 'script', 'sub_frame'] },
      },
    ],
    [
      'alias uBO de tipos (xhr, css, frame, beacon)',
      '||ads.example^$xhr,css,frame,beacon',
      {
        id: 0,
        priority: 1,
        action: { type: 'block' },
        condition: {
          urlFilter: '||ads.example^',
          resourceTypes: ['ping', 'stylesheet', 'sub_frame', 'xmlhttprequest'],
        },
      },
    ],
    [
      'tipos negados',
      '||ads.example^$~script,~image',
      {
        id: 0,
        priority: 1,
        action: { type: 'block' },
        condition: { urlFilter: '||ads.example^', excludedResourceTypes: ['image', 'script'] },
      },
    ],
    [
      'tipos positivos y negados: solo los positivos no negados',
      '||ads.example^$script,image,~image',
      {
        id: 0,
        priority: 1,
        action: { type: 'block' },
        condition: { urlFilter: '||ads.example^', resourceTypes: ['script'] },
      },
    ],
    [
      '$~document en bloqueo (equivale al comportamiento por defecto)',
      '||ads.example^$~document',
      {
        id: 0,
        priority: 1,
        action: { type: 'block' },
        condition: { urlFilter: '||ads.example^', excludedResourceTypes: ['main_frame'] },
      },
    ],
    [
      '$third-party',
      '||tracker.example^$third-party',
      {
        id: 0,
        priority: 1,
        action: { type: 'block' },
        condition: { urlFilter: '||tracker.example^', domainType: 'thirdParty' },
      },
    ],
    [
      '$~third-party',
      '||tracker.example^$~third-party',
      {
        id: 0,
        priority: 1,
        action: { type: 'block' },
        condition: { urlFilter: '||tracker.example^', domainType: 'firstParty' },
      },
    ],
    [
      '$1p / $3p (alias)',
      '||tracker.example^$3p',
      {
        id: 0,
        priority: 1,
        action: { type: 'block' },
        condition: { urlFilter: '||tracker.example^', domainType: 'thirdParty' },
      },
    ],
    [
      '$domain= con incluidos y excluidos (ordenados, en minúsculas)',
      '||ads.example^$domain=Site-B.example|site-a.example|~sub.site-a.example',
      {
        id: 0,
        priority: 1,
        action: { type: 'block' },
        condition: {
          urlFilter: '||ads.example^',
          initiatorDomains: ['site-a.example', 'site-b.example'],
          excludedInitiatorDomains: ['sub.site-a.example'],
        },
      },
    ],
    [
      'patrón vacío restringido por $domain= (sin urlFilter)',
      '$script,domain=site.example',
      {
        id: 0,
        priority: 1,
        action: { type: 'block' },
        condition: { resourceTypes: ['script'], initiatorDomains: ['site.example'] },
      },
    ],
    [
      'excepción @@',
      '@@||cdn.example/ads.js$script',
      {
        id: 0,
        priority: 2,
        action: { type: 'allow' },
        condition: { urlFilter: '||cdn.example/ads.js', resourceTypes: ['script'] },
      },
    ],
    [
      'excepción de documento @@…$document',
      '@@||site.example^$document',
      {
        id: 0,
        priority: 2,
        action: { type: 'allowAllRequests' },
        condition: { urlFilter: '||site.example^', resourceTypes: ['main_frame', 'sub_frame'] },
      },
    ],
    [
      '$important en bloqueo',
      '||ads.example^$important',
      { id: 0, priority: 3, action: { type: 'block' }, condition: { urlFilter: '||ads.example^' } },
    ],
    [
      '$important en excepción',
      '@@||ads.example^$important',
      { id: 0, priority: 4, action: { type: 'allow' }, condition: { urlFilter: '||ads.example^' } },
    ],
  ])('%s', (_name, line, expected) => {
    expect(compileOne(line)).toEqual(expected)
  })
})
