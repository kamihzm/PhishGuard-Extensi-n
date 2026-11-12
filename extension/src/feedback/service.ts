import type { FeedbackEntry, FeedbackInput } from './types'
import { readFeedbackEntries, writeFeedbackEntries } from './storage'

export const FEEDBACK_LIMIT = 200
export const FEEDBACK_DEDUPE_WINDOW_MS = 10_000

/**
 * Guarda un reporte del usuario. Es puramente una escritura de datos: no
 * llama a `decide()`, no toca `rules/`, `ml/` ni `agent/combine.ts` — el
 * `Decision` original llega ya calculado en `input` y se guarda tal cual,
 * como constancia de lo que el usuario vio en ese momento.
 *
 * Si la MISMA url + mismo `feedbackType` ya tiene un reporte reciente
 * (dentro de `FEEDBACK_DEDUPE_WINDOW_MS`), se actualiza esa entrada en vez
 * de crear una nueva — evita duplicados por clics repetidos.
 */
export async function reportFeedback(input: FeedbackInput): Promise<FeedbackEntry> {
  const entries = await readFeedbackEntries()
  const now = Date.now()

  const duplicateIndex = entries.findIndex(
    (entry) =>
      entry.url === input.url &&
      entry.feedbackType === input.feedbackType &&
      now - new Date(entry.reportedAt).getTime() <= FEEDBACK_DEDUPE_WINDOW_MS,
  )

  const entry: FeedbackEntry = {
    id: duplicateIndex === -1 ? crypto.randomUUID() : entries[duplicateIndex]!.id,
    url: input.url,
    hostname: new URL(input.url).hostname,
    reportedAt: new Date(now).toISOString(),
    feedbackType: input.feedbackType,
    originalRiskLevel: input.originalRiskLevel,
    finalScore: input.finalScore,
    ruleScore: input.ruleScore,
    mlProbability: input.mlProbability,
    activatedRuleIds: input.activatedRuleIds,
  }

  const withoutDuplicate =
    duplicateIndex === -1 ? entries : entries.filter((_, i) => i !== duplicateIndex)
  const updated = [entry, ...withoutDuplicate].slice(0, FEEDBACK_LIMIT)

  await writeFeedbackEntries(updated)
  return entry
}

/** Más reciente primero. */
export async function getFeedback(): Promise<FeedbackEntry[]> {
  return readFeedbackEntries()
}

export async function deleteFeedbackEntry(id: string): Promise<void> {
  const entries = await readFeedbackEntries()
  await writeFeedbackEntries(entries.filter((entry) => entry.id !== id))
}

export async function clearFeedback(): Promise<void> {
  await writeFeedbackEntries([])
}
