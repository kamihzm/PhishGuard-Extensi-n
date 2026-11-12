/**
 * Normaliza una URL para comparar autorizaciones de navegación de forma
 * robusta — nunca se compara el string crudo.
 *
 * Usa el parser WHATWG (`new URL`), que YA resuelve gratis: protocolo y
 * hostname en minúsculas, dominios internacionalizados a punycode,
 * percent-encoding consistente, y agrega el "/" final cuando el path está
 * vacío (`http://example.com` y `http://example.com/` normalizan igual).
 *
 * Además, a propósito:
 * - **elimina el userinfo** (`usuario@`/`usuario:contraseña@`). Chrome
 *   despoja esa parte antes de ejecutar la navegación real (protección
 *   nativa contra el truco de phishing "usuario@host") — si no se
 *   descartara acá también, la URL "antes de navegar" y la que
 *   `webNavigation` reporta después nunca calzarían.
 * - **elimina el hash**: no viaja al servidor y no debería poder romper
 *   la comparación.
 *
 * El pathname y el query string se preservan tal cual: sí distinguen
 * páginas genuinamente distintas dentro del mismo dominio — esto NO es
 * una excepción por dominio completo.
 */
export function normalizeNavigationUrl(rawUrl: string): string {
  const url = new URL(rawUrl)
  url.username = ''
  url.password = ''
  url.hash = ''
  return url.toString()
}
