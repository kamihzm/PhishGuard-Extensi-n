import { beforeEach, describe, expect, it } from 'vitest'
import type { TrustedSite } from './types'
import { readTrustedSites, writeTrustedSites } from './storage'

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

describe('trustedSites/storage', () => {
  it('sin nada guardado, devuelve un array vacío', async () => {
    expect(await readTrustedSites()).toEqual([])
  })

  it('14) los datos persisten correctamente en chrome.storage.local', async () => {
    const sites: TrustedSite[] = [
      { hostname: 'example.com', addedAt: new Date().toISOString() },
      { hostname: 'accounts.google.com', addedAt: new Date().toISOString() },
    ]

    await writeTrustedSites(sites)

    expect(await readTrustedSites()).toEqual(sites)
  })

  it('ignora datos corruptos (no un array) en vez de romper', async () => {
    ;(globalThis as unknown as { chrome: unknown }).chrome = {
      storage: { local: { get: async () => ({ 'phishguard:trusted-sites': 'no es un array' }) } },
    }

    expect(await readTrustedSites()).toEqual([])
  })
})
