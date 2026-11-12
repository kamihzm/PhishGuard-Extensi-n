import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json' with { type: 'json' }
import rulesetIndex from './src/webProtection/generated/rulesetIndex.json' with { type: 'json' }

export default defineManifest({
  manifest_version: 3,
  name: 'PhishGuard',
  description:
    'Detecta posibles sitios de phishing analizando la URL visitada, con reglas explicables y un modelo de Machine Learning.',
  version: pkg.version,
  action: {
    default_popup: 'src/ui/popup/popup.html',
    default_title: 'PhishGuard',
  },
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  // `declarativeNetRequest`: exclusivo de Web Protection (anuncios y
  // rastreadores). Aplica los rulesets estáticos de abajo y permite
  // habilitarlos/deshabilitarlos y consultar la cuota. No da acceso al
  // contenido de las páginas ni a las URLs visitadas.
  //
  // `webRequest` (Popup Guard, solo OBSERVACIÓN de `main_frame`; sin
  // `webRequestBlocking`): las ventanas publicitarias pasan por redirecciones
  // de SERVIDOR (302/307) hacia redes listadas en EasyList, y `webNavigation`
  // no reporta esos saltos intermedios. Sin este permiso esa evidencia se
  // pierde. El acceso a hosts ya lo da `<all_urls>`. `tabs.remove`,
  // `tabs.goBack` y `tabs.sendMessage` no requieren el permiso `tabs`.
  permissions: ['webNavigation', 'storage', 'declarativeNetRequest', 'webRequest'],
  // Web Protection: rulesets estáticos generados por `npm run wp:compile`
  // (EasyList/EasyPrivacy, ver tools/webProtection/PROVENANCE.md). TODOS se
  // declaran deshabilitados: no se bloquea nada hasta que el gestor de cuota
  // del background los habilita según los toggles guardados. Si el background
  // falla, el estado queda abierto (fail-open), nunca bloqueando.
  declarative_net_request: {
    rule_resources: rulesetIndex.rulesets.map((ruleset) => ({
      id: ruleset.id,
      enabled: false,
      path: ruleset.path,
    })),
  },
  // Web Protection, capa de página (ver src/webProtection/page/manifestEntries.ts):
  // content scripts ESTÁTICOS, sin permiso `scripting`. Solo ocultan
  // anuncios (con "Anuncios" activo) y, en www.youtube.com, un script del
  // mundo MAIN quita los datos publicitarios de las respuestas del
  // reproductor. El motor de phishing sigue sin leer ni modificar el DOM.
  // Deben coincidir con src/webProtection/page/manifestEntries.ts (lo verifica
  // webProtection/manifest.test.ts).
  content_scripts: [
    {
      matches: ['http://*/*', 'https://*/*'],
      js: ['src/webProtection/page/entries/pageLayer.iife.ts'],
      run_at: 'document_start',
      all_frames: false,
    },
    {
      matches: ['https://www.youtube.com/*'],
      js: ['src/webProtection/page/entries/youtubeMain.iife.ts'],
      run_at: 'document_start',
      all_frames: false,
      world: 'MAIN',
    },
    // Aviso de nivel medio dentro de la página (src/ui/mediumNotice): Shadow
    // DOM cerrado, sin permisos nuevos. Debe coincidir con
    // src/ui/mediumNotice/manifestEntry.ts.
    {
      matches: ['http://*/*', 'https://*/*'],
      js: ['src/ui/mediumNotice/mediumNotice.iife.ts'],
      run_at: 'document_idle',
      all_frames: false,
    },
  ],
  // `<all_urls>`: necesario para que `chrome.tabs.get`/`chrome.tabs.query`
  // devuelvan el campo `url` de la pestaña (usado por `navigationGate.ts`
  // para calcular `safeReturnUrl` y por `popup.ts` para analizar la
  // pestaña activa) — sin este permiso Chrome oculta `tab.url` en
  // pestañas que no sean la que disparó la llamada. También cubre los
  // content scripts de la capa de página de Web Protection (no se añade
  // ningún permiso de host nuevo).
  host_permissions: ['<all_urls>'],
  web_accessible_resources: [
    {
      resources: ['src/ui/warning/warning.html'],
      matches: ['<all_urls>'],
    },
  ],
})
