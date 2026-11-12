import {
  containsBrand,
  EXTRA_IMPERSONATED_BRANDS,
  REFERENCE_BRANDS,
} from '../domainSimilarity/brands'
import { REFERENCE_DOMAINS } from '../domainSimilarity/referenceDomains'
import { HOSTING_PLATFORMS, HOSTING_SENSITIVE_WORDS, URL_SHORTENERS } from '../shared/constants'

export interface HostingAnalysis {
  /** Plataforma de hosting (`github.io`…) si el host es un subdominio de una, o `null`. */
  hostingPlatform: string | null
  /** Marca de `REFERENCE_DOMAINS` incluida en el subdominio de la plataforma (no como nombre exacto). */
  hostingBrand: string | null
  /** Igual, con la lista ampliada `EXTRA_IMPERSONATED_BRANDS`. */
  hostingBrandExtended: string | null
  /** Palabra de `HOSTING_SENSITIVE_WORDS` en el subdominio de la plataforma. */
  hostingSensitiveWord: string | null
  /** Alguna etiqueta del subdominio de la plataforma parece generada al azar (hex ≥ 6, o ≥ 10 caracteres mezclando letras y dígitos). */
  hostingRandomLabel: boolean
  /** Acortador de URL (`bit.ly`…), o `null`. */
  urlShortener: string | null
  /** Marca de `REFERENCE_DOMAINS` en un SUBDOMINIO de un dominio que no es de la marca ni una plataforma. */
  subdomainBrand: string | null
}

/**
 * Busca una marca en las etiquetas del subdominio. En plataformas
 * (`skipExactLabel`) se ignora la etiqueta que ES exactamente la marca
 * (`facebook.github.io`, `microsoft.github.io`): ese nombre de cuenta lo
 * reservan las propias marcas para sus páginas oficiales. Fuera de
 * plataformas, la etiqueta exacta es justamente el engaño
 * (`paypal.com.verify-account.example`).
 */
function brandIn(
  labels: string[],
  brands: readonly string[],
  skipExactLabel: boolean,
): string | null {
  const text = labels.join('.')
  for (const brand of brands) {
    if (skipExactLabel && labels.includes(brand)) continue
    if (containsBrand(text, brand)) return brand
  }
  return null
}

export function analyzeHosting(
  hostname: string,
  registrableDomain: string,
  subdomainLabels: string[],
): HostingAnalysis {
  const bare = hostname.replace(/^www\./, '')
  const platform = HOSTING_PLATFORMS.find((p) => hostname.endsWith('.' + p)) ?? null
  const platformLabels = platform
    ? hostname
        .slice(0, -(platform.length + 1))
        .split('.')
        .filter((l) => l && l !== 'www')
    : []
  const referenceBrands = REFERENCE_BRANDS.map((b) => b.brand)
  const sensitive = platform
    ? (HOSTING_SENSITIVE_WORDS.find((w) => platformLabels.join('.').includes(w)) ?? null)
    : null
  const isReference = REFERENCE_DOMAINS.includes(registrableDomain)
  const nonPlatformSubdomain =
    !platform && !isReference ? subdomainLabels.filter((l) => l !== 'www') : []
  return {
    hostingPlatform: platform,
    hostingBrand: platform ? brandIn(platformLabels, referenceBrands, true) : null,
    hostingBrandExtended: platform
      ? brandIn(platformLabels, [...referenceBrands, ...EXTRA_IMPERSONATED_BRANDS], true)
      : null,
    hostingSensitiveWord: sensitive,
    hostingRandomLabel: platformLabels.some(
      (l) => /^[0-9a-f]{6,}$/.test(l) || (l.length >= 10 && /\d/.test(l) && /[a-z]/.test(l)),
    ),
    urlShortener: URL_SHORTENERS.includes(bare) ? bare : null,
    subdomainBrand: nonPlatformSubdomain.length
      ? brandIn(nonPlatformSubdomain, referenceBrands, false)
      : null,
  }
}
