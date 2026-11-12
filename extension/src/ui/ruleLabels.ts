import type { RuleId } from '../rules/weights'

/**
 * Textos de PRESENTACIÓN de cada regla — no cambian ids, pesos, condiciones
 * ni las explicaciones técnicas de `rules/rules.ts`. Cada texto describe
 * exactamente la condición que activa esa regla, en lenguaje sin jerga,
 * para que un usuario sin conocimientos técnicos entienda qué se encontró.
 */

/** Etiqueta corta en lenguaje natural para chips compactos (historial, estadísticas). */
export const RULE_CHIP_LABELS: Record<RuleId, string> = {
  'ip-as-host': 'Dirección numérica (IP)',
  punycode: 'Dominio internacional',
  'at-symbol': 'Destino oculto en la dirección',
  'suspicious-tld': 'Terminación poco común',
  'many-subdomains': 'Muchos subdominios',
  'many-hyphens': 'Varios guiones en el dominio',
  'sensitive-words': 'Palabras de acceso o pago',
  'no-https': 'Conexión no cifrada',
  'high-entropy-domain': 'Nombre poco habitual',
  'long-url': 'Dirección muy larga',
  'domain-impersonation': 'Parecido a un sitio conocido',
  'ip-host-sensitive-path': 'Acceso a cuentas desde una IP',
  'hosting-brand': 'Marca en una página de alojamiento gratuito',
  'hosting-brand-extended': 'Marca en una página de alojamiento gratuito',
  'hosting-sensitive-subdomain': 'Página de acceso en alojamiento gratuito',
  'brand-in-subdomain': 'Marca dentro de otro dominio',
  'punycode-deceptive': 'Letras de otro alfabeto',
  'url-shortener': 'Enlace acortado',
  'hosting-many-hyphens': 'Varios guiones en una página de alojamiento',
  'idn-many-hyphens': 'Varios guiones en el dominio',
  'hosting-random-subdomain': 'Nombre al azar en una página de alojamiento',
}

/**
 * Frase completa para "Señales detectadas" y "Ver análisis". Correspondencia
 * con la condición real de cada regla (`rules/rules.ts`):
 * - `ip-as-host`: el host es una dirección IP.
 * - `punycode`: el dominio contiene "xn--" (informativa desde 2026-10-01).
 * - `at-symbol`: hay usuario/contraseña antes del dominio (userinfo).
 * - `suspicious-tld`: la extensión está en la lista de TLD abusados.
 * - `many-subdomains`: 3 o más subdominios.
 * - `many-hyphens`: 2 o más guiones en el hostname.
 * - `sensitive-words`: aparece "login", "verificar", "banco", "token", "secure" o "account" (la frase no nombra ejemplos para no citar una palabra que quizá no está en la URL).
 * - `no-https`: el esquema no es HTTPS.
 * - `high-entropy-domain`: entropía del hostname > 3.5 bits.
 * - `long-url`: más de 75 caracteres.
 * - `domain-impersonation`: el dominio se parece a uno de referencia conocido.
 * - `ip-host-sensitive-path`: el host es una IP pública y la ruta contiene una palabra sensible.
 */
export const RULE_SIGNAL_TEXTS: Record<RuleId, string> = {
  'ip-as-host': 'La dirección es una serie de números en lugar del nombre de un sitio.',
  punycode:
    'El nombre del sitio usa letras de otros idiomas o alfabetos. Por sí solo no es una mala señal.',
  'at-symbol':
    'La dirección esconde el sitio real: lo que aparece antes de la @ no es el sitio al que vas.',
  'suspicious-tld': 'El nombre del sitio termina de una forma poco común, muy usada en engaños.',
  'many-subdomains':
    'La dirección encadena muchas partes antes del nombre del sitio, un truco para disimular el sitio real.',
  'many-hyphens':
    'El nombre del sitio tiene varios guiones, algo frecuente cuando se imita a una marca.',
  'sensitive-words': 'La dirección usa palabras de inicio de sesión, cuentas o bancos.',
  'no-https': 'La conexión con este sitio no está protegida: otros podrían ver lo que escribas.',
  'high-entropy-domain': 'El nombre del sitio tiene una forma poco habitual.',
  'long-url': 'La dirección es mucho más larga de lo normal.',
  'domain-impersonation': 'El nombre del sitio se parece mucho al de otro sitio conocido.',
  'ip-host-sensitive-path':
    'Una página para entrar a cuentas o al banco está en una dirección hecha de números, no en el nombre de un sitio.',
  'hosting-brand':
    'La página está en un servicio donde cualquiera puede publicar, y su nombre usa el de una marca conocida.',
  'hosting-brand-extended':
    'La página está en un servicio donde cualquiera puede publicar, y su nombre usa el de una marca conocida.',
  'hosting-sensitive-subdomain':
    'La página está en un servicio donde cualquiera puede publicar, y su nombre habla de iniciar sesión o de cuentas.',
  'brand-in-subdomain':
    'El nombre de una marca conocida aparece delante de un sitio que no es de esa marca.',
  'punycode-deceptive':
    'El nombre del sitio mezcla letras de otros alfabetos que se ven iguales a las nuestras.',
  'url-shortener': 'Es un enlace acortado: no muestra a qué sitio lleva. Mira bien a dónde llegas.',
  'hosting-many-hyphens':
    'La página está en un servicio donde cualquiera puede publicar, y su nombre tiene varios guiones, algo frecuente en imitaciones.',
  'idn-many-hyphens':
    'El nombre del sitio usa letras de otros alfabetos y tiene varios guiones, algo frecuente en imitaciones.',
  'hosting-random-subdomain':
    'La página está en un servicio donde cualquiera puede publicar, y su nombre parece puesto al azar, algo típico de páginas falsas que duran poco.',
}

/** Nombre técnico de cada regla — solo para "Información avanzada". */
export const RULE_TECHNICAL_LABELS: Record<RuleId, string> = {
  'ip-as-host': 'IP como host',
  punycode: 'Punycode (informativa)',
  'at-symbol': 'Uso de @ (userinfo)',
  'suspicious-tld': 'TLD sospechoso',
  'many-subdomains': 'Muchos subdominios',
  'many-hyphens': 'Muchos guiones',
  'sensitive-words': 'Palabras sensibles',
  'no-https': 'No usa HTTPS',
  'high-entropy-domain': 'Entropía alta',
  'long-url': 'URL muy larga',
  'domain-impersonation': 'Domain impersonation',
  'ip-host-sensitive-path': 'IP pública + palabras sensibles en la ruta',
  'hosting-brand': 'Plataforma de hosting + marca (REFERENCE_DOMAINS)',
  'hosting-brand-extended': 'Plataforma de hosting + marca (lista ampliada)',
  'hosting-sensitive-subdomain': 'Plataforma de hosting + palabra de acceso',
  'brand-in-subdomain': 'Marca en subdominio ajeno',
  'punycode-deceptive': 'Punycode engañoso (mezcla de escrituras u homoglifo)',
  'url-shortener': 'Acortador de URL (informativa)',
  'hosting-many-hyphens': 'Muchos guiones en subdominio de plataforma (sin override)',
  'idn-many-hyphens': 'Muchos guiones en dominio IDN/Punycode (sin override)',
  'hosting-random-subdomain': 'Subdominio aleatorio en plataforma de hosting',
}
