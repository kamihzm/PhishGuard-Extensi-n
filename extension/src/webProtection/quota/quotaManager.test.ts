import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { ListCategory } from '../filters/types'
import {
  GUARANTEED_MINIMUM_STATIC_RULES,
  MAX_NUMBER_OF_ENABLED_STATIC_RULESETS,
  RESERVED_GUARANTEED_RULES,
} from './constants'
import { FakeDnr } from './fakeDnr'
import { applyQuotaPlan } from './quotaManager'
import type { RulesetIndex } from './types'

const HERE = dirname(fileURLToPath(import.meta.url))
/**
 * Índice REAL generado por `npm run wp:compile` (EasyList + EasyPrivacy). Las
 * cifras esperadas salen del reporte del compilador, no de constantes: así
 * los tests siguen siendo válidos cada vez que se actualizan las listas.
 */
const REAL_INDEX: RulesetIndex = JSON.parse(
  readFileSync(join(HERE, '../generated/rulesetIndex.json'), 'utf-8'),
)
const COMPILE_REPORT: { lists: Array<{ report: { acceptedExceptions: number } }> } = JSON.parse(
  readFileSync(join(HERE, '../../../../tools/webProtection/out/report.json'), 'utf-8'),
)
const reportedExceptions = COMPILE_REPORT.lists.reduce(
  (sum, l) => sum + l.report.acceptedExceptions,
  0,
)
const ALL: ReadonlySet<ListCategory> = new Set(['ads', 'trackers'])
const counts = Object.fromEntries(REAL_INDEX.rulesets.map((r) => [r.id, r.ruleCount]))
const core = REAL_INDEX.rulesets.filter((r) => r.tier === 'core')
const optional = REAL_INDEX.rulesets
  .filter((r) => r.tier === 'optional')
  .sort((a, b) => a.order - b.order)
const coreRules = core.reduce((sum, r) => sum + r.ruleCount, 0)
const totalRules = REAL_INDEX.rulesets.reduce((sum, r) => sum + r.ruleCount, 0)

function fake(
  globalAvailable: number,
  extra: Partial<ConstructorParameters<typeof FakeDnr>[0]> = {},
) {
  return new FakeDnr({ rulesets: counts, globalAvailable, ...extra })
}

describe('índice real: invariantes de la partición', () => {
  it('el Core cubre ambas listas y no supera el mínimo garantizado', () => {
    expect(core.map((r) => r.listId).sort()).toEqual(['easylist', 'easyprivacy'])
    expect(coreRules).toBeLessThanOrEqual(REAL_INDEX.coreRuleBudget)
    expect(coreRules).toBeLessThanOrEqual(GUARANTEED_MINIMUM_STATIC_RULES)
  })

  it('todas las excepciones están en el Core (siempre activas)', () => {
    expect(optional.every((r) => r.exceptionCount === 0)).toBe(true)
    // Coincide con las excepciones aceptadas que informa el compilador (2026-09-29: 545 + 845).
    expect(core.reduce((sum, r) => sum + r.exceptionCount, 0)).toBe(reportedExceptions)
  })

  it('los opcionales respetan el tamaño máximo y alternan las listas', () => {
    expect(optional.every((r) => r.ruleCount <= REAL_INDEX.optionalChunkSize)).toBe(true)
    expect(optional.slice(0, 4).map((r) => r.listId)).toEqual([
      'easylist',
      'easyprivacy',
      'easylist',
      'easyprivacy',
    ])
    expect(REAL_INDEX.rulesets.length).toBeLessThanOrEqual(MAX_NUMBER_OF_ENABLED_STATIC_RULESETS)
  })
})

