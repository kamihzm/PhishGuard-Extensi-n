import type { WebProtectionSettings } from '../settings'
import { createHider, safeCosmeticSelectors, type Hider } from './hider'
import type { AdapterHandle, PageAdapter, PageLogger } from './types'

/**
 * Motor de la capa de página (mundo aislado, marco principal).
 *
 * - Solo actúa con "Anuncios" activo; al desactivarlo deshace todo en
 *   caliente (adaptadores y hoja cosmética), sin recargar la página.
 * - Cada adaptador corre aislado: si su `start()` o su `stop()` lanza, se
 *   deshace solo lo suyo y el resto sigue (fail-open por adaptador).
 * - Si no se puede leer la configuración, no se hace nada (fail-open).
 * - Los selectores cosméticos los entrega el background según el hostname
 *   que ve Chrome; aquí se validan otra vez con el propio motor CSS.
 */
export interface PageLayerDeps {
  document: Document
  window: Window & typeof globalThis
  hostname: string
  readSettings(): Promise<WebProtectionSettings>
  /** Suscribe a cambios de configuración; devuelve la función para desuscribir. */
  subscribeSettings(onChange: (settings: WebProtectionSettings) => void): () => void
  /** Selectores cosméticos para esta página, o `null` si no hay/no se pudieron obtener. */
  requestCosmetic(): Promise<string[] | null>
  adapters: readonly PageAdapter[]
  log: PageLogger
}

export interface PageLayer {
  /** Desactiva todo y quita listeners (teardown completo). */
  stop(): void
  isActive(): boolean
  runningAdapters(): string[]
  hider(): Hider
}

export function startPageLayer(deps: PageLayerDeps): PageLayer {
  const { document: doc, window: win, log } = deps
  const hider = createHider(doc)
  const handles = new Map<string, AdapterHandle>()
  let active = false
  let stopped = false
  let generation = 0
  let cosmetic: string[] = []

  const applicable = deps.adapters.filter((adapter) => {
    try {
      return adapter.appliesTo(deps.hostname)
    } catch {
      return false
    }
  })

  const stopAdapter = (id: string) => {
    const handle = handles.get(id)
    handles.delete(id)
    try {
      handle?.stop()
    } catch {
      log('adapter:stop-error', { adapter: id })
    }
    hider.restoreOwner(id)
  }

  const applyCosmetic = () => {
    hider.setCosmeticSelectors(safeCosmeticSelectors(doc, cosmetic))
  }
  // En document_start aún no existen <body>/<main>: al terminar el parseo se
  // revalida que ningún selector los seleccione.
  const onDomReady = () => {
    if (active && cosmetic.length > 0) applyCosmetic()
  }

  const activate = () => {
    if (active || stopped) return
    active = true
    const current = ++generation
    for (const adapter of applicable) {
      try {
        handles.set(adapter.id, adapter.start({ document: doc, window: win, hider, log }))
      } catch {
        log('adapter:start-error', { adapter: adapter.id })
        stopAdapter(adapter.id)
      }
    }
    deps
      .requestCosmetic()
      .then((selectors) => {
        if (!active || current !== generation || !selectors || selectors.length === 0) return
        cosmetic = selectors
        applyCosmetic()
        log('cosmetic:applied', { selectors: selectors.length })
      })
      .catch(() => log('cosmetic:unavailable'))
  }

  const deactivate = () => {
    if (!active) return
    active = false
    generation++
    for (const id of [...handles.keys()]) stopAdapter(id)
    cosmetic = []
    hider.restoreAll()
  }

  const announceInactive = () => {
    for (const adapter of applicable) {
      try {
        adapter.announceInactive?.()
      } catch {
        log('adapter:inactive-error', { adapter: adapter.id })
      }
    }
  }

  const apply = (settings: WebProtectionSettings) => {
    if (settings.adsEnabled) activate()
    else if (active) deactivate()
    else announceInactive()
  }

  let unsubscribe: (() => void) | null = null
  const onPageHide = (event: PageTransitionEvent) => {
    // Si la página entra al bfcache puede volver tal cual: se conserva.
    if (!event.persisted) layer.stop()
  }

  const layer: PageLayer = {
    stop() {
      if (stopped) return
      deactivate()
      stopped = true
      unsubscribe?.()
      unsubscribe = null
      win.removeEventListener('pagehide', onPageHide)
      doc.removeEventListener('DOMContentLoaded', onDomReady)
    },
    isActive: () => active,
    runningAdapters: () => [...handles.keys()],
    hider: () => hider,
  }

  win.addEventListener('pagehide', onPageHide)
  doc.addEventListener('DOMContentLoaded', onDomReady)
  try {
    unsubscribe = deps.subscribeSettings((settings) => {
      if (!stopped) apply(settings)
    })
  } catch {
    log('settings:subscribe-error')
  }
  deps
    .readSettings()
    .then((settings) => {
      if (!stopped) apply(settings)
    })
    .catch(() => log('settings:unreadable'))

  return layer
}
