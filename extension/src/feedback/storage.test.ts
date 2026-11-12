import { beforeEach, describe, expect, it } from 'vitest'
import type { FeedbackEntry } from './types'
import { readFeedbackEntries, writeFeedbackEntries } from './storage'

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

describe('feedback/storage', () => {
  it('sin nada guardado, devuelve un array vacío', async () => {
    expect(await readFeedbackEntries()).toEqual([])
  })

  it('persiste y relee correctamente', async () => {
    const entries: FeedbackEntry[] = [
      {
        id: '1',
        url: 'https://example.com/',
        hostname: 'example.com',
        reportedAt: new Date().toISOString(),
        feedbackType: 'false-positive',
        originalRiskLevel: 'high',
        finalScore: 83,
        ruleScore: 75,
        mlProbability: 0.87,
        activatedRuleIds: ['punycode'],
      },
    ]

    await writeFeedbackEntries(entries)

    expect(await readFeedbackEntries()).toEqual(entries)
  })

  it('ignora datos corruptos (no un array) en vez de romper', async () => {
    installLocalStorageStub()
    ;(globalThis as unknown as { chrome: unknown }).chrome = {
      storage: { local: { get: async () => ({ 'phishguard:feedback': 'no es un array' }) } },
    }

    expect(await readFeedbackEntries()).toEqual([])
  })
})
