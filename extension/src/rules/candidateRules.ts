import type { Rule } from './types'

/**
 * Reglas que NO están activas en `RULES` (2026-10-01).
 *
 * Las propuestas A y C de `docs/rules-reinforcement.md` se aprobaron y sus
 * reglas ya viven en `rules.ts` (`hosting-brand-extended`,
 * `hosting-sensitive-subdomain`, `hosting-random-subdomain`,
 * `brand-in-subdomain`, `hosting-many-hyphens`, `punycode-deceptive`,
 * `url-shortener`). Aquí quedan:
 *  - `CANDIDATE_RULES`: candidatas medidas pero no activadas;
 *  - las definiciones ANTERIORES de `many-hyphens` y `punycode`, solo para
 *    reconstruir el comportamiento previo en las evaluaciones
 *    (`training/validateRuleReinforcement.ts`, `evaluateRuleCandidates.ts`).
 */
export const CANDIDATE_RULES: readonly Rule[] = [
  {
    // No activada: `hosting-brand-extended` (lista ampliada) la incluye.
    id: 'hosting-brand',
    description:
      'Subdominio de una plataforma de hosting gratuito que incluye una marca de REFERENCE_DOMAINS',
    test: (f) => f.hostingBrand !== null,
    explain: (f) =>
      `La página está alojada en ${f.hostingPlatform}, un servicio donde cualquiera puede publicar, y su nombre incluye la marca "${f.hostingBrand}": las marcas no publican sus páginas de acceso ahí.`,
  },
]

/** `many-hyphens` hasta el 2026-10-01: contaba los guiones de `xn--` y se aplicaba también en plataformas. */
export const LEGACY_MANY_HYPHENS: Rule = {
  id: 'many-hyphens',
  description: 'El dominio tiene 2 o más guiones',
  test: (f) => f.hyphenCount >= 2,
  explain: (f) =>
    `El dominio tiene ${f.hyphenCount} guiones, frecuente en dominios que imitan nombres de marcas.`,
}

/** `punycode` hasta el 2026-10-01: peso 30 y regla fuerte (todo IDN quedaba en "alto"). */
export const LEGACY_PUNYCODE: Rule = {
  id: 'punycode',
  weight: 30,
  description: 'El dominio usa codificación Punycode',
  test: (f) => f.hasPunycode,
  explain: () =>
    'El dominio usa Punycode ("xn--"), una técnica común para imitar visualmente marcas conocidas.',
}

/** Variantes intermedias medidas en la etapa de candidatas (solo para `evaluateRuleCandidates.ts`). */
export const MANY_HYPHENS_VISIBLE: Rule = {
  id: 'many-hyphens',
  description: 'El dominio tiene 2 o más guiones (los que ve el usuario)',
  test: (f) => f.visibleHyphenCount >= 2,
  explain: (f) =>
    `El dominio tiene ${f.visibleHyphenCount} guiones, frecuente en dominios que imitan nombres de marcas.`,
}

export const MANY_HYPHENS_OUTSIDE_HOSTING: Rule = {
  id: 'many-hyphens',
  description: 'El dominio tiene 2 o más guiones (fuera de plataformas de hosting)',
  test: (f) => f.hyphenCount >= 2 && f.hostingPlatform === null,
  explain: (f) =>
    `El dominio tiene ${f.hyphenCount} guiones, frecuente en dominios que imitan nombres de marcas.`,
}

export const HOSTING_MANY_HYPHENS: Rule = {
  id: 'hosting-many-hyphens',
  description: 'Subdominio de una plataforma de hosting con 2 o más guiones',
  test: (f) => f.hyphenCount >= 2 && f.hostingPlatform !== null,
  explain: (f) =>
    `La página está alojada en ${f.hostingPlatform} y su nombre tiene ${f.hyphenCount} guiones, frecuente en imitaciones.`,
}
