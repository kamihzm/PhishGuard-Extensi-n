/**
 * Content scripts de la capa de página, tal como se declaran en el
 * manifest. Estáticos (sin permiso `scripting`):
 *
 * - `pageLayer.iife.ts` (mundo aislado, http/https, solo marco principal):
 *   motor + adaptadores + hoja cosmética. No pide permisos nuevos: el
 *   acceso a páginas ya lo da `host_permissions: <all_urls>`.
 * - `youtubeMain.iife.ts` (mundo MAIN, solo www.youtube.com): tiene que
 *   ejecutarse ANTES que el script en línea de YouTube para interceptar
 *   `ytInitialPlayerResponse` y `fetch`. Un content script estático con
 *   `run_at: document_start` lo garantiza; `chrome.scripting` no aporta
 *   nada aquí y no se solicita.
 *
 * Los archivos `*.iife.ts` los empaqueta CRXJS como IIFE síncrono (sin
 * cargador `import()` asíncrono), lo que preserva el orden de ejecución.
 * Los match patterns deben coincidir con los de cada adaptador (lo
 * verifica `webProtection/manifest.test.ts`).
 */
export const PAGE_LAYER_SCRIPT = 'src/webProtection/page/entries/pageLayer.iife.ts'
export const YOUTUBE_MAIN_SCRIPT = 'src/webProtection/page/entries/youtubeMain.iife.ts'

export const PAGE_LAYER_MATCHES = ['http://*/*', 'https://*/*']
export const YOUTUBE_MAIN_MATCHES = ['https://www.youtube.com/*']

export const PAGE_LAYER_CONTENT_SCRIPTS = [
  {
    matches: PAGE_LAYER_MATCHES,
    js: [PAGE_LAYER_SCRIPT],
    run_at: 'document_start' as const,
    all_frames: false,
  },
  {
    matches: YOUTUBE_MAIN_MATCHES,
    js: [YOUTUBE_MAIN_SCRIPT],
    run_at: 'document_start' as const,
    all_frames: false,
    world: 'MAIN' as const,
  },
]
