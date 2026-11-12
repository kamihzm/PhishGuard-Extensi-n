/**
 * Tipos del sistema de reglas de Web Protection (Fase B, ver
 * `docs/web-protection-audit.md` §4). Código puro: sin `chrome.*`, sin
 * relación con el motor de phishing (`agent/`, `features/`, `rules/`,
 * `ml/`), lo que verifica `webProtection/architecture.test.ts`.
 */

/** Categoría de la LISTA de origen. Nunca se mezcla con el score de phishing. */
export type ListCategory = 'ads' | 'trackers' | 'known-threats' | 'phishing-lists'

/** Tipos de recurso de `chrome.declarativeNetRequest` que este compilador emite. */
export type DnrResourceType =
  | 'main_frame'
  | 'sub_frame'
  | 'stylesheet'
  | 'script'
  | 'image'
  | 'font'
  | 'object'
  | 'xmlhttprequest'
  | 'ping'
  | 'media'
  | 'websocket'
  | 'other'

/** Subconjunto de `chrome.declarativeNetRequest.Rule` que produce el compilador (definido aquí para no depender de `@types/chrome` en código offline). */
export interface DnrRule {
  id: number
  priority: number
  action: { type: 'block' | 'allow' | 'allowAllRequests' }
  condition: {
    urlFilter?: string
    isUrlFilterCaseSensitive?: boolean
    resourceTypes?: DnrResourceType[]
    excludedResourceTypes?: DnrResourceType[]
    domainType?: 'firstParty' | 'thirdParty'
    initiatorDomains?: string[]
    excludedInitiatorDomains?: string[]
  }
}

/** Filtro de red ABP aceptado (subconjunto de la §4.1), antes de convertirse en regla DNR. */
export interface ParsedNetworkFilter {
  raw: string
  isException: boolean
  /** Patrón ABP tal cual (`||`, `|`, `^`, `*`), o `''` si no restringe la URL. */
  pattern: string
  matchCase: boolean
  important: boolean
  /** `@@…$document`: excepción de página completa. */
  documentException: boolean
  resourceTypes?: DnrResourceType[]
  excludedResourceTypes?: DnrResourceType[]
  domainType?: 'firstParty' | 'thirdParty'
  initiatorDomains?: string[]
  excludedInitiatorDomains?: string[]
}

/** Subtipos de filtros cosméticos/de página: NO se compilan a DNR en la Fase B, solo se cuentan. */
export type DeferredCosmeticKind =
  | 'cosmetic-hide'
  | 'cosmetic-exception'
  | 'procedural'
  | 'css-injection'
  | 'scriptlet'
  | 'html-filter'

/** Resultado de clasificar UNA línea de una lista. Cada línea cae exactamente en una clase. */
export type LineResult =
  | { kind: 'comment' }
  | { kind: 'network'; filter: ParsedNetworkFilter }
  | { kind: 'rejected'; reason: string }
  | { kind: 'deferred-cosmetic'; cosmeticKind: DeferredCosmeticKind }

/** Conteos de compilación de una lista. `check.sumsToTotal` garantiza que cada línea quedó contabilizada. */
export interface CompileReport {
  listId: string
  category: ListCategory
  totalLines: number
  comments: number
  /** Líneas `X$badfilter` (directivas; nunca generan regla). */
  badfilterDirectives: number
  /** Filtros anulados por un `$badfilter` idéntico (nunca generan regla). */
  badfilterCancelled: number
  rejected: Record<string, number>
  rejectedTotal: number
  deferredCosmetic: Partial<Record<DeferredCosmeticKind, number>>
  deferredCosmeticTotal: number
  /** Filtros de red aceptados (antes de eliminar duplicados idénticos). */
  accepted: number
  acceptedExceptions: number
  /** Filtros aceptados cuya regla DNR es idéntica a otra ya emitida. */
  duplicatesRemoved: number
  dnrRules: number
  check: { sumsToTotal: boolean }
}
