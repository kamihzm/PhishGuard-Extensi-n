import { watchDom } from '../../domWatcher'
import { isHostOrSubdomain, type PageAdapter } from '../../types'
import { detectJkanimeAds } from './detect'

export const JKANIME_ADAPTER_ID = 'jkanime'

/**
 * Adaptador de JKanime (mundo aislado). Oculta, de forma reversible, solo
 * lo que `detectJkanimeAds` identifica con evidencia suficiente. No toca
 * el reproductor, la búsqueda, los menús ni los enlaces del sitio, no
 * aplica `pointer-events` globales y no elimina nodos.
 */
export const jkanimeAdapter: PageAdapter = {
  id: JKANIME_ADAPTER_ID,
  matches: ['https://jkanime.net/*', 'https://*.jkanime.net/*'],
  appliesTo: (hostname) => isHostOrSubdomain(hostname, 'jkanime.net'),
  start({ document: doc, window: win, hider, log }) {
    let watcher: { stop(): void } | null = null
    const stop = () => {
      watcher?.stop()
      watcher = null
      hider.restoreOwner(JKANIME_ADAPTER_ID)
    }
    const scan = () => {
      try {
        let hidden = 0
        for (const { element } of detectJkanimeAds(doc, win)) {
          if (hider.hide(element, JKANIME_ADAPTER_ID)) hidden++
        }
        if (hidden > 0) log('jkanime:hidden', { count: hidden })
      } catch {
        // Estado indeterminado: se deshace todo lo de este adaptador (fail-open).
        log('jkanime:scan-error')
        stop()
      }
    }
    watcher = watchDom({
      root: doc.documentElement,
      window: win,
      scan,
      isOwnNode: hider.isOwnNode,
    })
    scan()
    return { stop }
  },
}
