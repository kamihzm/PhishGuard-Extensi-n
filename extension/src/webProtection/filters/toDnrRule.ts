import type { DnrRule, ParsedNetworkFilter } from './types'

/** Prioridades de docs/web-protection-audit.md §4.3 (la allowlist del usuario, 100, pertenece a la Fase C). */
export const PRIORITY = {
  block: 1,
  exception: 2,
  importantBlock: 3,
  importantException: 4,
} as const

/**
 * Transformación EXACTA de un filtro aceptado a UNA regla DNR (tabla §4.1).
 * El patrón ABP se copia literal a `urlFilter`: DNR implementa los mismos
 * anclajes (`||`, `|`), separador (`^`) y comodín (`*`). `id` queda en 0;
 * lo asigna `compileList.ts` al emitir el ruleset.
 */
export function toDnrRule(filter: ParsedNetworkFilter): DnrRule {
  const priority = filter.isException
    ? filter.important
      ? PRIORITY.importantException
      : PRIORITY.exception
    : filter.important
      ? PRIORITY.importantBlock
      : PRIORITY.block

  const rule: DnrRule = {
    id: 0,
    priority,
    action: {
      type: filter.documentException ? 'allowAllRequests' : filter.isException ? 'allow' : 'block',
    },
    condition: {},
  }
  const { condition } = rule

  if (filter.pattern !== '') condition.urlFilter = filter.pattern
  if (filter.matchCase) condition.isUrlFilterCaseSensitive = true
  if (filter.documentException) {
    condition.resourceTypes = ['main_frame', 'sub_frame']
  } else {
    if (filter.resourceTypes) condition.resourceTypes = [...filter.resourceTypes]
    if (filter.excludedResourceTypes)
      condition.excludedResourceTypes = [...filter.excludedResourceTypes]
  }
  if (filter.domainType) condition.domainType = filter.domainType
  if (filter.initiatorDomains) condition.initiatorDomains = [...filter.initiatorDomains]
  if (filter.excludedInitiatorDomains) {
    condition.excludedInitiatorDomains = [...filter.excludedInitiatorDomains]
  }
  return rule
}
