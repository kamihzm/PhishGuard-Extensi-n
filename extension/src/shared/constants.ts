/** TLDs baratos/gratuitos históricamente sobrerrepresentados en campañas de phishing. */
export const SUSPICIOUS_TLDS: readonly string[] = [
  'zip',
  'mov',
  'top',
  'xyz',
  'click',
  'work',
  'support',
  'country',
  'gq',
  'tk',
  'ml',
  'cf',
  'ga',
  'link',
  'loan',
  'win',
  'bid',
  'download',
]

/**
 * Sufijos públicos de dos etiquetas usados en Colombia (bancos, entidades de
 * gobierno, universidades). Sin esto, "banco.com.co" se contaría como si
 * tuviera un subdominio de más, porque "com" y "co" no forman un TLD de una
 * sola etiqueta como ".com" o ".top". No es una lista de sufijos públicos
 * completa (evitamos esa dependencia a propósito) — cubre el caso de Colombia,
 * que es el contexto que le importa a este proyecto.
 */
/**
 * 2026-10-01: la extensión ya NO usa esta lista (`features/urlParts.ts` usa la
 * sección ICANN de la PSL, `shared/publicSuffix.ts`). Se conserva solo para
 * `training/domainGrouping.ts`, que agrupa el split del dataset v2 y debe
 * seguir siendo reproducible byte a byte.
 */
export const COMPOUND_PUBLIC_SUFFIXES: readonly string[] = [
  'com.co',
  'net.co',
  'org.co',
  'edu.co',
  'gov.co',
  'mil.co',
  'nom.co',
]

/** Palabras que aparecen con frecuencia en URLs de phishing para generar urgencia o confianza falsa. */
export const SENSITIVE_WORDS: readonly string[] = [
  'login',
  'verificar',
  'banco',
  'token',
  'secure',
  'account',
]

export type SensitiveWordCategory = 'auth' | 'banking'

/**
 * Categoría semántica de cada palabra de `SENSITIVE_WORDS`, usada
 * ÚNICAMENTE para que la regla `sensitive-words` (`rules/rules.ts`)
 * explique QUÉ TIPO de término encontró ("autenticación" vs "servicios
 * financieros") en vez del genérico "palabra sensible" — no cambia el
 * conteo, el peso ni la condición de activación de la regla.
 *
 * Se evaluó ampliar `SENSITIVE_WORDS` con las categorías completas de
 * autenticación/banca/urgencia del proyecto de referencia
 * `Seguridad-master` (`training/analyzeContextualWords.ts`,
 * `docs/reference-audit-seguridad-master.md`) y se descartó: la categoría
 * "banca" resultó INVERSAMENTE correlacionada en el dataset actual (ej.
 * "banco" aparece en 18/565 URLs legítimas y 0/255 de phishing — palabras
 * bancarias identifican sitios bancarios REALES, no clones), y "urgencia"
 * no tuvo NINGÚN hit en phishing (0/255 en las 26 palabras candidatas,
 * coherente con que ese lenguaje vive en el CONTENIDO de la página, no en
 * la URL). Por eso esta categorización cubre solo las 6 palabras YA
 * vigentes, curadas con evidencia — no agrega vocabulario nuevo.
 */
export const SENSITIVE_WORD_CATEGORIES: Readonly<Record<string, readonly SensitiveWordCategory[]>> =
  {
    login: ['auth'],
    verificar: ['auth'],
    banco: ['banking'],
    token: ['auth'],
    secure: ['auth'],
    account: ['auth'],
  }

/**
 * Nombres de query params conocidos de tracking/atribución publicitaria
 * (UTM, redes de afiliados/ads, ids de click). Un parámetro de esta lista
 * NO implica phishing por sí solo — es una señal de que la URL viene de una
 * campaña de marketing/publicidad, tan común en sitios legítimos (Google
 * Ads, YouTube, e-commerce) como en redirecciones publicitarias abusivas.
 * Ver `docs/tracking-parameter-analysis.md` para la evaluación empírica que
 * decide si/cómo se usa esta señal. Comparación siempre en minúsculas
 * (`urlParts.ts`/quien consuma esta lista debe hacer `toLowerCase()` del
 * nombre del parámetro primero) — nunca por heurísticas como "nombre largo".
 */
