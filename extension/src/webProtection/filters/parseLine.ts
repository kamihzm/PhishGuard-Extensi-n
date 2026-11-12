import type {
  DeferredCosmeticKind,
  DnrResourceType,
  LineResult,
  ParsedNetworkFilter,
} from './types'

/**
 * Parser del SUBCONJUNTO de sintaxis ABP soportado (docs/web-protection-audit.md
 * §4.1). Implementación propia de PhishGuard: no deriva de código de uBlock.
 * Regla: lo que no tiene equivalente DNR exacto se RECHAZA con un motivo;
 * nunca se aproxima.
 */

const TYPE_OPTIONS: Readonly<Record<string, DnrResourceType>> = {
  script: 'script',
  image: 'image',
  stylesheet: 'stylesheet',
  css: 'stylesheet',
  object: 'object',
  xmlhttprequest: 'xmlhttprequest',
  xhr: 'xmlhttprequest',
  subdocument: 'sub_frame',
  frame: 'sub_frame',
  ping: 'ping',
  beacon: 'ping',
  media: 'media',
  font: 'font',
  websocket: 'websocket',
  other: 'other',
}

/** Alcance cosmético: no afecta la red, su efecto real pertenece a la Fase G. */
const COSMETIC_SCOPE_OPTIONS = new Set([
  'elemhide',
  'ehide',
  'generichide',
  'ghide',
  'specifichide',
  'shide',
  'genericblock',
])

/** Opciones conocidas sin equivalente DNR exacto o fuera del alcance de la Fase B (§4.2). */
const UNSUPPORTED_OPTIONS = new Set([
  'redirect',
  'redirect-rule',
  'rewrite',
  'removeparam',
  'queryprune',
  'csp',
  'replace',
  'header',
  'permissions',
  'method',
  'to',
  'denyallow',
  'all',
  'popup',
  'popunder',
  'cname',
  'inline-script',
  'inline-font',
  'empty',
  'mp4',
  'urlskip',
  'uritransform',
  'strict1p',
  'strict3p',
  'strict-first-party',
  'strict-third-party',
  'webrtc',
  'object-subrequest',
  'ipaddress',
  'reason',
  'network',
  'app',
  'content',
  'jsinject',
  'urlblock',
  'extension',
  'stealth',
  'cookie',
  'jsonprune',
  'xmlprune',
  'hls',
])

const HOSTNAME_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
const PREPROCESSOR_PATTERN = /^!#(?:if|else|endif|include)\b/
const HOSTS_FORMAT_PATTERN = /^(?:0\.0\.0\.0|127\.0\.0\.1|::1?)\s+\S/
/** Separadores cosméticos/de página ABP, uBO y AdGuard (`##`, `#@#`, `#?#`, `#$#`, `#%#`, `#@$?#`…). */
const COSMETIC_SEPARATOR = /#@?(?:\$\?|\$|%|\?)?#/
const HTML_FILTER_SEPARATOR = /\$@?\$/
/** Parte previa a un separador cosmético: lista de dominios (sin `/`, `|`, `^`, `$` ni espacios). */
const COSMETIC_DOMAIN_PREFIX = /^[^/|^$\s]*$/

export function isPreprocessorDirective(line: string): boolean {
  return PREPROCESSOR_PATTERN.test(line)
}

export function isPreprocessorBlockStart(line: string): boolean {
  return /^!#if\b/.test(line)
}

export function isPreprocessorBlockEnd(line: string): boolean {
  return /^!#endif\b/.test(line)
}

/** Clasifica una línea cosmética/de página; `null` si no lo es. */
export function cosmeticKindOf(line: string): DeferredCosmeticKind | null {
  const match = COSMETIC_SEPARATOR.exec(line)
  if (match && COSMETIC_DOMAIN_PREFIX.test(line.slice(0, match.index))) {
    const separator = match[0]
    const body = line.slice(match.index + separator.length)
    if (separator.includes('%') || body.startsWith('+js(')) return 'scriptlet'
    if (separator.includes('$')) return 'css-injection'
    if (separator.includes('?')) return 'procedural'
    if (body.startsWith('^')) return 'html-filter'
    return separator.includes('@') ? 'cosmetic-exception' : 'cosmetic-hide'
  }
  const html = HTML_FILTER_SEPARATOR.exec(line)
  if (html && COSMETIC_DOMAIN_PREFIX.test(line.slice(0, html.index))) return 'html-filter'
  return null
}

