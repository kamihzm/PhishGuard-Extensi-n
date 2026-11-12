/**
 * Lista LOCAL de dominios legítimos frecuentemente suplantados por
 * phishing (typosquatting/lookalike/domain impersonation).
 *
 * IMPORTANTE — esto es CONOCIMIENTO EXPERTO curado a mano, NO un modelo de
 * Machine Learning ni una lista entrenada con datos: es exactamente el
 * mismo tipo de artefacto que `shared/constants.ts` (`SUSPICIOUS_TLDS`,
 * `SENSITIVE_WORDS`) — una base de conocimiento fija que un analista de
 * seguridad reconocería y podría auditar línea por línea. No se descarga,
 * no se genera automáticamente, y deliberadamente es pequeña (no una lista
 * exhaustiva de "los 10.000 dominios más visitados") para que cada entrada
 * tenga una razón concreta de estar acá: son marcas con historial conocido
 * de campañas de phishing dirigidas.
 *
 * Todos los dominios están en minúsculas y son el dominio REGISTRABLE
 * exacto (sin `www.`, sin protocolo, sin path) — `detectImpersonation.ts`
 * compara contra esta forma exacta.
 */
export const REFERENCE_DOMAINS: readonly string[] = [
  // --- Internacionales, suplantación frecuente y documentada ---
  'google.com',
  'microsoft.com',
  'paypal.com',
  'apple.com',
  'amazon.com',
  'facebook.com',
  'instagram.com',
  'netflix.com',

  // --- Relevantes para Colombia (contexto del proyecto) ---
  'bancolombia.com',
  'davivienda.com',
  'bbva.com.co',
  'nequi.com.co',
  'pse.com.co',

  /**
   * Entidades bancarias/gubernamentales/logísticas colombianas agregadas
   * tras auditar el proyecto de referencia `Seguridad-master` (objetivos
   * de phishing reales y documentados en Colombia: DIAN por declaración de
   * renta, paqueterías por "entrega pendiente", bancos digitales). Cada
   * dominio se verificó EMPÍRICAMENTE antes de agregarse — 0 falsos
   * positivos nuevos sobre 381 dominios legítimos reales del dataset y
   * 10/10 recall sobre typosquats sintéticos — ver
   * `docs/reference-audit-seguridad-master.md`.
   *
   * `bancoagrario.com.co` (NO `.gov.co`, a pesar de que el proyecto de
   * referencia lo listaba así): se corrigió tras encontrar que el dominio
   * `.gov.co` colisionaba con el dominio LEGÍTIMO real del dataset
   * (`bancoagrario.com.co`, score 0.895) — copiar la lista del proyecto de
   * referencia sin verificar habría introducido un falso positivo real.
   */
  'dian.gov.co',
  'servientrega.com',
  'bancoagrario.com.co',
  'bancodebogota.com',
  'runt.gov.co',
  'coordinadora.com',
  'interrapidisimo.com',
  'daviplata.com',
  'lulobank.com',
  'nu.com.co',
]
