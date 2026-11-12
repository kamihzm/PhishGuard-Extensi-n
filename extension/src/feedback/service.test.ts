import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeedbackInput } from './types'
import {
  clearFeedback,
  deleteFeedbackEntry,
  FEEDBACK_LIMIT,
  getFeedback,
  reportFeedback,
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
  vi.useRealTimers()
})

function falsePositiveInput(overrides: Partial<FeedbackInput> = {}): FeedbackInput {
  return {
    url: 'https://legit-bank.com/login',
    feedbackType: 'false-positive',
    originalRiskLevel: 'high',
    finalScore: 83,
    ruleScore: 75,
    mlProbability: 0.87,
    activatedRuleIds: ['punycode'],
    ...overrides,
  }
}

function missedRiskInput(overrides: Partial<FeedbackInput> = {}): FeedbackInput {
  return {
    url: 'https://suspicious-example.com/',
    feedbackType: 'missed-risk',
    originalRiskLevel: 'low',
    finalScore: 18,
    ruleScore: 10,
    mlProbability: 0.15,
    activatedRuleIds: [],
    ...overrides,
  }
}

describe('feedback/service', () => {
  it('guarda un reporte false-positive con los datos del Decision original', async () => {
    const entry = await reportFeedback(falsePositiveInput())

    expect(entry.feedbackType).toBe('false-positive')
    expect(entry.hostname).toBe('legit-bank.com')
    expect(entry.originalRiskLevel).toBe('high')
    expect(entry.finalScore).toBe(83)
    expect(entry.id).toBeTruthy()
    expect(entry.reportedAt).toBeTruthy()
  })

  it('guarda un reporte missed-risk con los datos del Decision original', async () => {
    const entry = await reportFeedback(missedRiskInput())

    expect(entry.feedbackType).toBe('missed-risk')
    expect(entry.hostname).toBe('suspicious-example.com')
    expect(entry.originalRiskLevel).toBe('low')
  })

  it('deduplicación: la misma URL + mismo tipo en pocos segundos actualiza la entrada existente en vez de crear otra', async () => {
    await reportFeedback(falsePositiveInput())
    await reportFeedback(falsePositiveInput())

    expect(await getFeedback()).toHaveLength(1)
  })

  it('la misma URL con distinto feedbackType SÍ genera dos entradas', async () => {
    await reportFeedback(falsePositiveInput({ url: 'https://a.com/' }))
    await reportFeedback(missedRiskInput({ url: 'https://a.com/' }))

    expect(await getFeedback()).toHaveLength(2)
  })

  it(`respeta el límite de ${FEEDBACK_LIMIT} reportes, descartando los más antiguos`, async () => {
    for (let i = 0; i < FEEDBACK_LIMIT + 5; i++) {
      await reportFeedback(falsePositiveInput({ url: `https://sitio-${i}.com/` }))
    }

    const entries = await getFeedback()
    expect(entries).toHaveLength(FEEDBACK_LIMIT)
    expect(entries[0]!.url).toBe(`https://sitio-${FEEDBACK_LIMIT + 4}.com/`) // el más reciente queda primero
  })

  it('borra un reporte puntual por id', async () => {
    const a = await reportFeedback(falsePositiveInput({ url: 'https://a.com/' }))
    await reportFeedback(missedRiskInput({ url: 'https://b.com/' }))

    await deleteFeedbackEntry(a.id)

    const entries = await getFeedback()
    expect(entries).toHaveLength(1)
    expect(entries[0]!.hostname).toBe('b.com')
  })

  it('borra todos los reportes', async () => {
    await reportFeedback(falsePositiveInput({ url: 'https://a.com/' }))
    await reportFeedback(missedRiskInput({ url: 'https://b.com/' }))

    await clearFeedback()

    expect(await getFeedback()).toEqual([])
  })

  it('persiste correctamente en chrome.storage.local (se puede releer con getFeedback)', async () => {
    await reportFeedback(falsePositiveInput())
    await reportFeedback(missedRiskInput())

    expect(await getFeedback()).toHaveLength(2)
  })
})

describe('reportFeedback no modifica la clasificación de la IA', () => {
  it('el mismo Decision (finalScore/ruleScore/mlProbability/riskLevel) permanece igual antes y después de reportar', async () => {
    const input = falsePositiveInput()

    const { decide } = await import('../agent/orchestrator')
    const before = decide(input.url)
    await reportFeedback(input)
    const after = decide(input.url)

    expect(after).toEqual(before)
  })
})