export interface SplitNetworkLine {
  isException: boolean
  pattern: string
  /** Tokens de opciones tal como aparecen (sin normalizar), vacío si no hay `$`. */
  options: string[]
}

/**
 * Separa excepción (`@@`), patrón y opciones (tras el ÚLTIMO `$`). Se
 * comparte con el paso de `$badfilter` para que ambos vean la misma forma.
 */
export function splitNetworkLine(line: string): SplitNetworkLine {
  const isException = line.startsWith('@@')
  const body = isException ? line.slice(2) : line
  const dollar = body.lastIndexOf('$')
  if (dollar < 0) return { isException, pattern: body, options: [] }
  return {
    isException,
    pattern: body.slice(0, dollar),
    options: body
      .slice(dollar + 1)
      .split(',')
      .map((token) => token.trim()),
  }
}

export function hasBadfilterOption(split: SplitNetworkLine): boolean {
  return split.options.some((token) => token.toLowerCase() === 'badfilter')
}

/** Forma canónica para comparar un filtro con su `$badfilter` (opciones sin orden). */
export function canonicalNetworkKey(split: SplitNetworkLine): string {
  const options = split.options
    .filter((token) => token.toLowerCase() !== 'badfilter')
    .map((token) => token.toLowerCase())
    .sort()
  return `${split.isException ? '@@' : ''}${split.pattern}${options.length > 0 ? `$${options.join(',')}` : ''}`
}

function reject(reason: string): LineResult {
  return { kind: 'rejected', reason }
}

/**
 * Clasifica UNA línea (sin estado). El preprocesador (`!#if`) y `$badfilter`
 * necesitan ver la lista completa y los resuelve `compileList.ts`.
 */
export function parseLine(rawLine: string): LineResult {
  const line = rawLine.trim()
  if (line === '') return { kind: 'comment' }
  if (isPreprocessorDirective(line)) return reject('preprocessor-directive')
  if (line.startsWith('!') || (line.startsWith('[') && line.endsWith(']'))) {
    return { kind: 'comment' }
  }

  const cosmeticKind = cosmeticKindOf(line)
  if (cosmeticKind) return { kind: 'deferred-cosmetic', cosmeticKind }

  if (HOSTS_FORMAT_PATTERN.test(line)) return reject('hosts-format')
  return parseNetworkFilter(line)
}

