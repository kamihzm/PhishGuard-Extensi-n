import { DEFAULT_SETTINGS } from './defaults'
import { readSettings, writeSettings } from './storage'
import type { Settings } from './types'

export async function getSettings(): Promise<Settings> {
  return readSettings()
}

export async function updateSetting<K extends keyof Settings>(
  key: K,
  value: Settings[K],
): Promise<Settings> {
  const current = await readSettings()
  const next = { ...current, [key]: value }
  await writeSettings(next)
  return next
}

/** Restaura los toggles a sus defaults — nunca toca historial ni sitios confiables, que viven en su propio storage. */
export async function resetSettings(): Promise<Settings> {
  const defaults = { ...DEFAULT_SETTINGS }
  await writeSettings(defaults)
  return defaults
}
