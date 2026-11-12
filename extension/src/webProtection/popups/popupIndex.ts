import type { AdEvidence } from './types'

/**
 * Índice de EVIDENCIA publicitaria para el Popup Guard, compilado offline
 * desde EasyList (lista autorizada; ver tools/webProtection/PROVENANCE.md).
 *
 * El compilador DNR descarta las reglas `$popup` (DNR no tiene un tipo de
 * recurso "popup"), así que aquí se reutilizan como EVIDENCIA, no como
 * bloqueo:
 * - `hosts`: reglas de host anclado sin ruta (`||dominio^`, con o sin
 *   opciones de tipo/`$popup`/`$third-party`) → el host sirve publicidad;
 * - `patterns`: reglas `$popup`/`$popunder` con ruta o comodines;
 * - `exceptionHosts` / `exceptionPatterns`: excepciones `@@`.
 * Se descartan las reglas limitadas a sitios (`domain=`), las de
 * `$badfilter` (y las que cancelan), `denyallow`, `first-party`,
 * expresiones regulares y patrones con demasiados comodines.
 *
 * Código puro: sin `chrome.*`.
 */
export interface PopupIndex {
  hosts: string[]
  patterns: string[]
  exceptionHosts: string[]
  exceptionPatterns: string[]
}

export interface PopupIndexReport {
  hosts: number
  patterns: number
  exceptionHosts: number
  exceptionPatterns: number
  skipped: Record<
    'domain-restricted' | 'badfilter' | 'unsupported' | 'regex' | 'too-complex',
    number
  >
}

const HOST_ANCHOR = /^\|\|([a-z0-9-]+(?:\.[a-z0-9-]+)+)\^?\|?$/i
const ACCEPTED_OPTIONS =
  /^(?:~?third-party|~?3p|popup|popunder|document|doc|all|important|script|image|stylesheet|subdocument|xmlhttprequest|media|font|object|ping|websocket|other|match-case)$/i
export const MAX_WILDCARDS = 4

function splitRule(line: string): { exception: boolean; pattern: string; options: string[] } {
  const exception = line.startsWith('@@')
  const body = exception ? line.slice(2) : line
  const dollar = body.lastIndexOf('$')
  // `$` dentro de una ruta sin opciones válidas: se trata como parte del patrón.
  if (dollar > 0 && /^[a-z~0-9,=|._-]+$/i.test(body.slice(dollar + 1))) {
    return {
      exception,
      pattern: body.slice(0, dollar),
      options: body
        .slice(dollar + 1)
        .split(',')
        .filter(Boolean),
    }
  }
  return { exception, pattern: body, options: [] }
}