describe('applyQuotaPlan: escenarios de cuota', () => {
  it('solo cuota garantizada (sin cuota global libre): el Core funciona y ningún opcional se habilita', async () => {
    const dnr = fake(0)
    const status = await applyQuotaPlan(dnr, REAL_INDEX, { enabledCategories: ALL })
    expect(status.coreEnabled.sort()).toEqual(core.map((r) => r.id).sort())
    expect(status.coreFailed).toEqual([])
    expect(status.optionalEnabled).toEqual([])
    expect(status.optionalSkippedForQuota).toHaveLength(optional.length)
    expect(status.activeRuleCount).toBe(coreRules)
    // La reserva del mínimo garantizado (Fases E/F) queda intacta.
    expect(status.availableAfter).toBe(GUARANTEED_MINIMUM_STATIC_RULES - coreRules)
    expect(status.availableAfter).toBeGreaterThanOrEqual(RESERVED_GUARANTEED_RULES)
  })

  it('sin reserva configurada, la cuota garantizada sobrante sí se usa para opcionales', async () => {
    const status = await applyQuotaPlan(fake(0), REAL_INDEX, {
      enabledCategories: ALL,
      reservedRuleCount: 0,
    })
    expect(status.optionalEnabled).toEqual([optional[0]!.id])
  })

  it('cuota superior a 30 000 pero insuficiente para todo: habilita opcionales en orden sin excederla', async () => {
    // 50 000 en total: Core 25 000 + reserva 5 000 → 20 000 para opcionales (4 de 5 000).
    const dnr = fake(20_000)
    const status = await applyQuotaPlan(dnr, REAL_INDEX, { enabledCategories: ALL })
    expect(status.optionalEnabled).toEqual(optional.slice(0, 4).map((r) => r.id))
    expect(status.availableAfter).toBe(RESERVED_GUARANTEED_RULES)
    expect(new Set(status.optionalEnabled.map((id) => id.split('-')[1]))).toEqual(
      new Set(['easylist', 'easyprivacy']),
    )
    expect(status.activeRuleCount).toBeLessThanOrEqual(GUARANTEED_MINIMUM_STATIC_RULES + 20_000)
    expect(status.availableAfter).toBeGreaterThanOrEqual(0)
    expect(dnr.calls.every((call) => call.ok)).toBe(true)
  })

  it('si los opcionales grandes no caben, aprovecha uno más pequeño que sí cabe', async () => {
    const smallest = [...optional].sort((a, b) => a.ruleCount - b.ruleCount)[0]!
    // Cuota libre por encima de la reserva = exactamente el opcional más pequeño.
    const globalAvailable =
      coreRules + RESERVED_GUARANTEED_RULES + smallest.ruleCount - GUARANTEED_MINIMUM_STATIC_RULES
    const status = await applyQuotaPlan(fake(globalAvailable), REAL_INDEX, {
      enabledCategories: ALL,
    })
    expect(status.optionalEnabled).toEqual([smallest.id])
    expect(status.availableAfter).toBe(RESERVED_GUARANTEED_RULES)
  })

  it('cuota suficiente para todas las reglas: habilita los 19 rulesets', async () => {
    const dnr = fake(300_000)
    const status = await applyQuotaPlan(dnr, REAL_INDEX, { enabledCategories: ALL })
    expect(status.optionalEnabled).toEqual(optional.map((r) => r.id))
    expect(status.optionalSkippedForQuota).toEqual([])
    expect(status.activeRuleCount).toBe(totalRules)
    expect(await dnr.getAvailableStaticRuleCount()).toBe(
      GUARANTEED_MINIMUM_STATIC_RULES + 300_000 - totalRules,
    )
  })

  it('fallo al habilitar un opcional: se registra, se sigue con el resto y el Core no se toca', async () => {
    const failing = optional[2]!.id
    const dnr = fake(300_000, { failOn: [failing] })
    const status = await applyQuotaPlan(dnr, REAL_INDEX, { enabledCategories: ALL })
    expect(status.optionalFailed).toEqual([{ id: failing, message: 'Fallo simulado de Chrome' }])
    expect(status.optionalEnabled).toEqual(
      optional.filter((r) => r.id !== failing).map((r) => r.id),
    )
    expect(status.coreEnabled).toHaveLength(2)
    expect([...dnr.enabled]).toEqual(expect.arrayContaining(core.map((r) => r.id)))
  })
})

describe('applyQuotaPlan: mantenimiento del Core', () => {
  it('re-habilita un Core que estaba deshabilitado', async () => {
    const dnr = fake(0, { enabled: ['wp-easylist-core'] })
    const status = await applyQuotaPlan(dnr, REAL_INDEX, { enabledCategories: ALL })
    expect(status.coreEnabled.sort()).toEqual(['wp-easylist-core', 'wp-easyprivacy-core'])
  })

  it('nunca deshabilita el Core para hacer sitio a opcionales, aunque la cuota global se agote', async () => {
    // Opcionales ya habilitados en una sesión anterior y ahora sin cuota global libre.
    const dnr = fake(0, { enabled: [...core.map((r) => r.id), optional[0]!.id] })
    const status = await applyQuotaPlan(dnr, REAL_INDEX, { enabledCategories: ALL })
    expect(dnr.calls.flatMap((call) => call.disable)).toEqual([])
    expect(status.coreEnabled).toHaveLength(2)
    expect(status.optionalEnabled).toEqual([optional[0]!.id])
  })

  it('si un Core falla, el Core de la otra categoría se mantiene y el fallo queda registrado', async () => {
    const dnr = fake(0, { failOn: ['wp-easyprivacy-core'] })
    const status = await applyQuotaPlan(dnr, REAL_INDEX, { enabledCategories: ALL })
    expect(status.coreEnabled).toEqual(['wp-easylist-core'])
    expect(status.coreFailed.map((f) => f.id)).toEqual(['wp-easyprivacy-core'])
  })

  it('es idempotente: aplicarlo dos veces no cambia el resultado ni hace llamadas nuevas de habilitación', async () => {
    const dnr = fake(20_000)
    const first = await applyQuotaPlan(dnr, REAL_INDEX, { enabledCategories: ALL })
    const callsAfterFirst = dnr.calls.length
    const second = await applyQuotaPlan(dnr, REAL_INDEX, { enabledCategories: ALL })
    expect(second.optionalEnabled).toEqual(first.optionalEnabled)
    expect(second.coreEnabled.sort()).toEqual(first.coreEnabled.sort())
    expect(dnr.calls.length).toBe(callsAfterFirst)
  })
})

describe('applyQuotaPlan: categorías', () => {
  it('desactivar rastreadores deshabilita su Core y sus opcionales, sin afectar a los anuncios', async () => {
    const dnr = fake(300_000)
    await applyQuotaPlan(dnr, REAL_INDEX, { enabledCategories: ALL })
    const status = await applyQuotaPlan(dnr, REAL_INDEX, { enabledCategories: new Set(['ads']) })
    const trackerIds = REAL_INDEX.rulesets.filter((r) => r.category === 'trackers').map((r) => r.id)
    expect(status.disabled.sort()).toEqual(trackerIds.sort())
    expect([...dnr.enabled].every((id) => id.startsWith('wp-easylist-'))).toBe(true)
    expect(status.coreEnabled).toEqual(['wp-easylist-core'])
  })

  it('no toca rulesets ajenos al índice (por ejemplo, futuros de otras fases)', async () => {
    const dnr = new FakeDnr({
      rulesets: { ...counts, 'otro-ruleset': 100 },
      globalAvailable: 0,
      enabled: ['otro-ruleset'],
    })
    await applyQuotaPlan(dnr, REAL_INDEX, { enabledCategories: new Set() })
    expect(dnr.enabled.has('otro-ruleset')).toBe(true)
  })
})
