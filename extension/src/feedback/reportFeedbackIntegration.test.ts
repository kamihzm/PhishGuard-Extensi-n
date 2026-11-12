import { beforeEach, describe, expect, it } from 'vitest'
import { hasTemporaryAuthorization } from '../background/navigationAuthorization'
import { isTrustedUrl } from '../trustedSites/service'
import { reportFeedback } from './service'

const HIGH_URL = 'https://xn--pypal-4ve.com/account'

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
  }
}

beforeEach(() => {
  installChromeStub()
})

describe('reportFeedback no interfiere con la navegación', () => {
  it('reportar false-positive para una URL HIGH no crea una autorización temporal (bypass)', async () => {
    await reportFeedback({
      url: HIGH_URL,
      feedbackType: 'false-positive',
      originalRiskLevel: 'high',
      finalScore: 83,
      ruleScore: 75,
      mlProbability: 0.87,
      activatedRuleIds: ['punycode'],
    })

    expect(await hasTemporaryAuthorization(7, HIGH_URL)).toBe(false)
  })

  it('reportar false-positive para una URL HIGH no agrega el hostname a sitios confiables', async () => {
    await reportFeedback({
      url: HIGH_URL,
      feedbackType: 'false-positive',
      originalRiskLevel: 'high',
      finalScore: 83,
      ruleScore: 75,
      mlProbability: 0.87,
      activatedRuleIds: ['punycode'],
    })

    expect(await isTrustedUrl(HIGH_URL)).toBe(false)
  })

  it('reportar missed-risk para una URL LOW tampoco crea autorización ni sitio confiable', async () => {
    const lowUrl = 'https://suspicious-example.com/'
    await reportFeedback({
      url: lowUrl,
      feedbackType: 'missed-risk',
      originalRiskLevel: 'low',
      finalScore: 18,
      ruleScore: 10,
      mlProbability: 0.15,
      activatedRuleIds: [],
    })

    expect(await hasTemporaryAuthorization(7, lowUrl)).toBe(false)
    expect(await isTrustedUrl(lowUrl)).toBe(false)
  })
})