export function compilePopupIndex(text: string): { index: PopupIndex; report: PopupIndexReport } {
  const hosts = new Set<string>()
  const patterns = new Set<string>()
  const exceptionHosts = new Set<string>()
  const exceptionPatterns = new Set<string>()
  const skipped: PopupIndexReport['skipped'] = {
    'domain-restricted': 0,
    badfilter: 0,
    unsupported: 0,
    regex: 0,
    'too-complex': 0,
  }
  const lines = text.split(/\r?\n/).map((l) => l.trim())
  // Reglas anuladas por `$badfilter` (misma regla sin esa opción).
  const cancelled = new Set<string>()
  for (const line of lines) {
    if (!/\$(?:.*,)?badfilter(?:,|$)/.test(line)) continue
    const { exception, pattern, options } = splitRule(line)
    cancelled.add(
      (exception ? '@@' : '') +
        pattern +
        '$' +
        options
          .filter((o) => o !== 'badfilter')
          .sort()
          .join(','),
    )
  }

  for (const line of lines) {
    if (!line || line.startsWith('!') || line.startsWith('[')) continue
    if (/#[@?$%]?#/.test(line)) continue // cosméticos
    const { exception, pattern, options } = splitRule(line)
    if (options.includes('badfilter')) {
      skipped.badfilter++
      continue
    }
    const key = (exception ? '@@' : '') + pattern + '$' + [...options].sort().join(',')
    if (cancelled.has(key)) {
      skipped.badfilter++
      continue
    }
    if (options.some((o) => o.startsWith('domain=') || o.startsWith('from='))) {
      skipped['domain-restricted']++
      continue
    }
    if (!options.every((o) => ACCEPTED_OPTIONS.test(o))) {
      skipped.unsupported++
      continue
    }
    if (options.some((o) => /^(?:~third-party|~3p)$/i.test(o))) {
      skipped.unsupported++ // "solo en el propio sitio": no es evidencia sobre destinos
      continue
    }
    if (pattern.startsWith('/') && pattern.endsWith('/') && pattern.length > 2) {
      skipped.regex++
      continue
    }
    const popup = options.some((o) => /^(?:popup|popunder)$/i.test(o))
    const host = HOST_ANCHOR.exec(pattern)
    if (host) {
      ;(exception ? exceptionHosts : hosts).add(host[1]!.toLowerCase())
      continue
    }
    if (!popup || pattern.length < 4) continue // solo patrones de ventanas emergentes
    if ((pattern.match(/\*/g) ?? []).length > MAX_WILDCARDS) {
      skipped['too-complex']++
      continue
    }
    ;(exception ? exceptionPatterns : patterns).add(pattern)
  }
  const sorted = (s: Set<string>) => [...s].sort()
  const index: PopupIndex = {
    hosts: sorted(hosts),
    patterns: sorted(patterns),
    exceptionHosts: sorted(exceptionHosts),
    exceptionPatterns: sorted(exceptionPatterns),
  }
  return {
    index,
    report: {
      hosts: hosts.size,
      patterns: patterns.size,
      exceptionHosts: exceptionHosts.size,
      exceptionPatterns: exceptionPatterns.size,
      skipped,
    },
  }
}

/** Patrón ABP (`||`, `|`, `*`, `^`) → expresión regular anclada, sin retroceso anidado. */
export function abpPatternToRegExp(pattern: string): RegExp {
  let p = pattern
  let source = ''
  if (p.startsWith('||')) {
    source = '^[a-z][a-z0-9+.-]*://(?:[^/?#]*\\.)?'
    p = p.slice(2)
  } else if (p.startsWith('|')) {
    source = '^'
    p = p.slice(1)
  }
  let end = ''
  if (p.endsWith('|')) {
    end = '$'
    p = p.slice(0, -1)
  }
  for (const c of p) {
    if (c === '*') source += '.*?'
    else if (c === '^') source += '(?:[^\\w.%-]|$)'
    else source += c.replace(/[.+?${}()|[\]\\/]/g, '\\$&')
  }
  return new RegExp(source + end, 'i')
}

export const MAX_URL_LENGTH = 2048

function hostOf(url: string): string | null {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.hostname.toLowerCase() : null
  } catch {
    return null
  }
}

function hostMatches(set: Set<string>, host: string): boolean {
  const labels = host.split('.')
  for (let i = 0; i < labels.length - 1; i++) if (set.has(labels.slice(i).join('.'))) return true
  return false
}

export function createAdEvidence(index: PopupIndex): AdEvidence {
  const hosts = new Set(index.hosts)
  const exceptionHosts = new Set(index.exceptionHosts)
  let patterns: RegExp[] | null = null
  let exceptionPatterns: RegExp[] | null = null
  const compile = (list: string[]) =>
    list.flatMap((p) => {
      try {
        return [abpPatternToRegExp(p)]
      } catch {
        return []
      }
    })
  return {
    isAdUrl(url) {
      const host = hostOf(url)
      if (!host || url.length > MAX_URL_LENGTH) return false
      if (hostMatches(hosts, host)) return true
      patterns ??= compile(index.patterns)
      return patterns.some((re) => re.test(url))
    },
    isException(url) {
      const host = hostOf(url)
      if (!host || url.length > MAX_URL_LENGTH) return false
      if (hostMatches(exceptionHosts, host)) return true
      exceptionPatterns ??= compile(index.exceptionPatterns)
      return exceptionPatterns.some((re) => re.test(url))
    },
  }
}
