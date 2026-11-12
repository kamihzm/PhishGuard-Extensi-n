import { publicSuffixLabelCount } from '../shared/publicSuffix'

const IPV4_PATTERN = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/

/**
 * Descomposición estructural de una URL, calculada UNA sola vez con
 * `new URL()` y reutilizada por todas las features — en vez de que cada
 * feature vuelva a analizar la cadena cruda con su propia lógica ad hoc.
 * `query`/`fragment` vienen SIN el separador (`?`/`#`) para que las
 * features que miden su longitud/contenido no cuenten ese carácter de más.
 */
export interface UrlParts {
  protocol: string
  username: string
  password: string
  hostname: string
  /** Etiquetas del hostname antes del dominio registrable (ej. `mail.login` en `mail.login.banco.example.com`). Vacío para hosts IP. */
  subdomainLabels: string[]
  /** Dominio registrable (ej. `banco.com.co`). Para hosts IP, la IP completa. */
  registrableDomain: string
  /** Sufijo público efectivo (ej. `com.co`, `com`). Vacío para hosts IP. */
  publicSuffix: string
  isIpHost: boolean
  port: string
  pathname: string
  /** Query string sin el `?` inicial. */
  query: string
  /** Fragmento sin el `#` inicial. */
  fragment: string
}

export function decomposeUrl(rawUrl: string): UrlParts {
  const url = new URL(rawUrl)
  const hostname = url.hostname.toLowerCase()
  const isIpHost = isIpAddress(hostname)

  const labels = isIpHost ? [] : hostname.split('.').filter(Boolean)
  const suffixLabelCount = isIpHost ? 0 : effectiveSuffixLabelCount(labels)
  const registrableLabelCount = isIpHost ? 0 : Math.min(labels.length, suffixLabelCount + 1)
  const subdomainLabels = isIpHost
    ? []
    : labels.slice(0, Math.max(0, labels.length - registrableLabelCount))

  return {
    protocol: url.protocol,
    username: url.username,
    password: url.password,
    hostname,
    subdomainLabels,
    registrableDomain: isIpHost ? hostname : labels.slice(-registrableLabelCount).join('.'),
    publicSuffix: isIpHost ? '' : labels.slice(-suffixLabelCount).join('.'),
    isIpHost,
    port: url.port,
    pathname: url.pathname,
    query: url.search.startsWith('?') ? url.search.slice(1) : url.search,
    fragment: url.hash.startsWith('#') ? url.hash.slice(1) : url.hash,
  }
}

function isIpAddress(hostname: string): boolean {
  return IPV4_PATTERN.test(hostname) || hostname.includes(':')
}

/**
 * Etiquetas del sufijo público según la sección ICANN de la Public Suffix
 * List (`shared/publicSuffix.ts`). Hasta el 2026-10-01 solo se conocían los
 * sufijos compuestos de Colombia (`COMPOUND_PUBLIC_SUFFIXES`), así que en
 * `roblox.com.mu` o `amazon.co.uk` el dominio registrable salía como
 * `com.mu` / `co.uk`. Afecta a `subdomainCount` (feature del ML) y a las
 * reglas que usan el dominio registrable — ver `docs/rf-adoption.md`.
 */
function effectiveSuffixLabelCount(labels: string[]): number {
  return publicSuffixLabelCount(labels)
}
