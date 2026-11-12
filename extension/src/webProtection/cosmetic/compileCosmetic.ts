/**
 * Compilador offline de filtros cosméticos ESPECÍFICOS DE DOMINIO
 * (`dominio##selector` y `dominio#@#selector`) a un índice por dominio.
 *
 * Alcance deliberadamente estrecho (ver docs/web-protection-audit.md,
 * "Capa de página"):
 * - Solo selectores CSS puros que se aplican con `display:none`. Nada de
 *   sintaxis extendida (`#?#`, `#$#`, `#%#`, `:-abp-*`, `:has-text`,
 *   `:xpath`, `:style`, `:remove`, scriptlets `+js`…): se cuentan y se
 *   descartan.
 * - Los filtros genéricos (`##selector` sin dominio, ~13 600 en EasyList)
 *   NO se incluyen: aplicarlos en todos los sitios es costoso y es donde
 *   más falsos positivos aparecen. Se cuentan y se descartan.
 * - Una regla solo con dominios negados (`~a.com##x`) es genérica en la
 *   práctica: se descarta.
 *
 * Código puro: sin `chrome.*` ni DOM. La validación final de cada
 * selector ocurre en la página con `CSS.supports('selector(…)')`.
 */

export interface CosmeticIndex {
  /** Selectores a ocultar por dominio (el dominio cubre también sus subdominios). */
  hide: Record<string, string[]>
  /** Excepciones (`#@#` y dominios negados `~sub.dominio`) por dominio. */
  allow: Record<string, string[]>
}

export interface CosmeticCompileReport {
  totalLines: number
  domainSpecificHide: number
  domainSpecificAllow: number
  skipped: Record<CosmeticSkipReason, number>
  domains: number
  selectors: number
}

export type CosmeticSkipReason =
  'generic' | 'negated-only' | 'extended-syntax' | 'invalid-domain' | 'unsafe-selector' | 'too-long'

/** Separadores de filtros de página que NO son `##`/`#@#` puros. */
const EXTENDED_SEPARATORS = ['#?#', '#@?#', '#$#', '#@$#', '#%#', '#@%#']
/** Pseudo-clases no estándar o que ejecutan acciones: nunca son CSS puro. */
const EXTENDED_PSEUDO =
  /:(?:-abp-|has-text|contains|xpath|style|remove|upward|matches-css|matches-path|matches-attr|matches-prop|min-text-length|watch-attr|others|if|if-not|nth-ancestor|properties)\b/i
const DOMAIN_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9-]{2,}$/
export const MAX_SELECTOR_LENGTH = 500

/** Selector sin sintaxis extendida de listas de filtros (compilador y página usan la misma regla). */
export function isPlainCssSelector(selector: string): boolean {
  return !selector.startsWith('+js') && !EXTENDED_PSEUDO.test(selector)
}

