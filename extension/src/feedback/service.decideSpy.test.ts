import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reportFeedback } from './service'

const { decideMock } = vi.hoisted(() => ({ decideMock: vi.fn() }))
vi.mock('../agent/orchestrator', () => ({ decide: decideMock }))

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
  decideMock.mockReset()
})

describe('reportFeedback nunca ejecuta el modelo', () => {
  it('guardar un reporte (false-positive o missed-risk) no invoca decide() en ningún momento', async () => {
    await reportFeedback({
      url: 'https://legit-bank.com/login',
      feedbackType: 'false-positive',
      originalRiskLevel: 'high',
      finalScore: 83,
      ruleScore: 75,
      mlProbability: 0.87,
      activatedRuleIds: ['punycode'],
    })

    await reportFeedback({
      url: 'https://suspicious-example.com/',
      feedbackType: 'missed-risk',
      originalRiskLevel: 'low',
      finalScore: 18,
      ruleScore: 10,
      mlProbability: 0.15,
      activatedRuleIds: [],
    })

    expect(decideMock).not.toHaveBeenCalled()
  })
})
