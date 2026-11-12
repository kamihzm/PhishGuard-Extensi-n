import type { Decision } from '../agent/types'
import { publicSuffixLabelCount } from '../shared/publicSuffix'

/**
 * "Estás en" / "En realidad te lleva a": a qué sitio lleva de verdad la
 * dirección. Solo presentación: lee la URL y las reglas que el `Decision`
 * ya activó; no decide nada ni cambia el nivel de riesgo.
 */
export interface Destination {
  /** Dominio registrable real (o el host, si es una IP o no tiene sufijo público). */
  realDomain: string
  /** Dirección completa, tal como se analizó. */
  fullUrl: string
  /**
   * Lo que la dirección aparenta ser cuando disfraza el destino: el texto
   * antes de la @ o la marca puesta delante de otro dominio. `null` si no
   * hay disfraz.
   */
  apparent: string | null
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/

/** Dominio registrable: el sufijo público más una etiqueta (`www.bancolombia.com.co` → `bancolombia.com.co`). */
export function registrableDomain(hostname: string): string {
  if (IPV4.test(hostname) || hostname.startsWith('[')) return hostname
  const labels = hostname.replace(/\.$/, '').split('.')
  if (labels.length < 2) return hostname
  const keep = Math.min(labels.length, publicSuffixLabelCount(labels) + 1)
  return labels.slice(-keep).join('.')
}

export function describeDestination(decision: Decision): Destination | null {
  let parsed: URL
  try {
    parsed = new URL(decision.url)
  } catch {
    return null
  }
  const realDomain = registrableDomain(parsed.hostname)
  return { realDomain, fullUrl: decision.url, apparent: apparentFor(decision, parsed, realDomain) }
}

function apparentFor(decision: Decision, parsed: URL, realDomain: string): string | null {
  for (const hit of decision.activatedRules) {
    if (hit.id === 'at-symbol' && parsed.username) {
      try {
        return decodeURIComponent(parsed.username)
      } catch {
        return parsed.username
      }
    }
    if (hit.id === 'brand-in-subdomain') {
      // Lo que va delante del dominio real ("paypal.com" en paypal.com.login.example).
      const prefix = parsed.hostname.slice(0, -(realDomain.length + 1)).replace(/^www\./, '')
      if (prefix) return prefix
    }
  }
  return null
}
