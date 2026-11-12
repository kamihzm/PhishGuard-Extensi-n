import type { FeedbackEntry } from './types'

/**
 * Acceso crudo a `chrome.storage.local` — mismo criterio que
 * `history/storage.ts`: una sola clave, todo el registro como un array,
 * nunca `storage.session` (debe sobrevivir a cerrar el navegador) ni
 * `storage.sync` (nunca debe salir de este navegador).
 */
const FEEDBACK_STORAGE_KEY = 'phishguard:feedback'

export async function readFeedbackEntries(): Promise<FeedbackEntry[]> {
  const stored = await chrome.storage.local.get(FEEDBACK_STORAGE_KEY)
  const entries = stored[FEEDBACK_STORAGE_KEY]
  return Array.isArray(entries) ? (entries as FeedbackEntry[]) : []
}

export async function writeFeedbackEntries(entries: FeedbackEntry[]): Promise<void> {
  await chrome.storage.local.set({ [FEEDBACK_STORAGE_KEY]: entries })
}
