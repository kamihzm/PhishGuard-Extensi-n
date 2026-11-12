import type { AnalysisInput, HistoryEntry } from './types'
import { readHistoryEntries, writeHistoryEntries } from './storage'

export const HISTORY_LIMIT = 200
export const DEDUPE_WINDOW_MS = 10_000

/**
 * Registra un análisis. Si la MISMA URL exacta ya tiene una entrada
 * reciente (dentro de `DEDUPE_WINDOW_MS`), se actualiza esa entrada en vez
 * de crear una nueva — evita duplicados excesivos por recargas o eventos
 * de navegación repetidos para la misma URL. El orden es siempre más
 * reciente primero; al superar `HISTORY_LIMIT` se descartan las más
 * antiguas.
 */
export async function recordAnalysis(input: AnalysisInput): Promise<HistoryEntry> {
  const entries = await readHistoryEntries()
  const now = Date.now()

  const duplicateIndex = entries.findIndex(
    (entry) =>
      entry.url === input.url && now - new Date(entry.analyzedAt).getTime() <= DEDUPE_WINDOW_MS,
  )

  const entry: HistoryEntry = {
    id: duplicateIndex === -1 ? crypto.randomUUID() : entries[duplicateIndex]!.id,
    url: input.url,
    hostname: new URL(input.url).hostname,
    analyzedAt: new Date(now).toISOString(),
    finalScore: input.finalScore,
    ruleScore: input.ruleScore,
    mlProbability: input.mlProbability,
    riskLevel: input.riskLevel,
    activatedRuleIds: input.activatedRuleIds,
  }

  const withoutDuplicate =
    duplicateIndex === -1 ? entries : entries.filter((_, i) => i !== duplicateIndex)
  const updated = [entry, ...withoutDuplicate].slice(0, HISTORY_LIMIT)

  await writeHistoryEntries(updated)
  return entry
}

/** Más reciente primero. */
export async function getHistory(): Promise<HistoryEntry[]> {
  return readHistoryEntries()
}

export async function deleteHistoryEntry(id: string): Promise<void> {
  const entries = await readHistoryEntries()
  await writeHistoryEntries(entries.filter((entry) => entry.id !== id))
}

export async function clearHistory(): Promise<void> {
  await writeHistoryEntries([])
}
