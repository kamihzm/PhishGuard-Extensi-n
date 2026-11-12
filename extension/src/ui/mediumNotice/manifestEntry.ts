/**
 * Content script del aviso de nivel medio, tal como se declara en el
 * manifest (lo verifica `webProtection/manifest.test.ts`). No pide permisos
 * nuevos: el acceso a páginas http/https ya lo da `host_permissions:
 * <all_urls>`. Mundo aislado, solo marco principal y `document_idle`: no
 * necesita adelantarse a la página y así no retrasa su carga.
 */
export const MEDIUM_NOTICE_SCRIPT = 'src/ui/mediumNotice/mediumNotice.iife.ts'

export const MEDIUM_NOTICE_CONTENT_SCRIPT = {
  matches: ['http://*/*', 'https://*/*'],
  js: [MEDIUM_NOTICE_SCRIPT],
  run_at: 'document_idle' as const,
  all_frames: false,
}