function unsafeSelector(selector: string): boolean {
  // Llaves o `;` permitirían cerrar la regla `{display:none}` e inyectar otras
  // declaraciones; `\` y comillas desbalanceadas no aparecen en selectores
  // simples de EasyList y complican la validación: se descartan.
  if (/[{};\\]/.test(selector)) return true
  if ((selector.match(/"/g) ?? []).length % 2 !== 0) return true
  if ((selector.match(/'/g) ?? []).length % 2 !== 0) return true
  // Nunca ocultar la estructura raíz de la página.
  return /^\s*(?:html|body|head|main|:root)\s*$/i.test(selector)
}

function pushUnique(map: Map<string, Set<string>>, domain: string, selector: string): void {
  let set = map.get(domain)
  if (!set) map.set(domain, (set = new Set()))
  set.add(selector)
}

export function compileCosmetic(text: string): {
  index: CosmeticIndex
  report: CosmeticCompileReport
} {
  const hide = new Map<string, Set<string>>()
  const allow = new Map<string, Set<string>>()
  const skipped: Record<CosmeticSkipReason, number> = {
    generic: 0,
    'negated-only': 0,
    'extended-syntax': 0,
    'invalid-domain': 0,
    'unsafe-selector': 0,
    'too-long': 0,
  }
  let totalLines = 0
  let domainSpecificHide = 0
  let domainSpecificAllow = 0

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('!') || line.startsWith('[')) continue
    const extended = EXTENDED_SEPARATORS.some((sep) => line.includes(sep))
    const isAllow = line.includes('#@#')
    const separator = isAllow ? '#@#' : '##'
    const at = line.indexOf(separator)
    if (!extended && at < 0) continue
    totalLines++
    if (extended) {
      skipped['extended-syntax']++
      continue
    }

    const domainsPart = line.slice(0, at)
    const selector = line.slice(at + separator.length).trim()
    if (!domainsPart) {
      skipped.generic++
      continue
    }
    if (!selector || !isPlainCssSelector(selector)) {
      skipped['extended-syntax']++
      continue
    }
    if (selector.length > MAX_SELECTOR_LENGTH) {
      skipped['too-long']++
      continue
    }
    if (unsafeSelector(selector)) {
      skipped['unsafe-selector']++
      continue
    }

    const included: string[] = []
    const excluded: string[] = []
    let invalid = false
    for (const entry of domainsPart.split(',')) {
      const negated = entry.startsWith('~')
      const domain = (negated ? entry.slice(1) : entry).trim().toLowerCase()
      // Comodines de TLD (`google.*`) y dominios mal formados no se soportan.
      if (!DOMAIN_PATTERN.test(domain)) {
        invalid = true
        continue
      }
      ;(negated ? excluded : included).push(domain)
    }
    if (included.length === 0) {
      if (invalid) skipped['invalid-domain']++
      else skipped['negated-only']++
      continue
    }

    if (isAllow) {
      domainSpecificAllow++
      for (const domain of included) pushUnique(allow, domain, selector)
    } else {
      domainSpecificHide++
      for (const domain of included) pushUnique(hide, domain, selector)
      // `a.com,~b.a.com##x`: en b.a.com el selector x no debe aplicarse.
      for (const domain of excluded) pushUnique(allow, domain, selector)
    }
  }

  const sorted = (map: Map<string, Set<string>>) =>
    Object.fromEntries(
      [...map.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([domain, set]) => [domain, [...set].sort()]),
    )
  const index: CosmeticIndex = { hide: sorted(hide), allow: sorted(allow) }
  return {
    index,
    report: {
      totalLines,
      domainSpecificHide,
      domainSpecificAllow,
      skipped,
      domains: Object.keys(index.hide).length,
      selectors: Object.values(index.hide).reduce((sum, list) => sum + list.length, 0),
    },
  }
}

/** Dominios candidatos de un hostname: `a.b.c.com` → `a.b.c.com`, `b.c.com`, `c.com`. */
export function candidateDomains(hostname: string): string[] {
  const labels = hostname.toLowerCase().replace(/\.$/, '').split('.')
  const out: string[] = []
  for (let i = 0; i < labels.length - 1; i++) out.push(labels.slice(i).join('.'))
  return out
}

/** Límite de selectores que se envían a una página (protege de índices corruptos). */
export const MAX_SELECTORS_PER_PAGE = 2000

/**
 * Selectores que aplican a un hostname: los de su dominio y dominios padre,
 * menos las excepciones de cualquiera de ellos.
 */
export function selectorsForHost(index: CosmeticIndex, hostname: string): string[] {
  const domains = candidateDomains(hostname)
  const allowed = new Set<string>()
  for (const domain of domains) for (const s of index.allow[domain] ?? []) allowed.add(s)
  const result = new Set<string>()
  for (const domain of domains) {
    for (const s of index.hide[domain] ?? []) if (!allowed.has(s)) result.add(s)
  }
  return [...result].slice(0, MAX_SELECTORS_PER_PAGE)
}