export const TRACKING_PARAM_NAMES: readonly string[] = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'gclid',
  'fbclid',
  'msclkid',
  'clickid',
  'click_id',
  'voluum_clickid',
  'voluum_campaignid',
  'voluum_offerid',
  'affiliate',
  'aff_id',
  'campaign_id',
  'offer_id',
  'subid',
  'sub_id',
]

/**
 * Subconjunto de `TRACKING_PARAM_NAMES` que identifica específicamente un
 * click/red de afiliados (no solo atribución de campaña tipo UTM) — usado
 * para la feature candidata `hasClickTrackingId` (ver
 * `docs/tracking-parameter-analysis.md`).
 */
export const CLICK_TRACKING_PARAM_NAMES: readonly string[] = [
  'gclid',
  'fbclid',
  'msclkid',
  'clickid',
  'click_id',
  'voluum_clickid',
]

/**
 * Plataformas de hosting y servicios legítimos donde CUALQUIERA publica
 * contenido bajo un subdominio de la plataforma (2026-10-01, ver
 * `docs/ml-scope.md` y `docs/rules-reinforcement.md`). Estar en una de ellas
 * NO es señal de phishing por sí solo: solo sirve para que las reglas
 * candidatas `hosting-*` miren el SUBDOMINIO elegido por quien publicó.
 * Misma lista curada que `training/cleanDatasetV4.ts` (`HOSTING_PLATFORMS`),
 * sin la PSL completa (la extensión no la empaqueta).
 */
export const HOSTING_PLATFORMS: readonly string[] = [
  'pages.dev',
  'workers.dev',
  'r2.dev',
  'blogspot.com',
  'blogger.com',
  'netlify.app',
  'vercel.app',
  'github.io',
  'gitlab.io',
  'web.app',
  'firebaseapp.com',
  'appspot.com',
  'herokuapp.com',
  'glitch.me',
  'repl.co',
  'replit.app',
  'replit.dev',
  'onrender.com',
  'fly.dev',
  'azurewebsites.net',
  'azureedge.net',
  'cloudfront.net',
  'amazonaws.com',
  'weebly.com',
  'weeblysite.com',
  'wixsite.com',
  'wix.com',
  'wordpress.com',
  'godaddysites.com',
  'square.site',
  'squarespace.com',
  'webflow.io',
  'notion.site',
  'carrd.co',
  'mystrikingly.com',
  'jimdosite.com',
  'jimdofree.com',
  'site123.me',
  'gitbook.io',
  'surge.sh',
  '000webhostapp.com',
  'framer.website',
  'framer.app',
  'typedream.app',
  'translate.goog',
  'sharepoint.com',
  'canva.site',
  'duckdns.org',
  'ngrok.io',
  'ngrok-free.app',
  'trycloudflare.com',
  'dweb.link',
  'ipfs.io',
  'fleek.co',
  'webcindario.com',
  'yolasite.com',
  'ukit.me',
  'tilda.ws',
  'mailchimpsites.com',
  'hubspotpagebuilder.com',
  'plesk.page',
  'zapier.app',
  'b-cdn.net',
]

/** Acortadores de URL: el destino real no aparece en la URL (ver la regla informativa `url-shortener`). */
export const URL_SHORTENERS: readonly string[] = [
  'bit.ly',
  'tinyurl.com',
  't.co',
  'cutt.ly',
  'rb.gy',
  'is.gd',
  'v.gd',
  'shorturl.at',
  't.ly',
  'ow.ly',
  'buff.ly',
  'rebrand.ly',
  's.id',
  'goo.gl',
  'tiny.cc',
  'qrco.de',
  'u.to',
  'clck.ru',
  'short.gy',
  'bl.ink',
  'lnk.ink',
  '1url.at',
  'shorturl.gg',
  'urlz.fr',
  'surl.li',
  'x.gd',
]

/**
 * Palabras de acceso a cuentas que, ELEGIDAS como nombre de un subdominio de
 * plataforma (`instagramlogin-ejemplo.blogspot.com`), indican una página de
 * acceso falsa. Amplía `SENSITIVE_WORDS` solo para la regla candidata
 * `hosting-sensitive-subdomain`; no cambia `sensitive-words` ni el ML.
 */
export const HOSTING_SENSITIVE_WORDS: readonly string[] = [
  'login',
  'signin',
  'sign-in',
  'logon',
  'verify',
  'verificar',
  'verification',
  'account',
  'password',
  'wallet',
  'recover',
  'unlock',
  'secure',
  'auth',
  'webmail',
  'airdrop',
  'claim',
  'token',
  'banco',
]
