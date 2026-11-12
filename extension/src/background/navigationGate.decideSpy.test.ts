import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAuthorization } from './navigationAuthorization'
import { handleNavigation } from './navigationGate'

const { decideMock } = vi.hoisted(() => ({ decideMock: vi.fn() }))
vi.mock('../agent/orchestrator', () => ({ decide: decideMock }))

const URL_UNDER_TEST = 'http://example.com/'

function installChromeStub(): void {
  const sessionData = new Map<string, unknown>()
  const localData = new Map<string, unknown>()
  ;(globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      session: {
        get: async (key: string) => ({ [key]: sessionData.get(key) }),
        set: async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) sessionData.set(k, v)
        },
        remove: async (key: string) => {
          sessionData.delete(key)
        },
      },
      local: {
        get: async (key: string) => ({ [key]: localData.get(key) }),
        set: async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) localData.set(k, v)
        },
      },
    },
    tabs: {
      get: async () => ({ url: undefined }),
      update: async () => {},
    },
    runtime: {
      getURL: (path: string) => `chrome-extension://phishguard-test-id/${path}`,
    },
    action: {
      setBadgeText: async () => {},
      setBadgeBackgroundColor: async () => {},
      setBadgeTextColor: async () => {},
      setTitle: async () => {},
    },
  }
}

beforeEach(() => {
  installChromeStub()
  decideMock.mockReset()
})

describe('handleNavigation con una autorización activa ("Continuar de todas formas")', () => {
  it('5) con autorización activa, decide() solo se usa para la insignia: no bloquea ni registra historial', async () => {
    decideMock.mockReturnValue({
      riskLevel: 'high',
      ruleScore: 0,
      mlProbability: 0,
      finalScore: 70,
      activatedRules: [],
      explanation: '',
      url: URL_UNDER_TEST,
    })
    const updates: unknown[] = []
    const chromeStub = (globalThis as unknown as { chrome: { tabs: { update: unknown } } }).chrome
    chromeStub.tabs.update = async (...args: unknown[]) => {
      updates.push(args)
    }
    await createAuthorization(7, URL_UNDER_TEST)

    await handleNavigation({ url: URL_UNDER_TEST, tabId: 7, frameId: 0 })

    expect(decideMock).toHaveBeenCalledTimes(1)
    expect(updates).toHaveLength(0) // no se vuelve a mostrar la advertencia
  })

  it('sin autorización, decide() SÍ se invoca con la URL de la navegación', async () => {
    decideMock.mockReturnValue({
      riskLevel: 'low',
      ruleScore: 0,
      mlProbability: 0,
      finalScore: 0,
      activatedRules: [],
      explanation: '',
      url: URL_UNDER_TEST,
    })

    await handleNavigation({ url: URL_UNDER_TEST, tabId: 9, frameId: 0 })

    expect(decideMock).toHaveBeenCalledWith(URL_UNDER_TEST)
  })
})
