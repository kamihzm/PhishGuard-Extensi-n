import type { ListCategory } from '../filters/types'

/** `core`: siempre habilitado, dentro del mínimo garantizado. `optional`: solo si hay cuota global libre. */
export type RulesetTier = 'core' | 'optional'

/** Descripción de un ruleset estático compilado (una entrada de `rule_resources` del manifest). */
export interface RulesetDescriptor {
  id: string
  /** Lista de origen (EasyList, EasyPrivacy…). */
  listId: string
  category: ListCategory
  tier: RulesetTier
  ruleCount: number
  /** Del total: excepciones (`allow` / `allowAllRequests`). */
  exceptionCount: number
  /** Orden global de habilitación de los opcionales (0 para el Core). */
  order: number
  /** Ruta del JSON dentro de la extensión empaquetada. */
  path: string
  sha256: string
}

/** Índice generado por el compilador y consumido por el gestor de cuota en tiempo de ejecución. */
export interface RulesetIndex {
  guaranteedMinimumStaticRules: number
  coreRuleBudget: number
  optionalChunkSize: number
  rulesets: RulesetDescriptor[]
}

/**
 * Subconjunto de `chrome.declarativeNetRequest` que usa el gestor de cuota.
 * Se inyecta: en producción es la API real; en tests, una simulación.
 */
export interface DnrStaticRulesetApi {
  getAvailableStaticRuleCount(): Promise<number>
  getEnabledRulesets(): Promise<string[]>
  updateEnabledRulesets(options: {
    enableRulesetIds?: string[]
    disableRulesetIds?: string[]
  }): Promise<void>
}

export interface OptionalRulesetFailure {
  id: string
  message: string
}

/** Estado resultante de aplicar el plan de cuota (para diagnóstico, estadísticas y tests). */
export interface QuotaStatus {
  coreEnabled: string[]
  /** Core de una categoría activa que no se pudo habilitar: Web Protection queda degradada. */
  coreFailed: OptionalRulesetFailure[]
  optionalEnabled: string[]
  /** Opcionales no habilitados por falta de cuota o del límite de rulesets. */
  optionalSkippedForQuota: string[]
  optionalFailed: OptionalRulesetFailure[]
  /** Rulesets de categorías desactivadas que se deshabilitaron. */
  disabled: string[]
  activeRuleCount: number
  availableBefore: number
  availableAfter: number
}
