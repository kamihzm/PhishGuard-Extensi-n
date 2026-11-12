import { GUARANTEED_MINIMUM_STATIC_RULES, MAX_NUMBER_OF_ENABLED_STATIC_RULESETS } from './constants'
import type { DnrStaticRulesetApi } from './types'

export interface FakeDnrOptions {
  /** Reglas por ruleset declarado en el manifest. */
  rulesets: Record<string, number>
  /** Cuota global compartida que queda libre (otras extensiones pueden haberla consumido). */
  globalAvailable: number
  enabled?: string[]
  /** Rulesets cuyo `updateEnabledRulesets` falla siempre (fallo simulado de Chrome). */
  failOn?: string[]
}

/**
 * Simulación de `chrome.declarativeNetRequest` para rulesets estáticos,
 * SOLO para tests. Reproduce la semántica medida en Chrome for Testing 154:
 * `getAvailableStaticRuleCount() = garantizado + global libre − reglas
 * habilitadas` (330 000 sin nada habilitado, 224 541 con 105 459 reglas).
 * Una actualización que supere la cuota o el máximo de rulesets
 * habilitados se rechaza entera, sin cambios parciales, como en Chrome.
 */
export class FakeDnr implements DnrStaticRulesetApi {
  readonly enabled: Set<string>
  readonly calls: Array<{ enable: string[]; disable: string[]; ok: boolean }> = []
  constructor(private readonly options: FakeDnrOptions) {
    this.enabled = new Set(options.enabled ?? [])
  }

  private totalEnabledRules(ids: Iterable<string>): number {
    let total = 0
    for (const id of ids) total += this.options.rulesets[id] ?? 0
    return total
  }

  async getAvailableStaticRuleCount(): Promise<number> {
    return (
      GUARANTEED_MINIMUM_STATIC_RULES +
      this.options.globalAvailable -
      this.totalEnabledRules(this.enabled)
    )
  }

  async getEnabledRulesets(): Promise<string[]> {
    return [...this.enabled]
  }

  async updateEnabledRulesets(update: {
    enableRulesetIds?: string[]
    disableRulesetIds?: string[]
  }): Promise<void> {
    const enable = update.enableRulesetIds ?? []
    const disable = update.disableRulesetIds ?? []
    const next = new Set(this.enabled)
    disable.forEach((id) => next.delete(id))
    enable.forEach((id) => next.add(id))
    const fail = (message: string) => {
      this.calls.push({ enable, disable, ok: false })
      throw new Error(message)
    }
    if (enable.some((id) => this.options.failOn?.includes(id))) fail('Fallo simulado de Chrome')
    if (enable.some((id) => !(id in this.options.rulesets))) fail('Ruleset desconocido')
    if (next.size > MAX_NUMBER_OF_ENABLED_STATIC_RULESETS) {
      fail('The number of enabled static rulesets exceeds the enabled ruleset count limit.')
    }
    if (
      this.totalEnabledRules(next) >
      GUARANTEED_MINIMUM_STATIC_RULES + this.options.globalAvailable
    ) {
      fail('The number of enabled static rules exceeds the rule count limit.')
    }
    this.calls.push({ enable, disable, ok: true })
    this.enabled.clear()
    next.forEach((id) => this.enabled.add(id))
  }
}
