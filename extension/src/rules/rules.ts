import type { ImpersonationTechnique } from '../domainSimilarity/types'
import type { SensitiveWordCategory } from '../shared/constants'
import type { Rule } from './types'

/**
 * Base de conocimiento del sistema de reglas: cada regla es una condición
 * sobre las características de la URL y una explicación en lenguaje humano —
 * lo que hace que el veredicto sea justificable en vez de una caja negra.
 * Los pesos NO viven aquí: están centralizados en `weights.ts` para poder
 * ajustarlos sin tocar esta lógica.
 */
export const RULES: readonly Rule[] = [
  {
    id: 'ip-as-host',
    description: 'El sitio usa una dirección IP en vez de un nombre de dominio',
    test: (f) => f.isIpHost,
    explain: () =>
      'La URL usa una dirección IP en lugar de un nombre de dominio, algo inusual en sitios legítimos.',
  },
  {
    id: 'ip-host-sensitive-path',
    description:
      'El sitio usa una dirección IP pública y su ruta contiene palabras de acceso o banca',
    test: (f) => f.isPublicIpHost && f.sensitiveWordsInPath >= 1,
    explain: () =>
      'La URL usa una dirección IP pública en lugar de un nombre de dominio y su ruta contiene palabras de acceso a cuentas o de banca: los servicios legítimos de este tipo usan un dominio propio.',
  },
  {
    id: 'punycode',
    description: 'El dominio usa caracteres internacionales (Punycode); informativa',
    test: (f) => f.hasPunycode,
    explain: (f) =>
      `El dominio está escrito con caracteres internacionales${f.punycodeUnicodeHost ? ` (se ve como "${f.punycodeUnicodeHost}")` : ''}. Por sí solo no es señal de fraude.`,
  },
  {
    id: 'punycode-deceptive',
    description:
      'El dominio Punycode mezcla escrituras o, decodificado, imita una marca con homoglifos',
    test: (f) => f.hasPunycode && (f.punycodeMixedScript || f.homoglyphReferenceDomain !== null),
    explain: (f) =>
      f.homoglyphReferenceDomain
        ? `El dominio se ve como "${f.punycodeUnicodeHost}": usa letras de otro alfabeto que se ven idénticas a las latinas para imitar a "${f.homoglyphReferenceDomain}".`
        : `El dominio se ve como "${f.punycodeUnicodeHost}" y mezcla letras de distintos alfabetos que se ven iguales, una técnica para imitar nombres conocidos.`,
  },
  {
    id: 'at-symbol',
    description: 'La URL incluye credenciales (usuario/contraseña) antes del dominio real',
    test: (f) => f.hasAtSymbol,
    explain: () =>
      'La URL incluye texto de usuario (y opcionalmente contraseña) antes del "@", una técnica usada para ocultar el verdadero dominio de destino — el navegador ignora todo lo anterior al "@" y navega al dominio que sigue.',
  },
  {
    id: 'suspicious-tld',
    description: 'El dominio termina en un TLD frecuentemente abusado',
    test: (f) => f.hasSuspiciousTld,
    explain: () =>
      'El dominio usa una extensión (TLD) frecuentemente utilizada en campañas de phishing.',
  },
  {
    id: 'many-subdomains',
    description: 'El dominio tiene 3 o más subdominios',
    test: (f) => f.subdomainCount >= 3,
    explain: (f) =>
      `El dominio tiene ${f.subdomainCount} subdominios encadenados, un patrón usado para ocultar el dominio real.`,
  },
  {
    // 2026-10-01: cuenta los guiones que VE el usuario (el prefijo "xn--" y el separador de
    // Punycode no cuentan: era un error de conteo) y no se aplica en plataformas de hosting
    // (ahí la cubre `hosting-many-hyphens`, sin override). `hyphenCount` del ML no cambia.
    // Tampoco se aplica en hosts con Punycode (ahí la cubre `idn-many-hyphens`, sin override).
    id: 'many-hyphens',
    description: 'El dominio tiene 2 o más guiones (fuera de plataformas de hosting e IDN)',
    test: (f) => f.visibleHyphenCount >= 2 && f.hostingPlatform === null && !f.hasPunycode,
    explain: (f) =>
      `El dominio tiene ${f.visibleHyphenCount} guiones, frecuente en dominios que imitan nombres de marcas.`,
  },
  {
    // 2026-10-01 (decisión de diseño, no resultado validado): en dominios IDN los guiones
    // visibles siguen sumando peso, pero sin garantizar "alto". Se eligió mirando el
    // conjunto de IDN legítimos; ver `docs/rules-reinforcement.md`.
    id: 'idn-many-hyphens',
    description: 'Dominio internacionalizado (Punycode) con 2 o más guiones (sin override)',
    test: (f) => f.visibleHyphenCount >= 2 && f.hostingPlatform === null && f.hasPunycode,
    explain: (f) =>
      `El dominio usa caracteres internacionales y tiene ${f.visibleHyphenCount} guiones, frecuente en dominios que imitan nombres de marcas.`,
  },
  {
    id: 'hosting-many-hyphens',
    description: 'Subdominio de una plataforma de hosting con 2 o más guiones (sin override)',
    test: (f) => f.visibleHyphenCount >= 2 && f.hostingPlatform !== null,
    explain: (f) =>
      `La página está alojada en ${f.hostingPlatform} y su nombre tiene ${f.visibleHyphenCount} guiones, frecuente en imitaciones.`,
  },
  {
    id: 'hosting-brand-extended',
    description: 'Subdominio de una plataforma de hosting que incluye el nombre de una marca',
    test: (f) => f.hostingBrandExtended !== null,
    explain: (f) =>
      `La página está alojada en ${f.hostingPlatform}, un servicio donde cualquiera puede publicar, y su nombre incluye la marca "${f.hostingBrandExtended}": las marcas no publican sus páginas de acceso ahí.`,
  },
  {
    id: 'hosting-sensitive-subdomain',
    description: 'Subdominio de una plataforma de hosting con una palabra de acceso a cuentas',
    test: (f) => f.hostingSensitiveWord !== null,
    explain: (f) =>
      `La página está alojada en ${f.hostingPlatform} y quien la publicó eligió un nombre con la palabra "${f.hostingSensitiveWord}".`,
  },
  {
    id: 'hosting-random-subdomain',
    description: 'Subdominio de una plataforma de hosting con un nombre de aspecto aleatorio',
    test: (f) => f.hostingRandomLabel,
    explain: (f) =>
      `La página está alojada en ${f.hostingPlatform} con un nombre que parece generado al azar, típico de páginas desechables.`,
  },
  {
    id: 'brand-in-subdomain',
    description: 'Una marca de REFERENCE_DOMAINS aparece en el subdominio de un dominio ajeno',
    test: (f) => f.subdomainBrand !== null,
    explain: (f) =>
      `La marca "${f.subdomainBrand}" aparece delante de un dominio que no le pertenece, un patrón para que la dirección parezca de la marca.`,
  },
  {
    id: 'url-shortener',
    description: 'Acortador de URL: el destino real no aparece en la dirección (informativa)',
    test: (f) => f.urlShortener !== null,
    explain: (f) =>
      `Es un enlace acortado (${f.urlShortener}): la dirección no muestra el sitio de destino. Esto no indica phishing por sí solo; revisa a qué sitio llegas antes de escribir datos.`,
  },
  {
    id: 'sensitive-words',
    description: 'La URL contiene palabras asociadas a phishing (login, banco, verificar, etc.)',
    test: (f) => f.sensitiveWordCount >= 1,
    explain: (f) => explainSensitiveWords(f.sensitiveWordCount, f.sensitiveWordCategories),
  },
  {
    id: 'no-https',
    description: 'El sitio no usa HTTPS',
    test: (f) => !f.isHttps,
    explain: () => 'El sitio no usa una conexión segura (HTTPS).',
  },
  {
    id: 'high-entropy-domain',
    description: 'El dominio tiene una entropía alta (parece generado al azar)',
    test: (f) => f.domainEntropy > 3.5,
    explain: (f) =>
      `El dominio tiene una entropía de ${f.domainEntropy.toFixed(2)} bits, un valor típico de dominios generados automáticamente.`,
  },
  {
    id: 'long-url',
    description: 'La URL es inusualmente larga',
    test: (f) => f.urlLength > 75,
    explain: (f) =>
      `La URL tiene ${f.urlLength} caracteres, más de lo habitual en enlaces legítimos.`,
  },
  {
    id: 'domain-impersonation',
    description:
      'El dominio es visualmente muy parecido a un dominio legítimo conocido (typosquatting)',
    test: (f) => f.isDomainImpersonation,
    explain: (f) =>
      explainDomainImpersonation(
        f.domainSimilarityReferenceDomain,
        f.domainSimilarityScore,
        f.domainSimilarityTechnique,
        f.punycodeUnicodeHost,
      ),
  },
]

