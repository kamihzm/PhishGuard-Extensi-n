import { describe, expect, it } from 'vitest'
import type { DnrRule } from './types'
import { dnrRuleProblem } from './validateDnrRule'

function rule(overrides: Partial<DnrRule> & { condition?: DnrRule['condition'] }): DnrRule {
  return {
    id: 1,
    priority: 1,
    action: { type: 'block' },
    condition: { urlFilter: '||ok.example^' },
    ...overrides,
  }
}

describe('dnrRuleProblem: barrera final antes de emitir una regla', () => {
  it('acepta una regla válida', () => {
    expect(dnrRuleProblem(rule({}))).toBeNull()
  })

  it.each<[string, DnrRule, string]>([
    ['prioridad inválida', rule({ priority: 0 }), 'priority'],
    ['urlFilter vacío', rule({ condition: { urlFilter: '' } }), 'url-filter-empty'],
    [
      'urlFilter no ASCII',
      rule({ condition: { urlFilter: '||bücher.example^' } }),
      'url-filter-non-ascii',
    ],
    ['urlFilter con ||*', rule({ condition: { urlFilter: '||*x' } }), 'url-filter-anchor'],
    ['urlFilter universal', rule({ condition: { urlFilter: '|*^' } }), 'url-filter-universal'],
    ['bloqueo sin urlFilter ni dominios', rule({ condition: {} }), 'unbounded'],
    [
      'ambas listas de tipos',
      rule({
        condition: {
          urlFilter: '||a.example^',
          resourceTypes: ['script'],
          excludedResourceTypes: ['image'],
        },
      }),
      'both-type-lists',
    ],
    [
      'lista de tipos vacía',
      rule({ condition: { urlFilter: '||a.example^', resourceTypes: [] } }),
      'empty-type-list',
    ],
    [
      'allowAllRequests con tipos no permitidos',
      rule({
        action: { type: 'allowAllRequests' },
        condition: { urlFilter: '||a.example^', resourceTypes: ['script'] },
      }),
      'allow-all-types',
    ],
    [
      'dominio inválido',
      rule({ condition: { urlFilter: '||a.example^', initiatorDomains: ['Bad Domain'] } }),
      'invalid-domain',
    ],
  ])('%s', (_name, input, problem) => {
    expect(dnrRuleProblem(input)).toBe(problem)
  })
})
