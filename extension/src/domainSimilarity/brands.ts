import { REFERENCE_DOMAINS } from './referenceDomains'

/**
 * Nombre de marca de cada dominio de referencia: la etiqueta a la izquierda
 * de su sufijo público (`bancolombia.com` → `bancolombia`, `bbva.com.co` →
 * `bbva`). Misma base de conocimiento curada que `referenceDomains.ts`.
 */
export const REFERENCE_BRANDS: ReadonlyArray<{ brand: string; domain: string }> =
  REFERENCE_DOMAINS.map((domain) => ({ brand: domain.split('.')[0]!, domain }))

/**
 * Marcas ADICIONALES suplantadas con frecuencia en el phishing alojado en
 * plataformas (medido en `training/analyzePlatformPhishing.ts`: billeteras
 * de criptomonedas, correo y redes sociales). NO amplían `REFERENCE_DOMAINS`
 * (no afectan al detector de typosquatting); solo las usa la regla
 * candidata `hosting-brand-extended`. Cada una se mide contra los negativos
 * legítimos de plataformas antes de activarse.
 */
export const EXTRA_IMPERSONATED_BRANDS: readonly string[] = [
  'metamask',
  'ledger',
  'trezor',
  'coinbase',
  'binance',
  'opensea',
  'pancakeswap',
  'uniswap',
  'outlook',
  'office365',
  'onedrive',
  'sharepoint',
  'icloud',
  'gmail',
  'hotmail',
  'xfinity',
  'comcast',
  'telegram',
  'whatsapp',
  'roblox',
  'linkedin',
  'docusign',
  'dropbox',
  'yahoo',
  'usps',
  'fedex',
  'wellsfargo',
]

/**
 * ¿`text` (etiquetas de un subdominio) contiene la marca `brand`?
 *  - como token separado por guion, guion bajo, punto o dígitos
 *    (`paypal-login`, `nequi2024`), para cualquier marca de ≥ 4 letras;
 *  - o como subcadena, solo para marcas de ≥ 6 letras (`instagramlogin-ejemplo`),
 *    donde es improbable que la marca aparezca por casualidad dentro de
 *    otra palabra (las cortas como `dian` sí: "guardian", "indian").
 */
export function containsBrand(text: string, brand: string): boolean {
  if (brand.length < 4) return false
  const tokens = text
    .toLowerCase()
    .split(/[-_.\d]+/)
    .filter(Boolean)
  if (tokens.includes(brand)) return true
  return brand.length >= 6 && text.toLowerCase().includes(brand)
}
