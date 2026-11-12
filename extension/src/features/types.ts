import type { SensitiveWordCategory } from '../shared/constants'
import type { ImpersonationTechnique } from '../domainSimilarity/types'

/** Representación numérica/booleana de una URL, lista para que la consuman `rules/` y `ml/`. */
export interface FeatureSet {
  urlLength: number
  domainLength: number
  subdomainCount: number
  isIpHost: boolean
  /**
   * El host es una IP enrutable públicamente (no privada, loopback,
   * link-local, CGNAT, documentación ni reservada) — ver `ipScope.ts`.
   * Alimenta solo la regla `ip-host-sensitive-path`; NO está en
   * `ml/vectorize.ts` (`FEATURE_ORDER`), así que no cambia el ML.
   */
  isPublicIpHost: boolean
  hasPunycode: boolean
  /** Existe userinfo (usuario y/o contraseña) en la autoridad de la URL — ver `extractFeatures.ts` (`hasUserinfo`). NO se activa por un "@" en pathname/query/hash. */
  hasAtSymbol: boolean
  hyphenCount: number
  hasSuspiciousTld: boolean
  /**
   * Palabras sensibles en la URL completa (host+path+query+hash) — se
   * mantiene SOLO para la regla `sensitive-words` (`rules/rules.ts`), que no
   * distingue contexto. El modelo de ML ya NO usa este campo agregado: usa
   * `sensitiveWordsInHost`/`InPath`/`InQuery` por separado (ver `ml/vectorize.ts`).
   */
  sensitiveWordCount: number
  /**
   * Categorías semánticas (`shared/constants.ts` → `SENSITIVE_WORD_CATEGORIES`)
   * representadas entre las palabras sensibles efectivamente encontradas en
   * la URL, deduplicadas. Solo para que la regla `sensitive-words` explique
   * QUÉ TIPO de término detectó (ej. "autenticación") en vez del genérico
   * "palabra sensible" — Fase 4/10 del audit de Seguridad-master
   * (`docs/reference-audit-seguridad-master.md`). No es una feature
   * numérica de ML ni crea una regla nueva: se midieron categorías
   * adicionales (banca, urgencia) y se descartaron por falta de evidencia
   * o correlación inversa — ver el comentario de `SENSITIVE_WORD_CATEGORIES`.
   */
  sensitiveWordCategories: SensitiveWordCategory[]
  /** Palabras sensibles dentro del hostname — una marca/palabra de seguridad en el dominio de un sitio ajeno pesa distinto que la misma palabra en el path de un sitio legítimo. */
  sensitiveWordsInHost: number
  /** Palabras sensibles dentro del pathname (ej. "minecraft.net/es-es/login" → 1, sin que el dominio se vea afectado). */
  sensitiveWordsInPath: number
  /** Palabras sensibles dentro del query string. */
  sensitiveWordsInQuery: number
  /** Cantidad de dígitos en el hostname — la feature nueva con mayor separación empírica entre clases (ver `training/analyzeCandidateFeatures.ts`). */
  hostnameDigitCount: number
  /**
   * Proporción de caracteres "especiales" (no alfanumérico ni guion) en el
   * hostname — en la práctica, casi siempre mide densidad de puntos
   * (`.`), porque un hostname normalizado (`toLowerCase()`, sin Punycode
   * decodificado) casi no admite otro carácter. Es la feature con mayor
   * separación empírica de todo el análisis de FeatureSet v2 (d de Cohen
   * 0.92, ver `docs/feature-analysis-v2-raw.md`) y NO es redundante con
   * `subdomainCount` (r=0.20): mide qué tan "fragmentado" es el hostname
   * relativo a su longitud, no cuántas etiquetas tiene en términos
   * absolutos — un dominio corto con muchos puntos separa distinto que uno
   * largo con la misma cantidad de puntos.
   */
  specialCharRatioInHostname: number
  /** Cantidad de segmentos no vacíos del pathname (ej. `/a/b/c` → 3). Complementa `urlLength`: un path profundo (checkout/carrito/cuentas anidadas) no es lo mismo que una URL larga por un solo parámetro largo. */
  pathDepth: number
  /**
   * Resultado del detector de domain impersonation (`domainSimilarity/`,
   * sin relación con Machine Learning — es una lista curada de dominios de
   * referencia + distancia de edición) sobre el DOMINIO REGISTRABLE, no la
   * URL completa. Alimenta la regla `domain-impersonation`
   * (`rules/rules.ts`). Deliberadamente NO está en `ml/vectorize.ts`
   * (`FEATURE_ORDER`): el dataset de phishing real actual no tiene ningún
   * ejemplo con esta señal activa (0/66 dominios de phishing únicos, ver
   * `docs/domain-impersonation-detection.md`), así que un peso de ML no
   * tendría de dónde aprender todavía — mismo criterio ya aplicado a
   * `sensitiveWordCount` para su regla correspondiente.
   */
  isDomainImpersonation: boolean
  /** 0 (sin parecido) a 1 (idéntico tras normalizar) contra el dominio de referencia más cercano. */
  domainSimilarityScore: number
  /** Dominio de referencia más parecido (ej. `"microsoft.com"`), o `null` si ninguno superó el umbral. Solo para explicar la regla — no es una feature numérica de ML. */
  domainSimilarityReferenceDomain: string | null
  /**
   * Técnica que produjo la mejor coincidencia (`domainSimilarity/types.ts`)
   * — `'visual-substitution'` (caracteres que se VEN parecidos, ej.
   * `rnicrosoft.com`/`g00gle.com`) vs `'edit-distance'` (diferencia mínima
   * de caracteres tal cual escrita, ej. `microsfot.com`). Solo para que la
   * regla `domain-impersonation` explique CÓMO se pareció, no cuánto — Fase
   * 10 del audit de Seguridad-master. `null` cuando no hay impersonation.
   */
  domainSimilarityTechnique: ImpersonationTechnique | null
  domainEntropy: number
  isHttps: boolean
  /**
   * Análisis de query params de tracking/atribución publicitaria (UTM, ads,
   * afiliados) — ver `queryParams.ts` y `shared/constants.ts`
   * (`TRACKING_PARAM_NAMES`). Un parámetro de tracking NO implica phishing.
   * DELIBERADAMENTE no están en `ml/vectorize.ts` (`FEATURE_ORDER`) ni
   * alimentan ninguna regla de `rules/rules.ts` todavía: la evaluación
   * empírica sobre el dataset (`docs/tracking-parameter-analysis.md`)
   * encontró separación legítimo/phishing insignificante (Cohen's d < 0.08)
   * y prácticamente cero ejemplos de phishing con tracking real — mismo
   * criterio ya aplicado a `sensitiveWordCount`/`isDomainImpersonation`: sin
   * evidencia, no hay de dónde aprender un peso. Se mantienen en
   * `FeatureSet` solo para explicación contextual y como insumo futuro del
   * análisis de redirecciones (`docs/navigation-redirect-detection-design.md`).
   */
  queryParamCount: number
  trackingParamCount: number
  hasClickTrackingId: boolean
  trackingParamRatio: number
  /**
   * Señales de 2026-10-01 para las reglas candidatas de
   * `rules/candidateRules.ts` (ver `docs/rules-reinforcement.md`). Ninguna
   * está en `ml/vectorize.ts` (`FEATURE_ORDER`): no cambian el ML.
   */
  /** Plataforma de hosting legítima (`github.io`…) de la que el host es subdominio, o `null`. */
  hostingPlatform: string | null
  /** Marca de `REFERENCE_DOMAINS` dentro del subdominio de la plataforma (no como nombre exacto de cuenta). */
  hostingBrand: string | null
  /** Igual que `hostingBrand`, con la lista ampliada `EXTRA_IMPERSONATED_BRANDS`. */
  hostingBrandExtended: string | null
  /** Palabra de acceso (`HOSTING_SENSITIVE_WORDS`) en el subdominio de la plataforma. */
  hostingSensitiveWord: string | null
  /** Etiqueta del subdominio de la plataforma con aspecto aleatorio (hex o letras+dígitos largos). */
  hostingRandomLabel: boolean
  /** Acortador de URL, o `null`. */
  urlShortener: string | null
  /** Marca de `REFERENCE_DOMAINS` en un subdominio de un dominio que no es de la marca ni una plataforma. */
  subdomainBrand: string | null
  /** Host decodificado a Unicode si tiene etiquetas `xn--`, o `null`. */
  punycodeUnicodeHost: string | null
  /** Alguna etiqueta `xn--` mezcla escrituras (UTS #39, nivel "Highly Restrictive"). */
  punycodeMixedScript: boolean
  /** Alguna etiqueta `xn--` se lee como una palabra latina (esqueleto ASCII). */
  punycodeAsciiConfusable: boolean
  /** Dominio de referencia imitado con homoglifos (técnica `homoglyph`), o `null`. */
  homoglyphReferenceDomain: string | null
  /**
   * Guiones que VE el usuario: los del host decodificado. `hyphenCount`
   * (feature del ML, sin cambios) cuenta los del prefijo `xn--` y el
   * separador de Punycode, así que todo dominio IDN activa `many-hyphens`.
   */
  visibleHyphenCount: number
}
