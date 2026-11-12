import { DEFAULT_SETTINGS } from './defaults'
import type { Settings } from './types'

export const SETTINGS_STORAGE_KEY = 'phishguard:settings'

/**
 * Valida campo por campo en vez de todo-o-nada: si `chrome.storage.local`
 * tiene datos parcialmente corruptos (un campo con el tipo equivocado, o
 * agregado en una versión anterior sin alguna clave nueva), cada clave
 * inválida o ausente cae a su default individualmente en vez de descartar
 * toda la configuración guardada.
 */
function mergeWithDefaults(stored: unknown): Settings {
  if (typeof stored !== 'object' || stored === null) {
    return { ...DEFAULT_SETTINGS }
  }

  const raw = stored as Record<string, unknown>
  const merged = { ...DEFAULT_SETTINGS }

  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    if (typeof raw[key] === 'boolean') {
      merged[key] = raw[key] as boolean
    }
  }

  return merged
}

export async function readSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(SETTINGS_STORAGE_KEY)
  return mergeWithDefaults(stored[SETTINGS_STORAGE_KEY])
}

export async function writeSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: settings })
}
