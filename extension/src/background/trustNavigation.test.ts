import { beforeEach, describe, expect, it } from 'vitest'
import { getTrustedSites } from '../trustedSites/service'
import { handleTrustRequest } from './trustNavigation'

interface TabsUpdateCall {
  tabId: number
  updateProperties: { url?: string }
}

let tabsUpdateCalls: TabsUpdateCall[]

function installChromeStub(): void {
  const localData = new Map<string, unknown>()
  tabsUpdateCalls = []

  ;(globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: localData.get(key) }),
        set: async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) localData.set(k, v)
        },
      },
    },
    tabs: {
      update: async (tabId: number, updateProperties: { url?: string }) => {
        tabsUpdateCalls.push({ tabId, updateProperties })
      },
    },
  }
}

beforeEach(() => {
  installChromeStub()
})

describe('handleTrustRequest', () => {
  it('agrega el hostname a la allowlist permanente', async () => {
    await handleTrustRequest(7, 'https://evil-login.top/account')

    const sites = await getTrustedSites()
    expect(sites).toHaveLength(1)
    expect(sites[0]!.hostname).toBe('evil-login.top')
  })

  it('navega a la URL original una vez guardado el hostname', async () => {
    await handleTrustRequest(7, 'https://evil-login.top/account')

    expect(tabsUpdateCalls).toEqual([
      { tabId: 7, updateProperties: { url: 'https://evil-login.top/account' } },
    ])
  })

  it('confiar dos veces en el mismo sitio no genera un duplicado en la allowlist', async () => {
    await handleTrustRequest(7, 'https://evil-login.top/account')
    await handleTrustRequest(7, 'https://evil-login.top/otra-pagina')

    expect(await getTrustedSites()).toHaveLength(1)
  })
})
