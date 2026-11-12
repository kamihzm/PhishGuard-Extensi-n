import type { ListCategory } from '../filters/types'
import { MAX_NUMBER_OF_ENABLED_STATIC_RULESETS, RESERVED_GUARANTEED_RULES } from './constants'
import type {
  DnrStaticRulesetApi,
  OptionalRulesetFailure,
  QuotaStatus,
  RulesetDescriptor,
  RulesetIndex,
} from './types'

export interface QuotaPlanOptions {
  /** Categorías de Web Protection activas (por ejemplo, anuncios y rastreadores). */
  enabledCategories: ReadonlySet<ListCategory>
  /**
   * Reglas de la cuota que los opcionales NUNCA pueden consumir: la reserva
   * del mínimo garantizado para futuras reglas estáticas que también deben
   * funcionar siempre (amenazas conocidas y strict block, Fases E y F).
   * Cuando esas reglas existan y estén habilitadas, ya descuentan de
   * `getAvailableStaticRuleCount()` y la reserva pendiente será menor.
   */
  reservedRuleCount?: number
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Aplica la estrategia de cuota adaptativa en dos niveles:
 *
 * 1. Deshabilita los rulesets (Core y opcionales) de las categorías
 *    desactivadas.
 * 2. **Core:** asegura que el Core de cada categoría activa esté
 *    habilitado. Cabe en el mínimo garantizado de Chrome, así que
 *    funciona aunque no haya cuota global libre. Nunca se deshabilita el
 *    Core para hacer sitio a un opcional.
 * 3. **Opcionales:** en su orden global (listas intercaladas), habilita
 *    cada uno solo si `getAvailableStaticRuleCount()` menos la reserva
 *    garantizada (`reservedRuleCount`) alcanza para sus reglas y no se
 *    supera el máximo de rulesets habilitados. Tras cada
 *    intento vuelve a consultar la cuota real. Si un opcional falla, se
 *    registra y se sigue con el resto, sin afectar al Core.
 *
 * Es idempotente: se puede llamar al iniciar la extensión, al instalarla
 * o al cambiar la configuración. No usa reglas dinámicas: el excedente de
 * las listas nunca se traslada a ellas.
 */
export async function applyQuotaPlan(
  api: DnrStaticRulesetApi,
  index: RulesetIndex,
  options: QuotaPlanOptions,
): Promise<QuotaStatus> {
  const inIndex = new Map(index.rulesets.map((ruleset) => [ruleset.id, ruleset]))
  const isWanted = (ruleset: RulesetDescriptor) => options.enabledCategories.has(ruleset.category)
  const enabled = new Set((await api.getEnabledRulesets()).filter((id) => inIndex.has(id)))

  const status: QuotaStatus = {
    coreEnabled: [],
    coreFailed: [],
    optionalEnabled: [],
    optionalSkippedForQuota: [],
    optionalFailed: [],
    disabled: [],
    activeRuleCount: 0,
    availableBefore: 0,
    availableAfter: 0,
  }

  // 1. Categorías desactivadas.
  const toDisable = [...enabled].filter((id) => !isWanted(inIndex.get(id)!))
  if (toDisable.length > 0) {
    await api.updateEnabledRulesets({ disableRulesetIds: toDisable })
    toDisable.forEach((id) => enabled.delete(id))
    status.disabled = toDisable
  }

  // 2. Core: siempre primero, siempre dentro de la cuota garantizada.
  const core = index.rulesets.filter((ruleset) => ruleset.tier === 'core' && isWanted(ruleset))
  const missingCore = core
    .filter((ruleset) => !enabled.has(ruleset.id))
    .map((ruleset) => ruleset.id)
  if (missingCore.length > 0) {
    try {
      await api.updateEnabledRulesets({ enableRulesetIds: missingCore })
      missingCore.forEach((id) => enabled.add(id))
    } catch {
      // Uno a uno, para no perder el Core de una categoría por un fallo en otra.
      for (const id of missingCore) {
        try {
          await api.updateEnabledRulesets({ enableRulesetIds: [id] })
          enabled.add(id)
        } catch (error) {
          status.coreFailed.push({ id, message: errorMessage(error) })
        }
      }
    }
  }
  status.coreEnabled = core
    .filter((ruleset) => enabled.has(ruleset.id))
    .map((ruleset) => ruleset.id)

  // 3. Opcionales, en orden, según la cuota REAL disponible por encima de la reserva.
  const reserve = options.reservedRuleCount ?? RESERVED_GUARANTEED_RULES
  let available = await api.getAvailableStaticRuleCount()
  status.availableBefore = available
  const optional = index.rulesets
    .filter((ruleset) => ruleset.tier === 'optional' && isWanted(ruleset))
    .sort((a, b) => a.order - b.order)
  const failures: OptionalRulesetFailure[] = []
  for (const ruleset of optional) {
    if (enabled.has(ruleset.id)) {
      status.optionalEnabled.push(ruleset.id)
      continue
    }
    if (
      ruleset.ruleCount > available - reserve ||
      enabled.size >= MAX_NUMBER_OF_ENABLED_STATIC_RULESETS
    ) {
      status.optionalSkippedForQuota.push(ruleset.id)
      continue
    }
    try {
      await api.updateEnabledRulesets({ enableRulesetIds: [ruleset.id] })
      enabled.add(ruleset.id)
      status.optionalEnabled.push(ruleset.id)
    } catch (error) {
      failures.push({ id: ruleset.id, message: errorMessage(error) })
    }
    available = await api.getAvailableStaticRuleCount()
  }
  status.optionalFailed = failures
  status.availableAfter = available
  status.activeRuleCount = [...enabled].reduce(
    (sum, id) => sum + (inIndex.get(id)?.ruleCount ?? 0),
    0,
  )
  return status
}
