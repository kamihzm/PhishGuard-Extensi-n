import type { DnrResourceType, DnrRule } from './types'

const VALID_RESOURCE_TYPES: ReadonlySet<DnrResourceType> = new Set([
  'main_frame',
  'sub_frame',
  'stylesheet',
  'script',
  'image',
  'font',
  'object',
  'xmlhttprequest',
  'ping',
  'media',
  'websocket',
  'other',
])
const HOSTNAME_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

/**
 * Última barrera antes de emitir una regla: comprueba las restricciones que
 * `chrome.declarativeNetRequest` impone al cargar un ruleset. Si una regla
 * no las cumple, Chrome rechazaría el ruleset COMPLETO, así que aquí se
 * descarta esa regla (y se contabiliza) en vez de emitirla. Devuelve el
 * motivo, o `null` si la regla es válida.
 */
export function dnrRuleProblem(rule: DnrRule): string | null {
  if (!Number.isInteger(rule.priority) || rule.priority < 1) return 'priority'
  const { condition, action } = rule

  if (condition.urlFilter !== undefined) {
    const filter = condition.urlFilter
    if (filter === '') return 'url-filter-empty'
    // eslint-disable-next-line no-control-regex
    if (/[^\x00-\x7f]/.test(filter)) return 'url-filter-non-ascii'
    if (filter.startsWith('||*')) return 'url-filter-anchor'
    if (/^[|*^]*$/.test(filter)) return 'url-filter-universal'
  } else if (action.type !== 'allowAllRequests' && !condition.initiatorDomains?.length) {
    // Sin urlFilter ni dominios de origen, la regla afectaría a todo.
    return 'unbounded'
  }

  if (condition.resourceTypes && condition.excludedResourceTypes) return 'both-type-lists'
  for (const list of [condition.resourceTypes, condition.excludedResourceTypes]) {
    if (list === undefined) continue
    if (list.length === 0) return 'empty-type-list'
    if (list.some((type) => !VALID_RESOURCE_TYPES.has(type))) return 'invalid-type'
  }
  if (action.type === 'allowAllRequests') {
    const types = condition.resourceTypes ?? []
    if (types.length === 0 || types.some((type) => type !== 'main_frame' && type !== 'sub_frame')) {
      return 'allow-all-types'
    }
  }

  for (const list of [condition.initiatorDomains, condition.excludedInitiatorDomains]) {
    if (list === undefined) continue
    if (list.length === 0) return 'empty-domain-list'
    if (list.some((domain) => !HOSTNAME_PATTERN.test(domain))) return 'invalid-domain'
  }
  return null
}
