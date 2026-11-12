import { REFERENCE_BRANDS } from './brands'
import { CONFUSABLES_TO_LATIN } from './confusablesLatin'
import { labelToUnicode } from './punycode'
import { damerauLevenshteinDistance, similarityFromDistance } from './similarity'

/**
 * Esqueleto de UTS #39 (sección 4, "Confusable Detection") restringido a la
 * tabla latina empaquetada (`confusablesLatin.ts`): NFD → cada carácter a su
 * prototipo → NFD, y minúsculas (los dominios no distinguen mayúsculas).
 * Dos cadenas con el mismo esqueleto se ven iguales: `pаypal` (con `а`
 * cirílica) y `paypal` dan ambas `paypal`.
 */
export function skeleton(text: string): string {
  let out = ''
  for (const ch of text.normalize('NFD')) out += CONFUSABLES_TO_LATIN.get(ch) ?? ch
  return out.normalize('NFD').toLowerCase()
}

const SCRIPTS = [
  'Latin',
  'Cyrillic',
  'Greek',
  'Armenian',
  'Georgian',
  'Hebrew',
  'Arabic',
  'Syriac',
  'Thaana',
  'Devanagari',
  'Bengali',
  'Gurmukhi',
  'Gujarati',
  'Oriya',
  'Tamil',
  'Telugu',
  'Kannada',
  'Malayalam',
  'Sinhala',
  'Thai',
  'Lao',
  'Tibetan',
  'Myanmar',
  'Khmer',
  'Mongolian',
  'Ethiopic',
  'Cherokee',
  'Han',
  'Hiragana',
  'Katakana',
  'Hangul',
  'Bopomofo',
  'Canadian_Aboriginal',
  'Tifinagh',
  'Coptic',
  'Glagolitic',
  'Runic',
  'Ogham',
  'Vai',
  'Nko',
].map((name) => [name, new RegExp(`\\p{Script=${name}}`, 'u')] as const)

/** Escrituras de las letras de `text` (los dígitos, guiones y marcas combinantes no cuentan). */
export function scriptsOf(text: string): Set<string> {
  const scripts = new Set<string>()
  for (const ch of text) {
    // Letras de escritura Common/Inherited (p. ej. `ー`, U+30FC, marca de vocal larga japonesa)
    // no pertenecen a ninguna escritura concreta: no cuentan para la mezcla (UTS #39, sección 5.1).
    if (!/\p{L}/u.test(ch) || /[\p{Script=Common}\p{Script=Inherited}]/u.test(ch)) continue
    scripts.add(SCRIPTS.find(([, re]) => re.test(ch))?.[0] ?? 'Other')
  }
  return scripts
}

/** Combinaciones permitidas por el nivel "Highly Restrictive" de UTS #39 (sección 5.2). */
const ALLOWED_COMBINATIONS = [
  ['Latin', 'Han', 'Hiragana', 'Katakana'],
  ['Latin', 'Han', 'Bopomofo'],
  ['Latin', 'Han', 'Hangul'],
]

/** ¿La etiqueta mezcla escrituras de forma no permitida (p. ej. latín + cirílico en `pаypal`)? */
export function isMixedScript(text: string): boolean {
  const scripts = scriptsOf(text)
  if (scripts.size <= 1) return false
  return !ALLOWED_COMBINATIONS.some((allowed) => [...scripts].every((s) => allowed.includes(s)))
}

const hasNonAscii = (s: string) => /[^\x00-\x7f]/.test(s)

export interface IdnAnalysis {
  /** Host tal como lo ve el usuario (etiquetas `xn--` decodificadas), o `null` si no hay ninguna. */
  unicodeHost: string | null
  /** Alguna etiqueta `xn--` mezcla escrituras de forma no permitida. */
  mixedScript: boolean
  /** Alguna etiqueta `xn--` tiene caracteres no ASCII pero su esqueleto es ASCII: se lee como una palabra latina. */
  asciiConfusable: boolean
  /** Dominio de referencia imitado con homoglifos (técnica `homoglyph`), o `null`. */
  homoglyphReferenceDomain: string | null
  /** Dónde está la imitación: en el dominio registrable o en un subdominio. */
  homoglyphPart: 'dominio' | 'subdominio' | null
  /** Similitud del esqueleto con el dominio de referencia (1 = idéntico tras plegar). */
  homoglyphScore: number
}

const NO_IDN: IdnAnalysis = {
  unicodeHost: null,
  mixedScript: false,
  asciiConfusable: false,
  homoglyphReferenceDomain: null,
  homoglyphPart: null,
  homoglyphScore: 0,
}

/** Umbral de similitud del esqueleto del dominio completo — el mismo que `IMPERSONATION_SIMILARITY_THRESHOLD`. */
const HOMOGLYPH_DOMAIN_THRESHOLD = 0.82

/**
 * Técnica `homoglyph`: decodifica las etiquetas Punycode, las pliega a su
 * forma latina con la tabla oficial de Unicode y compara con las marcas de
 * `REFERENCE_DOMAINS`:
 *  - una etiqueta (o un token separado por guion) cuyo esqueleto ES el
 *    nombre de una marca de ≥ 4 letras (`pаypal.example`, `аpple-id.test`),
 *    sin importar el TLD;
 *  - o el dominio registrable completo, cuyo esqueleto se parece al dominio
 *    de referencia con la misma similitud mínima que el detector actual.
 * Solo se evalúan etiquetas con caracteres no ASCII: una marca escrita en
 * ASCII no es un homoglifo (la cubren las otras técnicas).
 */
export function analyzeIdn(hostname: string, registrableDomain: string): IdnAnalysis {
  if (!hostname.includes('xn--')) return NO_IDN
  const labels = hostname.split('.')
  const unicodeLabels = labels.map(labelToUnicode)
  const registrableLabelCount = registrableDomain.split('.').length
  const firstRegistrable = labels.length - registrableLabelCount

  let mixedScript = false
  let asciiConfusable = false
  let best: { domain: string; part: 'dominio' | 'subdominio'; score: number } | null = null

  unicodeLabels.forEach((u, i) => {
    if (!hasNonAscii(u)) return
    if (isMixedScript(u)) mixedScript = true
    const sk = skeleton(u)
    if (/^[a-z0-9-]+$/.test(sk)) asciiConfusable = true
    const part = i < firstRegistrable ? 'subdominio' : 'dominio'
    const tokens = [sk, ...sk.split('-')]
    for (const { brand, domain } of REFERENCE_BRANDS) {
      if (brand.length < 4) continue
      if (tokens.includes(skeleton(brand)) && (!best || best.score < 1))
        best = { domain, part, score: 1 }
    }
  })

  const registrableUnicode = unicodeLabels.slice(firstRegistrable).join('.')
  if (!best && hasNonAscii(registrableUnicode)) {
    const sk = skeleton(registrableUnicode)
    for (const { domain } of REFERENCE_BRANDS) {
      const ref = skeleton(domain)
      const score = similarityFromDistance(sk, ref, damerauLevenshteinDistance(sk, ref))
      if (score >= HOMOGLYPH_DOMAIN_THRESHOLD && (!best || score > best.score))
        best = { domain, part: 'dominio', score }
    }
  }

  return {
    unicodeHost: unicodeLabels.join('.'),
    mixedScript,
    asciiConfusable,
    homoglyphReferenceDomain: best?.domain ?? null,
    homoglyphPart: best?.part ?? null,
    homoglyphScore: best?.score ?? 0,
  }
}
