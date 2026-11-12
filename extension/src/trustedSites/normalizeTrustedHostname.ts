const ALLOWED_SCHEMES = new Set(['http:', 'https:'])
const SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z\d+\-.]*:/

/**
 * Convierte una URL completa o un hostname suelto a un hostname normalizado
 * y validado, para usar como clave en la allowlist. Rechaza (lanza) URLs
 * con esquemas que no sean `http`/`https` — `chrome://`, `chrome-extension://`,
 * `about:`, `file:`, etc. nunca deberían poder agregarse como "sitio
 * confiable".
 *
 * Ejemplos:
 *   normalizeTrustedHostname("https://Example.com/login?q=1") -> "example.com"
 *   normalizeTrustedHostname("Example.com")                   -> "example.com"
 *   normalizeTrustedHostname("chrome://settings")              -> lanza
 */
export function normalizeTrustedHostname(urlOrHostname: string): string {
  const trimmed = urlOrHostname.trim()
  if (trimmed === '') {
    throw new Error('El hostname no puede estar vacío.')
  }

  // Si no trae esquema (ej. el usuario tipeó "example.com" a mano en el
  // formulario de "agregar dominio"), se asume https: solo para poder
  // reutilizar el mismo parser/validación — nunca se guarda ese esquema.
  const candidate = SCHEME_PATTERN.test(trimmed) ? trimmed : `https://${trimmed}`
  const url = new URL(candidate) // lanza si es inválida

  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    throw new Error(
      `No se pueden confiar sitios con el esquema "${url.protocol}" — solo http/https.`,
    )
  }
  if (!url.hostname) {
    throw new Error('No se pudo determinar un hostname válido.')
  }

  return url.hostname.toLowerCase()
}