function parseNetworkFilter(line: string): LineResult {
  const split = splitNetworkLine(line)
  const { pattern } = split

  if (pattern.length > 2 && pattern.startsWith('/') && pattern.endsWith('/')) {
    return reject('regex-filter')
  }
  if (split.options.length > 0 && split.options.some((token) => token === '')) {
    return reject('options-malformed')
  }

  const filter: ParsedNetworkFilter = {
    raw: line,
    isException: split.isException,
    pattern,
    matchCase: false,
    important: false,
    documentException: false,
  }
  const includedTypes = new Set<DnrResourceType>()
  const excludedTypes = new Set<DnrResourceType>()
  let firstParty = false
  let thirdParty = false
  let hasDomainOption = false
  const initiatorDomains: string[] = []
  const excludedInitiatorDomains: string[] = []

  for (const token of split.options) {
    const negated = token.startsWith('~')
    const nameAndValue = negated ? token.slice(1) : token
    const equals = nameAndValue.indexOf('=')
    const name = (equals < 0 ? nameAndValue : nameAndValue.slice(0, equals)).toLowerCase()
    const value = equals < 0 ? undefined : nameAndValue.slice(equals + 1)

    if (name in TYPE_OPTIONS && value === undefined) {
      ;(negated ? excludedTypes : includedTypes).add(TYPE_OPTIONS[name]!)
      continue
    }
    if ((name === 'document' || name === 'doc') && value === undefined) {
      if (negated) excludedTypes.add('main_frame')
      else if (split.isException) filter.documentException = true
      else return reject('document-block')
      continue
    }
    if ((name === 'third-party' || name === '3p') && value === undefined) {
      if (negated) firstParty = true
      else thirdParty = true
      continue
    }
    if ((name === 'first-party' || name === '1p') && value === undefined) {
      if (negated) thirdParty = true
      else firstParty = true
      continue
    }
    if ((name === 'domain' || name === 'from') && value !== undefined && !negated) {
      hasDomainOption = true
      for (const rawDomain of value.split('|')) {
        const excluded = rawDomain.startsWith('~')
        const domain = (excluded ? rawDomain.slice(1) : rawDomain).trim().toLowerCase()
        if (domain.startsWith('/')) return reject('domain-regex')
        if (domain.endsWith('.*')) return reject('domain-entity')
        // eslint-disable-next-line no-control-regex
        if (/[^\x00-\x7f]/.test(domain)) return reject('domain-non-ascii')
        if (!HOSTNAME_PATTERN.test(domain)) return reject('domain-invalid')
        ;(excluded ? excludedInitiatorDomains : initiatorDomains).push(domain)
      }
      continue
    }
    if (name === 'match-case' && value === undefined && !negated) {
      filter.matchCase = true
      continue
    }
    if (name === 'important' && value === undefined && !negated) {
      filter.important = true
      continue
    }
    if (COSMETIC_SCOPE_OPTIONS.has(name)) return reject('option-cosmetic-scope')
    if (UNSUPPORTED_OPTIONS.has(name)) return reject(`option-unsupported:${name}`)
    return reject(`option-unknown:${name}`)
  }

  if (firstParty && thirdParty) return reject('party-conflict')
  if (firstParty) filter.domainType = 'firstParty'
  if (thirdParty) filter.domainType = 'thirdParty'
  if (hasDomainOption && initiatorDomains.length === 0 && excludedInitiatorDomains.length === 0) {
    return reject('domain-empty')
  }
  if (initiatorDomains.length > 0) filter.initiatorDomains = [...new Set(initiatorDomains)].sort()
  if (excludedInitiatorDomains.length > 0) {
    filter.excludedInitiatorDomains = [...new Set(excludedInitiatorDomains)].sort()
  }

  if (filter.documentException) {
    if (includedTypes.size > 0 || excludedTypes.size > 0) return reject('document-with-types')
  } else if (includedTypes.size > 0) {
    // `$script,~image` equivale a "solo script": DNR no admite ambas listas a la vez.
    const types = [...includedTypes].filter((type) => !excludedTypes.has(type))
    if (types.length === 0) return reject('no-resource-types')
    filter.resourceTypes = types.sort()
  } else if (excludedTypes.size > 0) {
    filter.excludedResourceTypes = [...excludedTypes].sort()
  }

  const patternProblem = patternRejection(pattern, (filter.initiatorDomains?.length ?? 0) > 0)
  if (patternProblem) return reject(patternProblem)
  filter.pattern = isUniversalPattern(pattern) ? '' : pattern

  return { kind: 'network', filter }
}

/** Patrón que, sin anclajes, no restringe nada (`''`, `*`, `^`, `||`, `|*`…). */
function isUniversalPattern(pattern: string): boolean {
  const unanchored = pattern.replace(/^\|\|?/, '').replace(/\|$/, '')
  return /^[*^]*$/.test(unanchored)
}

function patternRejection(pattern: string, hasInitiatorDomains: boolean): string | null {
  if (/\s/.test(pattern)) return 'pattern-whitespace'
  // eslint-disable-next-line no-control-regex
  if (/[^\x00-\x7f]/.test(pattern)) return 'pattern-non-ascii'
  if (isUniversalPattern(pattern)) return hasInitiatorDomains ? null : 'pattern-universal'
  // Restricciones de `urlFilter` en DNR: `||` solo al inicio, `|` solo en los extremos, sin `||*`.
  if (pattern.startsWith('||*')) return 'pattern-dnr-invalid'
  const inner = pattern.replace(/^\|\|?/, '').replace(/\|$/, '')
  if (inner.includes('|')) return 'pattern-dnr-invalid'
  return null
}
