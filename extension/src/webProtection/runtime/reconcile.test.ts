import { describe, expect, it } from 'vitest'
import rulesetIndex from '../generated/rulesetIndex.json'
import { FakeDnr } from '../quota/fakeDnr'
import type { DnrStaticRulesetApi, RulesetIndex } from '../quota/types'
import type { WebProtectionSettings } from '../settings'
import { createReconciler, reconcileWebProtection, type ReconcileDeps } from './reconcile'

const INDEX = rulesetIndex as RulesetIndex
const COUNTS = Object.fromEntries(INDEX.rulesets.map((r) => [r.id, r.ruleCount]))
const ALL_IDS = INDEX.rulesets.map((r) => r.id)
const idsOf = (listId: string) => INDEX.rulesets.filter((r) => r.listId === listId).map((r) => r.id)
const BOTH: WebProtectionSettings = { adsEnabled: true, trackersEnabled: true }

function deps(
  dnr: DnrStaticRulesetApi,
  settings: () => Promise<WebProtectionSettings>,
  logs: string[] = [],
): ReconcileDeps {
  return {
    dnr,
    index: INDEX,
    readSettings: settings,
    log: (level, message) => logs.push(`${level}: ${message}`),
    now: () => new Date('2026-09-29T12:00:00Z'),
  }
}

describe('reconcileWebProtection: activación controlada según los toggles', () => {
  it('instalación con ambos toggles activos y cuota libre: todos los rulesets y todas sus reglas', async () => {
    const dnr = new FakeDnr({ rulesets: COUNTS, globalAvailable: 300_000 })
    const summary = await reconcileWebProtection(
      deps(dnr, async () => BOTH),
      'installed',
    )
    expect(summary.outcome).toBe('applied')
    expect(summary.categories).toEqual(['ads', 'trackers'])
    expect([...dnr.enabled].sort()).toEqual([...ALL_IDS].sort())
    // Suma del índice real (no una constante: cambia con cada actualización de las listas).
    expect(summary.activeRuleCount).toBe(INDEX.rulesets.reduce((sum, r) => sum + r.ruleCount, 0))
  })

  it('solo cuota garantizada: queda activo el Core de ambas listas', async () => {
    const dnr = new FakeDnr({ rulesets: COUNTS, globalAvailable: 0 })
    const summary = await reconcileWebProtection(
      deps(dnr, async () => BOTH),
      'installed',
    )
    expect(summary.coreEnabled.sort()).toEqual(['wp-easylist-core', 'wp-easyprivacy-core'])
    expect(summary.optionalEnabled).toBe(0)
    expect(summary.optionalSkippedForQuota).toBe(17)
  })

  it('anuncios desactivado: se deshabilita todo EasyList y se conserva EasyPrivacy', async () => {
    const dnr = new FakeDnr({ rulesets: COUNTS, globalAvailable: 300_000, enabled: ALL_IDS })
    const summary = await reconcileWebProtection(
      deps(dnr, async () => ({ adsEnabled: false, trackersEnabled: true })),
      'settings-changed',
    )
    expect(summary.categories).toEqual(['trackers'])
    expect([...dnr.enabled].sort()).toEqual(idsOf('easyprivacy').sort())
  })

  it('rastreadores desactivado: se deshabilita todo EasyPrivacy y se conserva EasyList', async () => {
    const dnr = new FakeDnr({ rulesets: COUNTS, globalAvailable: 300_000, enabled: ALL_IDS })
    await reconcileWebProtection(
      deps(dnr, async () => ({ adsEnabled: true, trackersEnabled: false })),
      'settings-changed',
    )
    expect([...dnr.enabled].sort()).toEqual(idsOf('easylist').sort())
  })

  it('ambos desactivados: no queda ningún ruleset de Web Protection habilitado', async () => {
    const dnr = new FakeDnr({ rulesets: COUNTS, globalAvailable: 300_000, enabled: ALL_IDS })
    const summary = await reconcileWebProtection(
      deps(dnr, async () => ({ adsEnabled: false, trackersEnabled: false })),
      'settings-changed',
    )
    expect(dnr.enabled.size).toBe(0)
    expect(summary.activeRuleCount).toBe(0)
  })

  it('un opcional que falla se registra y el resto queda aplicado', async () => {
    const failing = 'wp-easyprivacy-opt-03'
    const dnr = new FakeDnr({ rulesets: COUNTS, globalAvailable: 300_000, failOn: [failing] })
    const logs: string[] = []
    const summary = await reconcileWebProtection(
      deps(dnr, async () => BOTH, logs),
      'installed',
    )
    expect(summary.outcome).toBe('applied')
    expect(summary.optionalFailed).toEqual([failing])
    expect(dnr.enabled.has('wp-easylist-core')).toBe(true)
    expect(logs.some((l) => l.startsWith('warn:') && l.includes(failing))).toBe(true)
  })
})

