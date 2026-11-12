import type { ListCategory } from './filters/types'

/**
 * Configuración de Web Protection. Vive en su PROPIA clave de
 * `chrome.storage.local`, separada de `phishguard:settings` (motor de
 * phishing): desactivar anuncios nunca desactiva el phishing, y al revés.
 */
export interface WebProtectionSettings {
  adsEnabled: boolean
  trackersEnabled: boolean
}

export const WEB_PROTECTION_SETTINGS_KEY = 'phishguard:webProtection'

/** Último resumen de reconciliación (`chrome.storage.session`): lo escribe el background y lo lee el popup. */
export const WEB_PROTECTION_STATUS_KEY = 'phishguard:webProtection:status'

export const DEFAULT_WEB_PROTECTION_SETTINGS: WebProtectionSettings = {
  adsEnabled: true,
  trackersEnabled: true,
}

/** Solo lo que realmente necesita esta clase de `chrome.storage.local`, para poder inyectarlo en tests. */
export interface KeyValueStorage {
  get(key: string): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
}

/**
 * Valida campo por campo (mismo criterio que `settings/storage.ts`): un
 * campo ausente o con un tipo incorrecto cae a su valor por defecto sin
 * descartar el resto.
 */
export function mergeWebProtectionSettings(stored: unknown): WebProtectionSettings {
  const merged = { ...DEFAULT_WEB_PROTECTION_SETTINGS }
  if (typeof stored !== 'object' || stored === null) return merged
  const raw = stored as Record<string, unknown>
  for (const key of Object.keys(
    DEFAULT_WEB_PROTECTION_SETTINGS,
  ) as (keyof WebProtectionSettings)[]) {
    if (typeof raw[key] === 'boolean') merged[key] = raw[key] as boolean
  }
  return merged
}

export async function readWebProtectionSettings(
  storage: KeyValueStorage,
): Promise<WebProtectionSettings> {
  const stored = await storage.get(WEB_PROTECTION_SETTINGS_KEY)
  return mergeWebProtectionSettings(stored[WEB_PROTECTION_SETTINGS_KEY])
}

export async function updateWebProtectionSetting(
  storage: KeyValueStorage,
  key: keyof WebProtectionSettings,
  value: boolean,
): Promise<WebProtectionSettings> {
  const next = { ...(await readWebProtectionSettings(storage)), [key]: value }
  await storage.set({ [WEB_PROTECTION_SETTINGS_KEY]: next })
  return next
}

/**
 * Experimentos de Web Protection (2026-10-05). Viven en su propia clave,
 * están DESACTIVADOS por defecto y no tienen interfaz: se activan escribiendo
 * la clave en `chrome.storage.local`, solo para medirlos antes de decidir.
 *
 * - `popupGuardTabCreated`: Popup Guard empieza a observar también desde
 *   `tabs.onCreated` (pestañas con opener). Algunos popunders abren
 *   `about:blank`, escriben su HTML y luego redirigen; para esas ventanas
 *   Chrome no emite `webNavigation.onCreatedNavigationTarget` (diagnóstico de
 *   animeyt.cc, 2026-10-04). Desde T6 (2026-10-15) las de una ventana
 *   `type: popup` se observan siempre, sin el experimento; el experimento solo
 *   amplía a cualquier pestaña con opener (incluidas las del menú contextual
 *   "Abrir en pestaña nueva", que no registran intención: por eso sigue apagado).
 */
export interface WebProtectionExperiments {
  popupGuardTabCreated: boolean
}

export const WEB_PROTECTION_EXPERIMENTS_KEY = 'phishguard:webProtection:experiments'

export const DEFAULT_WEB_PROTECTION_EXPERIMENTS: WebProtectionExperiments = {
  popupGuardTabCreated: false,
}

/** Mismo criterio que `mergeWebProtectionSettings`: lo ausente o inválido queda en su valor por defecto (desactivado). */
export function mergeWebProtectionExperiments(stored: unknown): WebProtectionExperiments {
  const merged = { ...DEFAULT_WEB_PROTECTION_EXPERIMENTS }
  if (typeof stored !== 'object' || stored === null) return merged
  const raw = stored as Record<string, unknown>
  for (const key of Object.keys(
    DEFAULT_WEB_PROTECTION_EXPERIMENTS,
  ) as (keyof WebProtectionExperiments)[]) {
    if (typeof raw[key] === 'boolean') merged[key] = raw[key] as boolean
  }
  return merged
}

/** Categorías de listas activas según la configuración. */
export function enabledCategoriesOf(settings: WebProtectionSettings): Set<ListCategory> {
  const categories = new Set<ListCategory>()
  if (settings.adsEnabled) categories.add('ads')
  if (settings.trackersEnabled) categories.add('trackers')
  return categories
}
