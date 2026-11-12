import { beforeEach, describe, expect, it } from 'vitest'
import { hasTemporaryAuthorization } from './navigationAuthorization'
import { handleContinueRequest } from './continueNavigation'

const HIGH_URL = 'https://xn--pypal-4ve.com/account'

interface TabsUpdateCall {
  tabId: number
  url: string | undefined
}

let tabsUpdateCalls: TabsUpdateCall[]
let callOrder: string[]

function installChromeStub(): void {
  const sessionData = new Map<string, unknown>()
  tabsUpdateCalls = []
  callOrder = []

  ;(globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      session: {
        get: async (key: string) => ({ [key]: sessionData.get(key) }),
        set: async (items: Record<string, unknown>) => {
          callOrder.push('authorize')
          for (const [k, v] of Object.entries(items)) sessionData.set(k, v)
        },
        remove: async (key: string) => {
          sessionData.delete(key)
        },
      },
    },
    tabs: {
      update: async (tabId: number, updateProperties: { url?: string }) => {
        callOrder.push('navigate')
        tabsUpdateCalls.push({ tabId, url: updateProperties.url })
      },
    },
  }
}

beforeEach(() => {
  installChromeStub()
})

describe('handleContinueRequest', () => {
  it('2) crea la autorización para la pestaña y la URL', async () => {
    await handleContinueRequest(7, HIGH_URL)

    expect(await hasTemporaryAuthorization(7, HIGH_URL)).toBe(true)
  })

  it('3) navega a la URL original en esa pestaña DESPUÉS de crear la autorización, nunca antes', async () => {
    await handleContinueRequest(7, HIGH_URL)

    expect(tabsUpdateCalls).toEqual([{ tabId: 7, url: HIGH_URL }])
    expect(callOrder).toEqual(['authorize', 'navigate'])
  })
})