describe('reconcileWebProtection: fail-open', () => {
  it('configuración ilegible: deshabilita Web Protection en vez de dejar un estado ambiguo', async () => {
    const dnr = new FakeDnr({ rulesets: COUNTS, globalAvailable: 300_000, enabled: ALL_IDS })
    const summary = await reconcileWebProtection(
      deps(dnr, async () => {
        throw new Error('storage no disponible')
      }),
      'startup',
    )
    expect(summary.outcome).toBe('settings-unreadable')
    expect(dnr.enabled.size).toBe(0)
  })

  it('error inesperado de la API DNR: deshabilita Web Protection (fail-open)', async () => {
    const fake = new FakeDnr({ rulesets: COUNTS, globalAvailable: 300_000, enabled: ALL_IDS })
    const broken: DnrStaticRulesetApi = {
      getEnabledRulesets: () => fake.getEnabledRulesets(),
      updateEnabledRulesets: (options) => fake.updateEnabledRulesets(options),
      getAvailableStaticRuleCount: async () => {
        throw new Error('API no disponible')
      },
    }
    const summary = await reconcileWebProtection(
      deps(broken, async () => BOTH),
      'startup',
    )
    expect(summary.outcome).toBe('failed-open')
    expect(fake.enabled.size).toBe(0)
  })

  it('no toca rulesets ajenos a Web Protection al hacer fail-open', async () => {
    const dnr = new FakeDnr({
      rulesets: { ...COUNTS, 'otro-ruleset': 10 },
      globalAvailable: 300_000,
      enabled: [...ALL_IDS, 'otro-ruleset'],
    })
    await reconcileWebProtection(
      deps(dnr, async () => {
        throw new Error('x')
      }),
      'startup',
    )
    expect([...dnr.enabled]).toEqual(['otro-ruleset'])
  })

  it('un fallo al guardar el estado no altera la reconciliación', async () => {
    const dnr = new FakeDnr({ rulesets: COUNTS, globalAvailable: 300_000 })
    const summary = await reconcileWebProtection(
      {
        ...deps(dnr, async () => BOTH),
        writeStatus: async () => {
          throw new Error('session no disponible')
        },
      },
      'installed',
    )
    expect(summary.outcome).toBe('applied')
    expect(dnr.enabled.size).toBe(19)
  })

  it('los registros no contienen URLs ni datos de navegación', async () => {
    const logs: string[] = []
    const dnr = new FakeDnr({
      rulesets: COUNTS,
      globalAvailable: 20_000,
      failOn: ['wp-easylist-opt-01'],
    })
    await reconcileWebProtection(
      deps(dnr, async () => BOTH, logs),
      'installed',
    )
    await reconcileWebProtection(
      deps(
        dnr,
        async () => {
          throw new Error('x')
        },
        logs,
      ),
      'startup',
    )
    expect(logs.length).toBeGreaterThan(0)
    expect(logs.every((l) => l.includes('[WebProtection]'))).toBe(true)
    expect(logs.some((l) => /https?:|www\.|\?[a-z]+=/i.test(l))).toBe(false)
  })
})

describe('createReconciler: serialización', () => {
  it('nunca ejecuta dos reconciliaciones a la vez y termina con la configuración más reciente', async () => {
    let current: WebProtectionSettings = BOTH
    let active = 0
    let maxActive = 0
    const fake = new FakeDnr({ rulesets: COUNTS, globalAvailable: 300_000 })
    const slow: DnrStaticRulesetApi = {
      getAvailableStaticRuleCount: () => fake.getAvailableStaticRuleCount(),
      getEnabledRulesets: async () => {
        active++
        maxActive = Math.max(maxActive, active)
        await new Promise((resolve) => setTimeout(resolve, 5))
        active--
        return fake.getEnabledRulesets()
      },
      updateEnabledRulesets: (options) => fake.updateEnabledRulesets(options),
    }
    const reconciler = createReconciler(deps(slow, async () => current))
    const first = reconciler.run('installed')
    current = { adsEnabled: false, trackersEnabled: true }
    const second = reconciler.run('settings-changed')
    current = { adsEnabled: false, trackersEnabled: false }
    const third = reconciler.run('settings-changed')
    expect(third).toBe(second) // los pedidos en espera se agrupan en una sola ejecución
    await Promise.all([first, second, third])
    expect(maxActive).toBe(1)
    expect(fake.enabled.size).toBe(0)
  })
})
