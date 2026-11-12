/**
 * Pesos de cada regla, centralizados en un solo lugar para poder ajustarlos
 * (ej. durante la evaluación con datos reales) sin tocar la condición ni la
 * explicación de la regla. Ninguna regla debe valer 100 por sí sola: el
 * veredicto siempre depende de una combinación de señales, nunca de una sola.
 */
export const RULE_WEIGHTS = {
  'ip-as-host': 30,
  /**
   * 2026-10-01 (decisión del proyecto): `punycode` pasa a ser INFORMATIVA
   * (peso 0, sin override, no cuenta para el piso). Un dominio internacional
   * normal (`münchen.de`, `сайт.рф`) no es señal de fraude; la imitación con
   * homoglifos o mezcla de escrituras la cubre `punycode-deceptive` (fuerte).
   * Antes: peso 30 y regla fuerte (todo IDN quedaba en "alto").
   */
  punycode: 0,
  'at-symbol': 30,
  'suspicious-tld': 20,
  'many-subdomains': 15,
  'many-hyphens': 10,
  'sensitive-words': 10,
  'no-https': 15,
  'high-entropy-domain': 15,
  'long-url': 10,
  /**
   * Similitud visual con un dominio legítimo conocido (typosquatting/
   * lookalike, ej. "rnicrosoft.com" vs "microsoft.com") — ver
   * `domainSimilarity/`. Peso comparable al de `suspicious-tld` (misma
   * categoría: señal de nivel de dominio con precisión alta pero no
   * absoluta) y DELIBERADAMENTE no está en `STRONG_RULE_IDS`
   * (`agent/combine.ts`, sin modificar) — no tiene poder de override por
   * sí sola. Justificación completa, con evaluación empírica de
   * precisión/recall, en `docs/domain-impersonation-detection.md`.
   */
  'domain-impersonation': 20,
  /**
   * IP PÚBLICA como host + palabras sensibles en la ruta (2026-10-01). Es
   * regla fuerte (`STRONG_RULE_IDS`): un sitio de acceso o banca servido
   * desde una IP pública es riesgo alto por sí solo. Las IP privadas o
   * locales (portales cautivos, routers) NO la activan — ver
   * `features/ipScope.ts` y `docs/rules-reinforcement.md`.
   */
  'ip-host-sensitive-path': 20,
  /**
   * Reglas CANDIDATAS (2026-10-01): tienen peso e id, pero NO están en
   * `RULES` (no se ejecutan en `decide()`) hasta que se apruebe su impacto
   * — ver `candidateRules.ts` y `docs/rules-reinforcement.md`.
   */
  'hosting-brand': 20,
  'hosting-brand-extended': 20,
  'hosting-sensitive-subdomain': 15,
  'brand-in-subdomain': 20,
  'punycode-deceptive': 30,
  /** `many-hyphens` dentro de una plataforma de hosting: mismo peso (10) pero SIN poder de override. */
  'hosting-many-hyphens': 10,
  /** `many-hyphens` en un host con Punycode (IDN): mismo peso (10) pero SIN poder de override. */
  'idn-many-hyphens': 10,
  'hosting-random-subdomain': 15,
  /** Informativa: no suma puntaje ni cuenta para el piso de corroboración. */
  'url-shortener': 0,
} as const satisfies Record<string, number>

export type RuleId = keyof typeof RULE_WEIGHTS
