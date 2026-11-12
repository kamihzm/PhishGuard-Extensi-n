import type { HistoryEntry } from './types'

/**
 * Acceso crudo a `chrome.storage.local` — nunca `chrome.storage.session`
 * (el historial debe sobrevivir a que se cierre el navegador) ni
 * `chrome.storage.sync` (nunca debe salir de este navegador). Todo el
 * historial vive bajo UNA sola clave, como un array — 200 registros chicos
 * están lejos del límite de `storage.local` (5MB por defecto).
 */
const HISTORY_STORAGE_KEY = 'phishguard:history'

export async function readHistoryEntries(): Promise<HistoryEntry[]> {
  const stored = await chrome.storage.local.get(HISTORY_STORAGE_KEY)
  const entries = stored[HISTORY_STORAGE_KEY]
  return Array.isArray(entries) ? (entries as HistoryEntry[]) : []
}

export async function writeHistoryEntries(entries: HistoryEntry[]): Promise<void> {
  await chrome.storage.local.set({ [HISTORY_STORAGE_KEY]: entries })
}