/**
 * Mensaje de `sensitive-words` según las categorías realmente encontradas
 * (`SENSITIVE_WORD_CATEGORIES` en `shared/constants.ts`) — Fase 4/10 del
 * audit de Seguridad-master (`docs/reference-audit-seguridad-master.md`).
 * Nunca cambia SI la regla se activa ni su peso, solo el texto.
 */
function explainSensitiveWords(count: number, categories: SensitiveWordCategory[]): string {
  const hasAuth = categories.includes('auth')
  const hasBanking = categories.includes('banking')

  if (hasAuth && hasBanking) {
    return `Se detectaron ${count} término(s) asociados a autenticación y a servicios financieros (ej. "login", "banco").`
  }
  if (hasAuth) {
    return `Se detectaron ${count} término(s) asociados a autenticación (ej. inicio de sesión, verificación, token).`
  }
  if (hasBanking) {
    return `Se detectaron ${count} término(s) asociados a servicios financieros (ej. "banco").`
  }
  return `La URL contiene ${count} palabra(s) sensible(s) (ej. "login", "verificar", "banco").`
}

/** Mensaje de `domain-impersonation` según la técnica que produjo la coincidencia — Fase 10 del audit de Seguridad-master. */
function explainDomainImpersonation(
  referenceDomain: string | null,
  similarityScore: number,
  technique: ImpersonationTechnique | null,
  unicodeHost: string | null = null,
): string {
  if (technique === 'homoglyph') {
    return `El dominio${unicodeHost ? ` se ve como "${unicodeHost}" y` : ''} usa letras de otro alfabeto que se ven idénticas a las latinas para imitar a "${referenceDomain}".`
  }
  const similarityPercent = Math.round(similarityScore * 100)
  const technicaDescripcion =
    technique === 'visual-substitution'
      ? 'el dominio utiliza caracteres visualmente similares (ej. números o letras parecidas) a una marca conocida'
      : 'el dominio tiene una diferencia mínima de caracteres respecto a un dominio legítimo conocido, típica de un error tipográfico deliberado (typosquatting)'

  return `El dominio se parece mucho a "${referenceDomain}" (similitud ${similarityPercent}%) — ${technicaDescripcion}.`
}
