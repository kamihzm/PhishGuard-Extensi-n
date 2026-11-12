import type { ListCategory } from '../filters/types'
import { applyQuotaPlan } from '../quota/quotaManager'
import type { DnrStaticRulesetApi, RulesetIndex } from '../quota/types'
import { enabledCategoriesOf, type WebProtectionSettings } from '../settings'

export type ReconcileReason = 'installed' | 'startup' | 'settings-changed'

export type ReconcileOutcome =
  /** Plan aplicado (puede incluir opcionales omitidos por cuota o fallidos, registrados). */
  | 'applied'
  /** No se pudo leer la configuración: se deshabilitó Web Protection (fail-open). */
  | 'settings-unreadable'
  /** Error inesperado de la API DNR: se deshabilitó Web Protection (fail-open). */
  | 'failed-open'

/** Resumen sin datos de navegación: solo ids de rulesets y conteos. */
export interface ReconcileSummary {
  reason: ReconcileReason
  outcome: ReconcileOutcome
  categories: ListCategory[]
  activeRuleCount: number
  coreEnabled: string[]
  coreFailed: string[]
  optionalEnabled: number
  optionalSkippedForQuota: number
  optionalFailed: string[]
  at: string
}

export type LogLevel = 'info' | 'warn' | 'error'

export interface ReconcileDeps {
  dnr: DnrStaticRulesetApi
  index: RulesetIndex
  readSettings(): Promise<WebProtectionSettings>
  /** Guarda el último resumen para diagnóstico/UI; un fallo aquí nunca afecta a la reconciliación. */
  writeStatus?(summary: ReconcileSummary): Promise<void>
  log(level: LogLevel, message: string): void
  now?(): Date
}

const TAG = '[WebProtection]'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Fail-open: deshabilita todos los rulesets de Web Protection que estén habilitados. */
async function disableAllWebProtection(deps: ReconcileDeps): Promise<void> {
  const ids = new Set(deps.index.rulesets.map((ruleset) => ruleset.id))
  const enabled = (await deps.dnr.getEnabledRulesets()).filter((id) => ids.has(id))
  if (enabled.length > 0) await deps.dnr.updateEnabledRulesets({ disableRulesetIds: enabled })
}

/**
 * Lleva los rulesets de Web Protection al estado que indica la
 * configuración guardada, mediante el gestor de cuota (Core siempre,
 * opcionales según la cuota real). Si algo es ambiguo o falla de forma
 * inesperada, FAIL-OPEN: se deshabilita Web Protection en vez de dejar un
 * estado de bloqueo desconocido. Nunca toca el motor de phishing.
 */
export async function reconcileWebProtection(
  deps: ReconcileDeps,
  reason: ReconcileReason,
): Promise<ReconcileSummary> {
  const at = (deps.now?.() ?? new Date()).toISOString()
  const base: ReconcileSummary = {
    reason,
    outcome: 'applied',
    categories: [],
    activeRuleCount: 0,
    coreEnabled: [],
    coreFailed: [],
    optionalEnabled: 0,
    optionalSkippedForQuota: 0,
    optionalFailed: [],
    at,
  }

  const finish = async (summary: ReconcileSummary): Promise<ReconcileSummary> => {
    try {
      await deps.writeStatus?.(summary)
    } catch (error) {
      deps.log('warn', `${TAG} no se pudo guardar el estado: ${errorMessage(error)}`)
    }
    return summary
  }

  const failOpen = async (outcome: ReconcileOutcome, cause: unknown) => {
    deps.log(
      'error',
      `${TAG} ${outcome} (${reason}): ${errorMessage(cause)}; se deshabilita (fail-open)`,
    )
    try {
      await disableAllWebProtection(deps)
    } catch (error) {
      deps.log('error', `${TAG} no se pudo deshabilitar tras el fallo: ${errorMessage(error)}`)
    }
    return finish({ ...base, outcome })
  }

  let settings: WebProtectionSettings
  try {
    settings = await deps.readSettings()
  } catch (error) {
    return failOpen('settings-unreadable', error)
  }
  const categories = enabledCategoriesOf(settings)

  try {
    const status = await applyQuotaPlan(deps.dnr, deps.index, { enabledCategories: categories })
    const summary: ReconcileSummary = {
      ...base,
      categories: [...categories].sort(),
      activeRuleCount: status.activeRuleCount,
      coreEnabled: status.coreEnabled,
      coreFailed: status.coreFailed.map((failure) => failure.id),
      optionalEnabled: status.optionalEnabled.length,
      optionalSkippedForQuota: status.optionalSkippedForQuota.length,
      optionalFailed: status.optionalFailed.map((failure) => failure.id),
    }
    deps.log(
      'info',
      `${TAG} ${reason}: categorías [${summary.categories.join(', ')}], ${summary.activeRuleCount} reglas activas ` +
        `(Core ${summary.coreEnabled.length}, opcionales ${summary.optionalEnabled}, ` +
        `omitidos por cuota ${summary.optionalSkippedForQuota})`,
    )
    for (const failure of [...status.coreFailed, ...status.optionalFailed]) {
      deps.log('warn', `${TAG} no se pudo habilitar ${failure.id}: ${failure.message}`)
    }
    return finish(summary)
  } catch (error) {
    return failOpen('failed-open', error)
  }
}

/**
 * Serializa las reconciliaciones (instalación, arranque, cambios de
 * toggles): nunca corren dos a la vez. Si llegan varios pedidos mientras
 * una corre, se agrupan en UNA sola ejecución posterior, que lee la
 * configuración más reciente.
 */
export function createReconciler(deps: ReconcileDeps): {
  run(reason: ReconcileReason): Promise<ReconcileSummary>
} {
  let tail: Promise<unknown> = Promise.resolve()
  let waiting: Promise<ReconcileSummary> | null = null
  return {
    run(reason) {
      if (waiting) return waiting
      const next = tail.then(() => {
        waiting = null
        return reconcileWebProtection(deps, reason)
      })
      waiting = next
      tail = next.catch(() => undefined)
      return next
    },
  }
}
