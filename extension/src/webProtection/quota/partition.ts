import type { DnrRule, ListCategory } from '../filters/types'
import { MAX_NUMBER_OF_STATIC_RULESETS } from './constants'
import type { RulesetTier } from './types'

export interface CompiledList {
  listId: string
  category: ListCategory
  rules: DnrRule[]
}

export interface PartitionOptions {
  /** Máximo de reglas (bloqueos + excepciones) entre TODOS los rulesets Core. */
  coreBudget: number
  /** Máximo de reglas por ruleset opcional. */
  chunkSize: number
}

export interface PartitionedRuleset {
  id: string
  listId: string
  category: ListCategory
  tier: RulesetTier
  /** Orden global de habilitación de los opcionales; 0 en el Core. */
  order: number
  exceptionCount: number
  /** Reglas con `id` reasignado 1..n (DNR exige ids únicos dentro de cada ruleset). */
  rules: DnrRule[]
}

export interface ListPartitionStats {
  listId: string
  rules: number
  exceptions: number
  blocks: number
  coreBlocks: number
  optionalBlocks: number
  optionalRulesets: number
}

export interface PartitionResult {
  rulesets: PartitionedRuleset[]
  stats: ListPartitionStats[]
  coreRuleCount: number
}

/** Excepciones: deben estar SIEMPRE activas, porque anulan bloqueos de cualquier ruleset habilitado. */
export function isException(rule: DnrRule): boolean {
  return rule.action.type !== 'block'
}

/** Forma canónica de una regla sin `id`: igual texto ⇔ igual regla DNR. */
function canonical(rule: DnrRule): string {
  const { id: _id, ...rest } = rule
  return JSON.stringify(rest)
}

/** FNV-1a de 32 bits: hash estable y sin dependencias, suficiente para ordenar de forma uniforme y reproducible. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/**
 * Orden determinista por contenido (hash + canónico como desempate). No
 * depende de la posición en la lista: las primeras líneas no se consideran
 * más importantes, y una regla conserva su lugar aunque la lista cambie
 * de orden o gane o pierda otras reglas.
 */
function byContentHash(rules: DnrRule[]): DnrRule[] {
  return rules
    .map((rule) => ({ rule, key: canonical(rule), hash: fnv1a(canonical(rule)) }))
    .sort((a, b) => a.hash - b.hash || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((entry) => entry.rule)
}

/**
 * Reparte el presupuesto de bloqueos del Core entre las listas en
 * proporción a su número de bloqueos (restos por mayor fracción; empates
 * por `listId`). Cada lista con bloqueos recibe al menos 1, para que el
 * Core cubra todas las listas, y nunca más de los que tiene.
 */
function allocateCoreBlocks(blocksPerList: number[], listIds: string[], budget: number): number[] {
  const totalBlocks = blocksPerList.reduce((sum, n) => sum + n, 0)
  if (budget >= totalBlocks) return [...blocksPerList]
  const exact = blocksPerList.map((n) => (budget * n) / totalBlocks)
  const quotas = exact.map((value, i) => Math.min(blocksPerList[i]!, Math.floor(value)))
  let remaining = budget - quotas.reduce((sum, n) => sum + n, 0)
  const byFraction = exact
    .map((value, i) => ({ i, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || listIds[a.i]!.localeCompare(listIds[b.i]!))
  for (const { i } of byFraction) {
    if (remaining <= 0) break
    if (quotas[i]! < blocksPerList[i]!) {
      quotas[i]!++
      remaining--
    }
  }
  quotas.forEach((quota, i) => {
    if (quota === 0 && blocksPerList[i]! > 0) {
      const donor = quotas.indexOf(Math.max(...quotas))
      quotas[donor]!--
      quotas[i] = 1
    }
  })
  return quotas
}

const withIds = (rules: DnrRule[]): DnrRule[] => rules.map((rule, i) => ({ ...rule, id: i + 1 }))

/**
 * Parte las reglas compiladas en un Core por lista (todas sus excepciones
 * más una muestra determinista de bloqueos, dentro de `coreBudget`) y en
 * rulesets opcionales de hasta `chunkSize` reglas. Los opcionales se
 * ordenan intercalando las listas (a-01, b-01, a-02, b-02…) para que una
 * cuota parcial siga cubriendo ambas.
 */
export function partitionRulesets(
  lists: CompiledList[],
  options: PartitionOptions,
): PartitionResult {
  const sortedLists = [...lists].sort((a, b) => a.listId.localeCompare(b.listId))
  const split = sortedLists.map((list) => ({
    list,
    exceptions: byContentHash(list.rules.filter(isException)),
    blocks: byContentHash(list.rules.filter((rule) => !isException(rule))),
  }))

  const totalExceptions = split.reduce((sum, s) => sum + s.exceptions.length, 0)
  if (totalExceptions > options.coreBudget) {
    throw new Error(
      `Las ${totalExceptions} excepciones no caben en el Core (${options.coreBudget}): no se pueden garantizar`,
    )
  }
  const coreBlockQuotas = allocateCoreBlocks(
    split.map((s) => s.blocks.length),
    split.map((s) => s.list.listId),
    options.coreBudget - totalExceptions,
  )

  const core: PartitionedRuleset[] = []
  const optionalByList: PartitionedRuleset[][] = []
  const stats: ListPartitionStats[] = []
  split.forEach(({ list, exceptions, blocks }, i) => {
    const coreBlocks = blocks.slice(0, coreBlockQuotas[i])
    const rest = blocks.slice(coreBlockQuotas[i])
    core.push({
      id: `wp-${list.listId}-core`,
      listId: list.listId,
      category: list.category,
      tier: 'core',
      order: 0,
      exceptionCount: exceptions.length,
      rules: withIds([...exceptions, ...coreBlocks]),
    })
    const chunks: PartitionedRuleset[] = []
    for (let start = 0; start < rest.length; start += options.chunkSize) {
      chunks.push({
        id: `wp-${list.listId}-opt-${String(chunks.length + 1).padStart(2, '0')}`,
        listId: list.listId,
        category: list.category,
        tier: 'optional',
        order: 0,
        exceptionCount: 0,
        rules: withIds(rest.slice(start, start + options.chunkSize)),
      })
    }
    optionalByList.push(chunks)
    stats.push({
      listId: list.listId,
      rules: list.rules.length,
      exceptions: exceptions.length,
      blocks: blocks.length,
      coreBlocks: coreBlocks.length,
      optionalBlocks: rest.length,
      optionalRulesets: chunks.length,
    })
  })

  const optional: PartitionedRuleset[] = []
  const maxChunks = Math.max(0, ...optionalByList.map((chunks) => chunks.length))
  for (let round = 0; round < maxChunks; round++) {
    for (const chunks of optionalByList) {
      const chunk = chunks[round]
      if (chunk) optional.push({ ...chunk, order: optional.length + 1 })
    }
  }

  const rulesets = [...core, ...optional]
  if (rulesets.length > MAX_NUMBER_OF_STATIC_RULESETS) {
    throw new Error(
      `${rulesets.length} rulesets superan el máximo de ${MAX_NUMBER_OF_STATIC_RULESETS} declarables`,
    )
  }
  return {
    rulesets,
    stats,
    coreRuleCount: core.reduce((sum, ruleset) => sum + ruleset.rules.length, 0),
  }
}
