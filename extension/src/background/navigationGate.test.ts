import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getHistory } from '../history/service'
import { updateSetting } from '../settings/service'
import { getWarningContext } from '../shared/warningContextStore'
import { addTrustedSite } from '../trustedSites/service'
import { createAuthorization, clearAuthorization } from './navigationAuthorization'
import { handleNavigation, WARNING_PAGE_PATH } from './navigationGate'
import { reapplyBadge } from './badge'
import { setActionHoldProvider } from './navigationCoordinator'

const LOW_URL = 'https://www.google.com/search?q=hola'
const MEDIUM_URL = 'http://192.168.1.50/login?verificar=1'
const HIGH_URL = 'https://xn--pypal-4ve.com/account'
const HIGH_URL_2 = 'http://accounts.google.com@evil-login.top/'
const SAFE_PREVIOUS_URL = 'https://webmail.example.com/inbox'

interface TabsUpdateCall {
  tabId: number
  updateProperties: { url?: string }
}

interface BadgeCall {
  method: 'setBadgeText' | 'setBadgeBackgroundColor' | 'setBadgeTextColor' | 'setTitle'
  args: Record<string, unknown>
}

let tabsUpdateCalls: TabsUpdateCall[]
let tabUrlBeforeNavigation: string | undefined
let callOrder: string[]
let badgeCalls: BadgeCall[]

