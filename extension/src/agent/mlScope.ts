import type { FeatureSet } from '../features/types'

/**
 * Por qué NO se aplica el ML a una URL (2026-10-01, `docs/ml-scope.md`).
 * El ML aprende la forma léxica de los dominios PROPIOS del atacante; en
 * estos dos casos esa forma no distingue lo legítimo del fraude y deciden
 * solo las reglas:
 *  - `plataforma`: subdominio de una plataforma de hosting (github.io,
 *    vercel.app, blogspot…), donde cualquiera publica. Medido: la LR v2
 *    marcaba como phishing el 54 % de 557 sitios legítimos de plataformas.
 *  - `idn`: dominio con Punycode (`xn--`). Las features se calculan sobre la
 *    forma codificada, y el ML marcaba en "alto" 353 de 361 dominios
 *    internacionales legítimos.
 */
export type MlSkipReason = 'plataforma' | 'idn'

export function mlSkipReason(features: FeatureSet): MlSkipReason | null {
  if (features.hasPunycode) return 'idn'
  if (features.hostingPlatform !== null) return 'plataforma'
  return null
}

export const ML_SKIP_TEXTS: Record<MlSkipReason, string> = {
  plataforma:
    'no se aplicó: el sitio está en una plataforma de alojamiento donde cualquiera puede publicar, y la forma de la dirección no distingue un proyecto legítimo de un fraude; deciden las reglas',
  idn: 'no se aplicó: el dominio usa caracteres internacionales y el modelo solo ve su forma codificada ("xn--"), que no indica fraude; deciden las reglas',
}
