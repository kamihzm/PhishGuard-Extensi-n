import { collectBadfilterKeys, isBadfilterDirective, isCancelledByBadfilter } from './badfilter'
import {
  cosmeticKindOf,
  isPreprocessorBlockEnd,
  isPreprocessorBlockStart,
  isPreprocessorDirective,
  parseLine,
} from './parseLine'
import { toDnrRule } from './toDnrRule'
import type { CompileReport, DeferredCosmeticKind, DnrRule, ListCategory } from './types'
import { dnrRuleProblem } from './validateDnrRule'

export interface CompileOptions {
  listId: string
  category: ListCategory
}

export interface CompileResult {
  rules: DnrRule[]
  report: CompileReport
}

type Bucket =
  | { kind: 'comment' }
  | { kind: 'rejected'; reason: string }
  | { kind: 'deferred'; cosmeticKind: DeferredCosmeticKind }
  | { kind: 'badfilter-directive' }
  | { kind: 'network-candidate'; line: string }

function isCommentLine(line: string): boolean {
  return line === '' || line.startsWith('!') || (line.startsWith('[') && line.endsWith(']'))
}

/**
 * Compila el texto de UNA lista a reglas DNR, aplicando una línea válida →
 * como máximo una regla equivalente. No fusiona reglas distintas (§4.4):
 * solo elimina reglas DNR textualmente idénticas y las cuenta. Toda línea
 * queda contabilizada en exactamente una clase del reporte.
 */
export function compileList(text: string, options: CompileOptions): CompileResult {
  const lines = text.split(/\r?\n/)
  if (lines.length > 0 && lines.at(-1) === '') lines.pop()

  // Paso 1: clasificación que necesita contexto de lista (preprocesador,
  // comentarios, cosméticos, directivas `$badfilter`).
  const buckets: Bucket[] = []
  let preprocessorDepth = 0
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (isPreprocessorDirective(line)) {
      if (isPreprocessorBlockStart(line)) preprocessorDepth++
      else if (isPreprocessorBlockEnd(line)) preprocessorDepth = Math.max(0, preprocessorDepth - 1)
      buckets.push({ kind: 'rejected', reason: 'preprocessor-directive' })
      continue
    }
    if (isCommentLine(line)) {
      buckets.push({ kind: 'comment' })
      continue
    }
    if (preprocessorDepth > 0) {
      buckets.push({ kind: 'rejected', reason: 'preprocessor-block' })
      continue
    }
    const cosmeticKind = cosmeticKindOf(line)
    if (cosmeticKind) {
      buckets.push({ kind: 'deferred', cosmeticKind })
      continue
    }
    buckets.push(
      isBadfilterDirective(line)
        ? { kind: 'badfilter-directive' }
        : { kind: 'network-candidate', line },
    )
  }
  const badfilterKeys = collectBadfilterKeys(
    lines
      .map((line) => line.trim())
      .filter((_line, i) => buckets[i]!.kind === 'badfilter-directive'),
  )

  // Paso 2: parseo, transformación y validación de cada filtro de red.
  const report: CompileReport = {
    listId: options.listId,
    category: options.category,
    totalLines: lines.length,
    comments: 0,
    badfilterDirectives: 0,
    badfilterCancelled: 0,
    rejected: {},
    rejectedTotal: 0,
    deferredCosmetic: {},
    deferredCosmeticTotal: 0,
    accepted: 0,
    acceptedExceptions: 0,
    duplicatesRemoved: 0,
    dnrRules: 0,
    check: { sumsToTotal: false },
  }
  const addRejected = (reason: string) => {
    report.rejected[reason] = (report.rejected[reason] ?? 0) + 1
    report.rejectedTotal++
  }

  const rules: DnrRule[] = []
  const emitted = new Set<string>()
  for (const bucket of buckets) {
    switch (bucket.kind) {
      case 'comment':
        report.comments++
        continue
      case 'rejected':
        addRejected(bucket.reason)
        continue
      case 'deferred':
        report.deferredCosmetic[bucket.cosmeticKind] =
          (report.deferredCosmetic[bucket.cosmeticKind] ?? 0) + 1
        report.deferredCosmeticTotal++
        continue
      case 'badfilter-directive':
        report.badfilterDirectives++
        continue
      case 'network-candidate': {
        if (isCancelledByBadfilter(bucket.line, badfilterKeys)) {
          report.badfilterCancelled++
          continue
        }
        const result = parseLine(bucket.line)
        if (result.kind === 'rejected') {
          addRejected(result.reason)
          continue
        }
        if (result.kind !== 'network') {
          // parseLine y el paso 1 comparten los mismos criterios; esto no debería ocurrir.
          addRejected('internal-classification-mismatch')
          continue
        }
        const rule = toDnrRule(result.filter)
        const problem = dnrRuleProblem(rule)
        if (problem) {
          addRejected(`dnr-invalid:${problem}`)
          continue
        }
        report.accepted++
        if (result.filter.isException) report.acceptedExceptions++
        const key = JSON.stringify(rule)
        if (emitted.has(key)) {
          report.duplicatesRemoved++
          continue
        }
        emitted.add(key)
        rules.push({ ...rule, id: rules.length + 1 })
      }
    }
  }

  report.dnrRules = rules.length
  report.rejected = Object.fromEntries(
    Object.entries(report.rejected).sort(([a], [b]) => a.localeCompare(b)),
  )
  report.check.sumsToTotal =
    report.comments +
      report.badfilterDirectives +
      report.badfilterCancelled +
      report.rejectedTotal +
      report.deferredCosmeticTotal +
      report.accepted ===
      report.totalLines && report.accepted === report.dnrRules + report.duplicatesRemoved
  return { rules, report }
}