function installChromeStub(): void {
  const sessionData = new Map<string, unknown>()
  const localData = new Map<string, unknown>()
  tabsUpdateCalls = []
  tabUrlBeforeNavigation = SAFE_PREVIOUS_URL
  callOrder = []
  badgeCalls = []

  ;(globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      session: {
        get: async (key: string) => ({ [key]: sessionData.get(key) }),
        set: async (items: Record<string, unknown>) => {
          callOrder.push('store')
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
      get: async (_tabId: number) => ({ url: tabUrlBeforeNavigation }),
      update: async (tabId: number, updateProperties: { url?: string }) => {
        callOrder.push('redirect')
        tabsUpdateCalls.push({ tabId, updateProperties })
      },
    },
    runtime: {
      getURL: (path: string) => `chrome-extension://phishguard-test-id/${path}`,
    },
    action: {
      setBadgeText: async (args: Record<string, unknown>) => {
        badgeCalls.push({ method: 'setBadgeText', args })
      },
      setBadgeBackgroundColor: async (args: Record<string, unknown>) => {
        badgeCalls.push({ method: 'setBadgeBackgroundColor', args })
      },
      setBadgeTextColor: async (args: Record<string, unknown>) => {
        badgeCalls.push({ method: 'setBadgeTextColor', args })
      },
      setTitle: async (args: Record<string, unknown>) => {
        badgeCalls.push({ method: 'setTitle', args })
      },
    },
  }
}

beforeEach(() => {
  installChromeStub()
})

/** Extrae `?id=` de la URL a la que se redirigió, para poder consultar ese warningId en el test. */
function warningIdFromLastRedirect(): string {
  const url = new URL(tabsUpdateCalls[0]!.updateProperties.url!)
  const id = url.searchParams.get('id')
  expect(id).toBeTruthy()
  return id!
}

describe('handleNavigation', () => {
  it('1) LOW no redirige', async () => {
    await handleNavigation({ url: LOW_URL, tabId: 1, frameId: 0 })
    expect(tabsUpdateCalls).toHaveLength(0)
  })

  it('MEDIUM no redirige (solo se informa en el popup)', async () => {
    await handleNavigation({ url: MEDIUM_URL, tabId: 1, frameId: 0 })
    expect(tabsUpdateCalls).toHaveLength(0)
  })

  it('1) HIGH sin autorización redirige a warning.html', async () => {
    await handleNavigation({ url: HIGH_URL, tabId: 7, frameId: 0 })

    expect(tabsUpdateCalls).toHaveLength(1)
    const redirectUrl = tabsUpdateCalls[0]!.updateProperties.url!
    expect(redirectUrl).toContain(WARNING_PAGE_PATH)
    expect(redirectUrl).not.toContain(encodeURIComponent(HIGH_URL))
    expect(new URL(redirectUrl).searchParams.get('id')).toBeTruthy()
  })

  it('ignora frames que no son el principal (frameId != 0), incluso si la URL es HIGH', async () => {
    await handleNavigation({ url: HIGH_URL, tabId: 7, frameId: 3 })
    expect(tabsUpdateCalls).toHaveLength(0)
  })

  it('ignora URLs que no son http(s), incluso si por alguna razón fueran HIGH', async () => {
    await handleNavigation({ url: 'chrome://settings', tabId: 1, frameId: 0 })
    expect(tabsUpdateCalls).toHaveLength(0)
  })

  it('HIGH guarda el Decision y se recupera correctamente con el warningId de la URL', async () => {
    await handleNavigation({ url: HIGH_URL, tabId: 9, frameId: 0 })

    const warningId = warningIdFromLastRedirect()
    const context = await getWarningContext(warningId)

    expect(context).toBeDefined()
    expect(context!.decision.riskLevel).toBe('high')
    expect(context!.decision.url).toBe(HIGH_URL)
    expect(context!.decision.activatedRules.some((hit) => hit.id === 'punycode')).toBe(true)
  })

  it('captura la página segura previa (safeReturnUrl) antes de que la navegación bloqueada la reemplace', async () => {
    await handleNavigation({ url: HIGH_URL, tabId: 9, frameId: 0 })

    const warningId = warningIdFromLastRedirect()
    const context = await getWarningContext(warningId)
    expect(context!.safeReturnUrl).toBe(SAFE_PREVIOUS_URL)
  })

  it('dos pestañas HIGH simultáneas no mezclan decisiones: cada una tiene su propio warningId', async () => {
    await handleNavigation({ url: HIGH_URL, tabId: 1, frameId: 0 })
    const firstWarningId = warningIdFromLastRedirect()

    await handleNavigation({ url: HIGH_URL_2, tabId: 2, frameId: 0 })
    const secondWarningId = new URL(tabsUpdateCalls[1]!.updateProperties.url!).searchParams.get(
      'id',
    )

    expect(secondWarningId).not.toBe(firstWarningId)
    expect((await getWarningContext(firstWarningId))!.decision.url).toBe(HIGH_URL)
    expect((await getWarningContext(secondWarningId!))!.decision.url).toBe(HIGH_URL_2)
  })

  it('no hay race condition entre guardar el contexto y redirigir: el store siempre ocurre antes que el tabs.update', async () => {
    await handleNavigation({ url: HIGH_URL, tabId: 7, frameId: 0 })
    // Antes de este par también se guarda el estado de la insignia (badge.ts);
    // lo que importa aquí es que el contexto se guarda justo antes de redirigir.
    expect(callOrder.slice(-2)).toEqual(['store', 'redirect'])
    expect(callOrder.filter((c) => c === 'redirect')).toHaveLength(1)
  })

  it('4) primera navegación autorizada no bloquea', async () => {
    await createAuthorization(7, HIGH_URL)

    await handleNavigation({ url: HIGH_URL, tabId: 7, frameId: 0 })

    expect(tabsUpdateCalls).toHaveLength(0)
  })

  it('6) un redirect inmediato http→https en la misma pestaña también se permite mientras la autorización sigue activa', async () => {
    await createAuthorization(7, 'http://example.com/')

    await handleNavigation({ url: 'http://example.com/', tabId: 7, frameId: 0 })
    expect(tabsUpdateCalls).toHaveLength(0)

    await handleNavigation({ url: 'https://example.com/', tabId: 7, frameId: 0 })
    expect(tabsUpdateCalls).toHaveLength(0)
  })

  it('8) otra pestaña no hereda la autorización: la misma URL en otra pestaña se sigue bloqueando', async () => {
    await createAuthorization(7, HIGH_URL)

    await handleNavigation({ url: HIGH_URL, tabId: 8, frameId: 0 })

    expect(tabsUpdateCalls).toHaveLength(1) // se interceptó igual, la autorización era de otra pestaña
  })

  it('LIMITACIÓN DOCUMENTADA: mientras la autorización de la pestaña sigue activa, incluso una URL HIGH distinta en esa misma pestaña se deja pasar (trade-off explícito, ver explicación)', async () => {
    await createAuthorization(7, HIGH_URL)

    await handleNavigation({ url: HIGH_URL_2, tabId: 7, frameId: 0 })

    expect(tabsUpdateCalls).toHaveLength(0)
  })

  it('9/10) tras limpiar la autorización (equivalente a onCompleted), una navegación posterior a la misma URL vuelve a analizarse', async () => {
    await createAuthorization(7, HIGH_URL)
    await handleNavigation({ url: HIGH_URL, tabId: 7, frameId: 0 })
    expect(tabsUpdateCalls).toHaveLength(0)

    await clearAuthorization(7) // lo que hace background/index.ts en onCompleted

    await handleNavigation({ url: HIGH_URL, tabId: 7, frameId: 0 })
    expect(tabsUpdateCalls).toHaveLength(1) // se volvió a interceptar
  })

  describe('integración con el historial', () => {
    it('LOW se guarda en el historial', async () => {
      await handleNavigation({ url: LOW_URL, tabId: 1, frameId: 0 })

      const history = await getHistory()
      expect(history).toHaveLength(1)
      expect(history[0]!.riskLevel).toBe('low')
      expect(history[0]!.url).toBe(LOW_URL)
    })

    it('MEDIUM se guarda en el historial', async () => {
      await handleNavigation({ url: MEDIUM_URL, tabId: 1, frameId: 0 })

      const history = await getHistory()
      expect(history).toHaveLength(1)
      expect(history[0]!.riskLevel).toBe('medium')
    })

    it('una URL HIGH bloqueada (redirigida a warning.html) aparece en el historial igual', async () => {
      await handleNavigation({ url: HIGH_URL, tabId: 7, frameId: 0 })

      expect(tabsUpdateCalls).toHaveLength(1) // efectivamente se bloqueó
      const history = await getHistory()
      expect(history).toHaveLength(1)
      expect(history[0]!.riskLevel).toBe('high')
      expect(history[0]!.url).toBe(HIGH_URL)
    })

    it('el bypass ("continuar") no genera una segunda entrada de historial para la misma evaluación', async () => {
      // Primera vez: se bloquea y se registra en el historial.
      await handleNavigation({ url: HIGH_URL, tabId: 7, frameId: 0 })
      expect(await getHistory()).toHaveLength(1)

      // El usuario elige "continuar": se crea la autorización (lo haría
      // continueNavigation.ts) y la navegación subsiguiente NUNCA llega a
      // llamar a decide() (se corta antes, con hasTemporaryAuthorization),
      // así que nunca llega a recordAnalysis().
      await createAuthorization(7, HIGH_URL)
      await handleNavigation({ url: HIGH_URL, tabId: 7, frameId: 0 })

      const history = await getHistory()
      expect(history).toHaveLength(1) // sigue siendo una sola entrada
    })

    it('no registra chrome:// ni otras URLs internas', async () => {
      await handleNavigation({ url: 'chrome://settings', tabId: 1, frameId: 0 })
      expect(await getHistory()).toHaveLength(0)
    })

    it('un fallo al guardar el historial no impide mostrar la advertencia de una URL HIGH', async () => {
      const originalGet = (
        chrome.storage.local as { get: (key: string) => Promise<Record<string, unknown>> }
      ).get
      ;(chrome.storage.local as unknown as { get: () => Promise<never> }).get = async () => {
        throw new Error('fallo simulado de storage')
      }

      await handleNavigation({ url: HIGH_URL, tabId: 7, frameId: 0 })

      expect(tabsUpdateCalls).toHaveLength(1) // la advertencia se mostró igual
      ;(chrome.storage.local as { get: typeof originalGet }).get = originalGet
    })
  })

  describe('integración con sitios confiables', () => {
    it('sitio confiable no muestra warning ni siquiera para una URL que de otro modo sería HIGH', async () => {
      await addTrustedSite(new URL(HIGH_URL).hostname)

      await handleNavigation({ url: HIGH_URL, tabId: 7, frameId: 0 })

      expect(tabsUpdateCalls).toHaveLength(0)
    })

    it('sitio confiable no genera una entrada de historial (decide() nunca se ejecuta)', async () => {
      await addTrustedSite(new URL(HIGH_URL).hostname)

      await handleNavigation({ url: HIGH_URL, tabId: 7, frameId: 0 })

      expect(await getHistory()).toHaveLength(0)
    })

    it('sitio NO confiable con riesgo HIGH sigue bloqueándose (contraste)', async () => {
      await addTrustedSite('otro-dominio-confiable.com')

      await handleNavigation({ url: HIGH_URL, tabId: 7, frameId: 0 })

      expect(tabsUpdateCalls).toHaveLength(1)
    })

    it('confiar en un subdominio no permite el dominio padre', async () => {
      const parentHostname = new URL(HIGH_URL).hostname
      await addTrustedSite(`accounts.${parentHostname}`)

      await handleNavigation({ url: HIGH_URL, tabId: 7, frameId: 0 })

      expect(tabsUpdateCalls).toHaveLength(1) // el dominio padre se sigue evaluando
    })

    it('el bypass temporal ("continuar de todas formas") sigue funcionando sin verse afectado por sitios confiables', async () => {
      await addTrustedSite('otro-dominio-confiable.com')
      await createAuthorization(7, HIGH_URL)

      await handleNavigation({ url: HIGH_URL, tabId: 7, frameId: 0 })

      expect(tabsUpdateCalls).toHaveLength(0)
    })
  })

  describe('integración con configuración general', () => {
    it('protección desactivada: no analiza, no bloquea y no guarda historial', async () => {
      await updateSetting('phishingProtectionEnabled', false)

      await handleNavigation({ url: HIGH_URL, tabId: 7, frameId: 0 })

      expect(tabsUpdateCalls).toHaveLength(0)
      expect(await getHistory()).toHaveLength(0)
    })

    it('protección desactivada no borra un historial ya existente', async () => {
      await handleNavigation({ url: LOW_URL, tabId: 1, frameId: 0 }) // se registra normalmente
      expect(await getHistory()).toHaveLength(1)

      await updateSetting('phishingProtectionEnabled', false)
      await handleNavigation({ url: HIGH_URL, tabId: 7, frameId: 0 })

      expect(await getHistory()).toHaveLength(1) // la entrada previa sigue ahí
    })

    it('protección desactivada no borra sitios confiables existentes', async () => {
      await addTrustedSite(new URL(HIGH_URL).hostname)
      await updateSetting('phishingProtectionEnabled', false)

      await handleNavigation({ url: LOW_URL, tabId: 1, frameId: 0 })

      const { getTrustedSites } = await import('../trustedSites/service')
      expect(await getTrustedSites()).toHaveLength(1)
    })

    it('advertencias de riesgo alto desactivadas: HIGH se analiza y se guarda, pero NO redirige a warning.html', async () => {
      await updateSetting('highRiskWarningEnabled', false)

      await handleNavigation({ url: HIGH_URL, tabId: 7, frameId: 0 })

      expect(tabsUpdateCalls).toHaveLength(0) // no se mostró warning.html
      const history = await getHistory()
      expect(history).toHaveLength(1)
      expect(history[0]!.riskLevel).toBe('high') // el popup seguiría mostrando HIGH
    })

    it('guardar historial desactivado: no crea nuevas entradas, incluso para HIGH', async () => {
      await updateSetting('saveHistoryEnabled', false)

      await handleNavigation({ url: HIGH_URL, tabId: 7, frameId: 0 })

      expect(tabsUpdateCalls).toHaveLength(1) // el bloqueo de HIGH no depende del historial
      expect(await getHistory()).toHaveLength(0)
    })

    it('mostrar badge desactivado: no se llama setBadgeText con el nivel de riesgo, solo se limpia', async () => {
      await updateSetting('showBadgeEnabled', false)

      await handleNavigation({ url: HIGH_URL, tabId: 7, frameId: 0 })

      expect(badgeCalls).toEqual([
        { method: 'setBadgeText', args: { tabId: 7, text: '' } },
        { method: 'setTitle', args: { tabId: 7, title: 'PhishGuard' } },
      ])
    })

    it('mostrar badge activado: refleja el riskLevel de la navegación', async () => {
      await handleNavigation({ url: HIGH_URL, tabId: 7, frameId: 0 })

      expect(badgeCalls).toContainEqual({ method: 'setBadgeText', args: { tabId: 7, text: '!!' } })
    })

    it('configuración con datos corruptos en storage usa defaults seguros (protección sigue activa)', async () => {
      ;(
        chrome.storage.local as unknown as {
          get: (key: string) => Promise<Record<string, unknown>>
        }
      ).get = async (key: string) =>
        key === 'phishguard:settings' ? { [key]: 'dato corrupto' } : { [key]: undefined }

      await handleNavigation({ url: HIGH_URL, tabId: 7, frameId: 0 })

      expect(tabsUpdateCalls).toHaveLength(1) // se siguió bloqueando, como el default espera
    })
  })
})

describe('coordinación de la EJECUCIÓN con Web Protection (la decisión de phishing no cambia)', () => {
  afterEach(() => setActionHoldProvider(null))

  it('ventana confirmada como popup publicitario: no se abre la advertencia, pero historial y badge se registran igual', async () => {
    setActionHoldProvider({
      hold: (tabId) => (tabId === 7 ? Promise.resolve('handled-by-web-protection') : null),
    })
    await handleNavigation({ url: HIGH_URL, tabId: 7, frameId: 0 })
    expect(tabsUpdateCalls).toHaveLength(0)
    const history = await getHistory()
    expect(history[0]?.riskLevel).toBe('high')
    expect(badgeCalls.some((c) => c.method === 'setBadgeText' && c.args.tabId === 7)).toBe(true)
  })

  it('ventana liberada por Web Protection (ambigua / TTL vencido): la advertencia se abre', async () => {
    setActionHoldProvider({ hold: () => Promise.resolve('release') })
    await handleNavigation({ url: HIGH_URL, tabId: 7, frameId: 0 })
    expect(tabsUpdateCalls).toHaveLength(1)
    expect(tabsUpdateCalls[0]!.updateProperties.url).toContain(WARNING_PAGE_PATH)
  })

  it('otras pestañas no se ven afectadas por una retención', async () => {
    setActionHoldProvider({
      hold: (tabId) => (tabId === 7 ? Promise.resolve('handled-by-web-protection') : null),
    })
    await handleNavigation({ url: HIGH_URL, tabId: 8, frameId: 0 })
    expect(tabsUpdateCalls).toHaveLength(1)
  })
})

describe('insignia tras "Continuar de todas formas" (prueba con sitios reales, 2026-10-06)', () => {
  it('con la autorización activa, la insignia muestra el nivel real: "!!" en rojo y su título', async () => {
    await createAuthorization(7, HIGH_URL)

    await handleNavigation({ url: HIGH_URL, tabId: 7, frameId: 0 })

    expect(tabsUpdateCalls).toHaveLength(0) // no se vuelve a mostrar la advertencia
    expect(badgeCalls).toEqual([
      { method: 'setBadgeText', args: { tabId: 7, text: '!!' } },
      { method: 'setBadgeBackgroundColor', args: { tabId: 7, color: '#b91c1c' } },
      { method: 'setBadgeTextColor', args: { tabId: 7, color: '#ffffff' } },
      { method: 'setTitle', args: { tabId: 7, title: 'PhishGuard: este sitio podría robar tus datos' } },
    ])
  })

  it('la navegación autorizada sigue sin registrarse en el historial', async () => {
    await createAuthorization(7, HIGH_URL)
    await handleNavigation({ url: HIGH_URL, tabId: 7, frameId: 0 })
    expect(await getHistory()).toHaveLength(0)
  })

  it('con "mostrar insignia" desactivado, tras continuar la insignia queda limpia', async () => {
    await updateSetting('showBadgeEnabled', false)
    await createAuthorization(7, HIGH_URL)
    await handleNavigation({ url: HIGH_URL, tabId: 7, frameId: 0 })
    expect(badgeCalls).toEqual([
      { method: 'setBadgeText', args: { tabId: 7, text: '' } },
      { method: 'setTitle', args: { tabId: 7, title: 'PhishGuard' } },
    ])
  })

  it('el nivel queda guardado para reponerlo cuando Chrome borre la insignia al confirmar', async () => {
    await createAuthorization(7, HIGH_URL)
    await handleNavigation({ url: HIGH_URL, tabId: 7, frameId: 0 })
    badgeCalls = []

    await reapplyBadge(7, HIGH_URL) // lo que hace background/index.ts en onCommitted

    expect(badgeCalls).toContainEqual({ method: 'setBadgeText', args: { tabId: 7, text: '!!' } })
  })
})

describe('estado guardado de la insignia en cada navegación', () => {
  it('cada navegación reemplaza el nivel guardado de la pestaña (medio → bajo)', async () => {
    await handleNavigation({ url: MEDIUM_URL, tabId: 3, frameId: 0 })
    await handleNavigation({ url: LOW_URL, tabId: 3, frameId: 0 })
    badgeCalls = []

    await reapplyBadge(3, LOW_URL)

    expect(badgeCalls).toContainEqual({ method: 'setBadgeText', args: { tabId: 3, text: '' } })
    expect(badgeCalls).toContainEqual({
      method: 'setTitle',
      args: { tabId: 3, title: 'PhishGuard: no encontramos señales de riesgo en este sitio' },
    })
  })

  it('una URL que decide() no puede analizar no deja el nivel de la página anterior guardado', async () => {
    await handleNavigation({ url: MEDIUM_URL, tabId: 3, frameId: 0 })
    await handleNavigation({ url: 'http://[no-es-una-url', tabId: 3, frameId: 0 })
    badgeCalls = []

    await reapplyBadge(3, 'http://[no-es-una-url')

    expect(badgeCalls).toHaveLength(0)
  })

  it('sitio confiable: se guarda la insignia limpia', async () => {
    await handleNavigation({ url: MEDIUM_URL, tabId: 3, frameId: 0 })
    await addTrustedSite(MEDIUM_URL)
    await handleNavigation({ url: MEDIUM_URL, tabId: 3, frameId: 0 })
    badgeCalls = []

    await reapplyBadge(3, MEDIUM_URL)

    expect(badgeCalls).toEqual([
      { method: 'setBadgeText', args: { tabId: 3, text: '' } },
      { method: 'setTitle', args: { tabId: 3, title: 'PhishGuard' } },
    ])
  })
})

describe('carrera de "Continuar" con páginas que cargan casi al instante', () => {
  it('si onCompleted limpia la autorización mientras se leen los ajustes, la navegación autorizada no se vuelve a bloquear', async () => {
    await createAuthorization(7, HIGH_URL)
    const local = chrome.storage.local as unknown as { get: (key: string) => Promise<Record<string, unknown>> }
    const originalGet = local.get
    local.get = async (key: string) => {
      await clearAuthorization(7) // lo que hace background/index.ts en onCompleted
      return originalGet(key)
    }

    await handleNavigation({ url: HIGH_URL, tabId: 7, frameId: 0 })

    expect(tabsUpdateCalls).toHaveLength(0)
    expect(badgeCalls).toContainEqual({ method: 'setBadgeText', args: { tabId: 7, text: '!!' } })
  })
})
