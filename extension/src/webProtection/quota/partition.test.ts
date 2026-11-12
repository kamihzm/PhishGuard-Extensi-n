import { describe, expect, it } from 'vitest'
import type { DnrRule } from '../filters/types'
import { isException, partitionRulesets, type CompiledList } from './partition'

function block(host: string): DnrRule {
  return { id: 0, priority: 1, action: { type: 'block' }, condition: { urlFilter: `||${host}^` } }
}
function allow(host: string): DnrRule {
  return { id: 0, priority: 2, action: { type: 'allow' }, condition: { urlFilter: `||${host}^` } }
}
function list(
  listId: string,
  category: CompiledList['category'],
  blocks: number,
  allows: number,
): CompiledList {
  return {
    listId,
    category,
    rules: [
      ...Array.from({ length: allows }, (_, i) => allow(`${listId}-ok${i}.example`)),
      ...Array.from({ length: blocks }, (_, i) => block(`${listId}-ad${i}.example`)),
    ],
  }
}
const canonical = (rule: DnrRule) => JSON.stringify({ ...rule, id: 0 })
const OPTIONS = { coreBudget: 100, chunkSize: 30 }

describe('partitionRulesets', () => {
  const lists = [list('a', 'ads', 200, 10), list('b', 'trackers', 300, 20)]
  const { rulesets, stats, coreRuleCount } = partitionRulesets(lists, OPTIONS)
  const core = rulesets.filter((r) => r.tier === 'core')
  const optional = rulesets.filter((r) => r.tier === 'optional')

  it('el Core respeta el presupuesto y contiene TODAS las excepciones', () => {
    expect(coreRuleCount).toBe(100)
    expect(core.flatMap((r) => r.rules).filter(isException)).toHaveLength(30)
    expect(optional.flatMap((r) => r.rules).filter(isException)).toHaveLength(0)
  })

  it('reparte los bloqueos del Core en proporción al tamaño de cada lista', () => {
    // 70 bloqueos para el Core: 200/500 → 28 para "a", 300/500 → 42 para "b".
    expect(stats.map((s) => [s.listId, s.coreBlocks])).toEqual([
      ['a', 28],
      ['b', 42],
    ])
  })

  it('no pierde ni duplica reglas: la partición es exactamente el conjunto compilado', () => {
    const input = lists
      .flatMap((l) => l.rules)
      .map(canonical)
      .sort()
    const output = rulesets
      .flatMap((r) => r.rules)
      .map(canonical)
      .sort()
    expect(output).toEqual(input)
  })

  it('opcionales de hasta chunkSize, intercalados entre listas y con ids 1..n por ruleset', () => {
    expect(optional.every((r) => r.rules.length <= 30)).toBe(true)
    expect(optional.slice(0, 4).map((r) => r.listId)).toEqual(['a', 'b', 'a', 'b'])
    expect(optional.map((r) => r.order)).toEqual(optional.map((_, i) => i + 1))
    for (const r of rulesets)
      expect(r.rules.map((rule) => rule.id)).toEqual(r.rules.map((_, i) => i + 1))
  })

  it('es determinista e independiente del orden de las líneas de la lista', () => {
    const shuffled = lists.map((l) => ({ ...l, rules: [...l.rules].reverse() }))
    const again = partitionRulesets(shuffled, OPTIONS)
    const signature = (rs: typeof rulesets) =>
      rs.map((r) => `${r.id}:${r.rules.map(canonical).sort().join('|')}`)
    expect(signature(again.rulesets)).toEqual(signature(rulesets))
  })

  it('la muestra del Core no son las primeras líneas de la lista', () => {
    const firstBlocksOfA = lists[0]!.rules
      .filter((r) => !isException(r))
      .slice(0, 28)
      .map(canonical)
    const coreBlocksOfA = core[0]!.rules.filter((r) => !isException(r)).map(canonical)
    expect(coreBlocksOfA.sort()).not.toEqual(firstBlocksOfA.sort())
  })

  it('cada lista conserva cobertura en el Core aunque sea muy pequeña', () => {
    const { stats: tiny } = partitionRulesets(
      [list('big', 'ads', 10_000, 0), list('tiny', 'trackers', 3, 0)],
      { coreBudget: 50, chunkSize: 1000 },
    )
    expect(tiny.find((s) => s.listId === 'tiny')!.coreBlocks).toBeGreaterThanOrEqual(1)
  })

  it('si todo cabe en el presupuesto, no hay opcionales', () => {
    const { rulesets: all } = partitionRulesets([list('a', 'ads', 5, 1)], OPTIONS)
    expect(all.map((r) => r.tier)).toEqual(['core'])
  })

  it('falla de forma explícita si las excepciones no caben en el Core', () => {
    expect(() => partitionRulesets([list('a', 'ads', 0, 150)], OPTIONS)).toThrow(/excepciones/)
  })
})
