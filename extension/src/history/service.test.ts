import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnalysisInput } from './types'
import {
  clearHistory,
  deleteHistoryEntry,
  getHistory,
  HISTORY_LIMIT,
  recordAnalysis,
} from './service'

function installLocalStorageStub(): void {
  const data = new Map<string, unknown>()
  ;(globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: data.get(key) }),
        set: async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) data.set(k, v)
        },
      },
    },
  }
}

beforeEach(() => {
  installLocalStorageStub()
})

afterEach(() => {
  vi.useRealTimers()
})

function buildInput(overrides: Partial<AnalysisInput> = {}): AnalysisInput {
  return {
    url: 'https://example.com/',
    finalScore: 10,
    ruleScore: 0,
    mlProbability: 0.1,
    riskLevel: 'low',
    activatedRuleIds: [],
    ...overrides,
  }
}

describe('history/service', () => {
  it('guarda una entrada y se puede recuperar', async () => {
    const entry = await recordAnalysis(
      buildInput({ url: 'https://banco-falso.top/login', riskLevel: 'high', finalScore: 91 }),
    )

    const history = await getHistory()
    expect(history).toHaveLength(1)
    expect(history[0]).toEqual(entry)
    expect(history[0]!.hostname).toBe('banco-falso.top')
  })

  it('LOW se guarda correctamente', async () => {
    await recordAnalysis(buildInput({ riskLevel: 'low', finalScore: 8 }))
    const history = await getHistory()
    expect(history[0]!.riskLevel).toBe('low')
  })

  it('MEDIUM se guarda correctamente', async () => {
    await recordAnalysis(buildInput({ riskLevel: 'medium', finalScore: 40 }))
    const history = await getHistory()
    expect(history[0]!.riskLevel).toBe('medium')
  })

  it('HIGH se guarda correctamente', async () => {
    await recordAnalysis(
      buildInput({ riskLevel: 'high', finalScore: 90, activatedRuleIds: ['punycode'] }),
    )
    const history = await getHistory()
    expect(history[0]!.riskLevel).toBe('high')
    expect(history[0]!.activatedRuleIds).toEqual(['punycode'])
  })

  it('orden por fecha: la más reciente queda primero', async () => {
    await recordAnalysis(buildInput({ url: 'https://uno.com/' }))
    await recordAnalysis(buildInput({ url: 'https://dos.com/' }))
    await recordAnalysis(buildInput({ url: 'https://tres.com/' }))

    const history = await getHistory()
    expect(history.map((e) => e.hostname)).toEqual(['tres.com', 'dos.com', 'uno.com'])
  })

  it('límite de 200: al superarlo, se descartan las entradas más antiguas', async () => {
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) {
      await recordAnalysis(buildInput({ url: `https://sitio-${i}.com/` }))
    }

    const history = await getHistory()
    expect(history).toHaveLength(HISTORY_LIMIT)
    // las últimas 200 creadas (205..5), no las primeras 5 (0..4)
    expect(history[0]!.hostname).toBe('sitio-204.com')
    expect(history.some((e) => e.hostname === 'sitio-0.com')).toBe(false)
  })

  it('deduplicación: la misma URL exacta dentro de la ventana de 10s actualiza la entrada existente en vez de crear otra', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))

    const first = await recordAnalysis(buildInput({ url: 'https://example.com/', finalScore: 10 }))

    vi.setSystemTime(new Date('2026-01-01T00:00:05Z')) // +5s, dentro de la ventana de 10s
    const second = await recordAnalysis(buildInput({ url: 'https://example.com/', finalScore: 12 }))

    const history = await getHistory()
    expect(history).toHaveLength(1)
    expect(second.id).toBe(first.id) // se actualizó la misma entrada, no una nueva
    expect(history[0]!.finalScore).toBe(12)
  })

  it('fuera de la ventana de deduplicación, la misma URL sí crea una segunda entrada', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    await recordAnalysis(buildInput({ url: 'https://example.com/' }))

    vi.setSystemTime(new Date('2026-01-01T00:00:11Z')) // +11s, fuera de la ventana de 10s
    await recordAnalysis(buildInput({ url: 'https://example.com/' }))

    expect(await getHistory()).toHaveLength(2)
  })

  it('URLs distintas nunca se deduplican entre sí', async () => {
    await recordAnalysis(buildInput({ url: 'https://uno.com/' }))
    await recordAnalysis(buildInput({ url: 'https://dos.com/' }))

    expect(await getHistory()).toHaveLength(2)
  })

  it('borrar una entrada individual', async () => {
    const a = await recordAnalysis(buildInput({ url: 'https://uno.com/' }))
    await recordAnalysis(buildInput({ url: 'https://dos.com/' }))

    await deleteHistoryEntry(a.id)

    const history = await getHistory()
    expect(history).toHaveLength(1)
    expect(history[0]!.hostname).toBe('dos.com')
  })

  it('borrar todo el historial', async () => {
    await recordAnalysis(buildInput({ url: 'https://uno.com/' }))
    await recordAnalysis(buildInput({ url: 'https://dos.com/' }))

    await clearHistory()

    expect(await getHistory()).toEqual([])
  })
})
