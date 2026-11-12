import { beforeEach, describe, expect, it } from 'vitest'
import type { HistoryEntry } from './types'
import { readHistoryEntries, writeHistoryEntries } from './storage'

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

function buildEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: '1',
    url: 'https://example.com/',
    hostname: 'example.com',
    analyzedAt: new Date().toISOString(),
    finalScore: 10,
    ruleScore: 0,
    mlProbability: 0.1,
    riskLevel: 'low',
    activatedRuleIds: [],
    ...overrides,
  }
}

describe('history/storage', () => {
  it('16) sin nada guardado, devuelve un array vacío (no undefined ni una excepción)', async () => {
    expect(await readHistoryEntries()).toEqual([])
  })

  it('16) los datos persisten correctamente en chrome.storage.local: lo que se escribe se puede volver a leer', async () => {
    const entries = [buildEntry({ id: 'a' }), buildEntry({ id: 'b' })]

    await writeHistoryEntries(entries)

    expect(await readHistoryEntries()).toEqual(entries)
  })

  it('ignora datos corruptos (no un array) en vez de romper', async () => {
    ;(globalThis as unknown as { chrome: unknown }).chrome = {
      storage: { local: { get: async () => ({ 'phishguard:history': 'esto no es un array' }) } },
    }

    expect(await readHistoryEntries()).toEqual([])
  })
})
