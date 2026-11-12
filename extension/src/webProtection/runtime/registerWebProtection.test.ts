import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SETTINGS_STORAGE_KEY } from '../../settings/storage'
import { COSMETIC_REQUEST_TYPE } from '../page/protocol'
import {
  WEB_PROTECTION_EXPERIMENTS_KEY,
  WEB_PROTECTION_SETTINGS_KEY,
  WEB_PROTECTION_STATUS_KEY,
} from '../settings'
import { registerWebProtection } from './registerWebProtection'

type Listener = (...args: unknown[]) => void

function event() {
  const listeners: Listener[] = []
  return { listeners, addListener: (fn: Listener) => listeners.push(fn) }
}

function installChromeStub() {
  const onInstalled = event()
  const onStartup = event()
  const onChanged = event()
  const onBeforeNavigate = event()
  const onCommitted = event()
  const onCreatedNavigationTarget = event()
  const onBeforeRequest = event()
  const onBeforeRedirect = event()
  const onRemoved = event()
  const onTabCreated = event()
  const onMessage = event()
  const tabs = {
    onRemoved,
    onCreated: onTabCreated,
    get: vi.fn(async () => ({ url: 'https://site.test/' })),
    remove: vi.fn(async () => undefined),
    goBack: vi.fn(async () => undefined),
    sendMessage: vi.fn(async () => ({ v: 1, intents: [] })),
  }
  const onWindowCreated = event()
  const windows = {
    get: vi.fn(
      async (_id: number): Promise<Record<string, unknown>> => ({
        type: 'normal',
        width: 1280,
        height: 800,
      }),
    ),
    onCreated: onWindowCreated,
    onRemoved: event(),
  }
  const session: Record<string, unknown> = {}
  const dnr = {
    getAvailableStaticRuleCount: vi.fn(async () => 330_000),
    getEnabledRulesets: vi.fn(async () => [] as string[]),
    updateEnabledRulesets: vi.fn(async () => undefined),
  }
  const chromeStub = {
    runtime: {
      id: 'ext',
      onInstalled,
      onStartup,
      onMessage,
      getURL: (path: string) => `chrome-extension://ext${path}`,
    },
    webNavigation: { onBeforeNavigate, onCommitted, onCreatedNavigationTarget },
    webRequest: { onBeforeRequest, onBeforeRedirect },
    tabs,
    windows,
    declarativeNetRequest: dnr,
    storage: {
      onChanged,
      local: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) },
      session: {
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.assign(session, items)
        }),
      },
    },
  }
  vi.stubGlobal('chrome', chromeStub)
  const fetchIndex = vi.fn(async () => ({
    json: async () => ({ hide: { 'example.com': ['.ad'] }, allow: {} }),
  }))
  vi.stubGlobal('fetch', fetchIndex)
  return {
    onInstalled,
    onStartup,
    onChanged,
    onBeforeNavigate,
    onCommitted,
    onCreatedNavigationTarget,
    onBeforeRequest,
    onTabCreated,
    onWindowCreated,
    onMessage,
    tabs,
    windows,
    dnr,
    session,
    fetchIndex,
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('registerWebProtection: integración con el service worker', () => {
  let stub: ReturnType<typeof installChromeStub>
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    stub = installChromeStub()
    registerWebProtection()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('escucha instalación, inicio y configuración; las navegaciones SOLO desde el Popup Guard', () => {
    expect(stub.onInstalled.listeners).toHaveLength(1)
    expect(stub.onStartup.listeners).toHaveLength(1)
    // Reconciliación DNR + caché de "Anuncios" del Popup Guard.
    expect(stub.onChanged.listeners).toHaveLength(2)
    expect(stub.onBeforeNavigate.listeners).toHaveLength(1)
    expect(stub.onCommitted.listeners).toHaveLength(1)
    expect(stub.onCreatedNavigationTarget.listeners).toHaveLength(1)
    expect(stub.onBeforeRequest.listeners).toHaveLength(1)
    // Solo actúa con el experimento `popupGuardTabCreated` activo (desactivado por defecto).
    expect(stub.onTabCreated.listeners).toHaveLength(1)
    // T8: posición de las ventanas popup al nacer.
    expect(stub.onWindowCreated.listeners).toHaveLength(1)
  })

  it('experimento popupGuardTabCreated desactivado (por defecto): una pestaña normal con opener no se observa', async () => {
    stub.onTabCreated.listeners[0]!({ id: 5, windowId: 50, openerTabId: 1, pendingUrl: 'about:blank' })
    await settle()
    await settle()
    expect(stub.tabs.sendMessage).not.toHaveBeenCalled()
  })

  describe('T6: ventanas type popup (camino acotado, sin el experimento)', () => {
    it('pestaña con opener en una ventana popup: se observa con su tamaño al nacer', async () => {
      stub.windows.get.mockResolvedValueOnce({ type: 'popup', width: 146, height: 182 })
      stub.onTabCreated.listeners[0]!({
        id: 8,
        windowId: 80,
        openerTabId: 1,
        pendingUrl: '',
        width: 131,
        height: 110,
      })
      await vi.waitFor(() =>
        expect(stub.tabs.sendMessage).toHaveBeenCalledWith(1, expect.anything(), { frameId: 0 }),
      )
      expect(stub.windows.get).toHaveBeenCalledWith(80)
    })

    it('lee la ventana de la pestaña que la abrió para saber si nació en su borde', async () => {
      stub.tabs.get.mockImplementation(async (id?: number) =>
        id === 1 ? { url: 'https://site.test/', windowId: 70 } : { url: 'https://site.test/' },
      )
      stub.windows.get.mockImplementation(async (id: number) =>
        id === 70
          ? { type: 'normal', left: 10, top: 10, width: 1383, height: 882 }
          : { type: 'popup', left: 1366, top: 0, width: 178, height: 100 },
      )
      stub.onTabCreated.listeners[0]!({
        id: 12,
        windowId: 120,
        openerTabId: 1,
        pendingUrl: '',
        width: 131,
        height: 110,
      })
      await vi.waitFor(() =>
        expect(stub.tabs.sendMessage).toHaveBeenCalledWith(1, expect.anything(), { frameId: 0 }),
      )
      expect(stub.tabs.get).toHaveBeenCalledWith(1)
      expect(stub.windows.get).toHaveBeenCalledWith(70)
    })

    it('T8: windows.onCreated antes que tabs.onCreated: usa la posición del evento, no la de windows.get (ya crecida)', async () => {
      stub.tabs.get.mockImplementation(async (id?: number) =>
        id === 1 ? { url: 'https://site.test/', windowId: 70 } : { url: 'https://site.test/' },
      )
      stub.windows.get.mockImplementation(async (id: number) =>
        id === 70
          ? { type: 'normal', left: -7, top: -7, width: 1552, height: 832 }
          : { type: 'popup', left: 0, top: 0, width: 1536, height: 816 },
      )
      stub.onWindowCreated.listeners[0]!({ id: 130, type: 'popup', left: 1358, top: 0, width: 178, height: 182 })
      stub.onTabCreated.listeners[0]!({
        id: 13,
        windowId: 130,
        openerTabId: 1,
        pendingUrl: '',
        width: 131,
        height: 110,
      })
      await vi.waitFor(() =>
        expect(stub.tabs.sendMessage).toHaveBeenCalledWith(1, expect.anything(), { frameId: 0 }),
      )
      expect(stub.windows.get).not.toHaveBeenCalledWith(130)
      expect(stub.windows.get).toHaveBeenCalledWith(70)
    })

    it('ventana popup sin opener (la abrió el navegador o el usuario): se ignora', async () => {
      stub.windows.get.mockResolvedValue({ type: 'popup', width: 146, height: 182 })
      stub.onTabCreated.listeners[0]!({ id: 9, windowId: 90, pendingUrl: '', width: 131, height: 110 })
      await settle()
      await settle()
      expect(stub.tabs.sendMessage).not.toHaveBeenCalled()
    })

    it('si no se puede leer la ventana: no se observa (fail-open)', async () => {
      stub.windows.get.mockRejectedValueOnce(new Error('No window with id'))
      stub.onTabCreated.listeners[0]!({
        id: 10,
        windowId: 100,
        openerTabId: 1,
        pendingUrl: '',
        width: 131,
        height: 110,
      })
      await settle()
      await settle()
      expect(stub.tabs.sendMessage).not.toHaveBeenCalled()
    })

    it('con "Anuncios" desactivado ni siquiera lee la ventana', async () => {
      stub.onChanged.listeners[1]!(
        { [WEB_PROTECTION_SETTINGS_KEY]: { newValue: { adsEnabled: false, trackersEnabled: true } } },
        'local',
      )
      stub.onTabCreated.listeners[0]!({
        id: 11,
        windowId: 110,
        openerTabId: 1,
        pendingUrl: '',
        width: 131,
        height: 110,
      })
      await settle()
      await settle()
      expect(stub.windows.get).not.toHaveBeenCalled()
      expect(stub.tabs.sendMessage).not.toHaveBeenCalled()
    })
  })

  it('experimento popupGuardTabCreated activado: la pestaña con opener se observa (consulta la intención)', async () => {
    for (const listener of stub.onChanged.listeners) {
      listener(
        { [WEB_PROTECTION_EXPERIMENTS_KEY]: { newValue: { popupGuardTabCreated: true } } },
        'local',
      )
    }
    stub.onTabCreated.listeners[0]!({ id: 6, openerTabId: 1, pendingUrl: 'about:blank' })
    await vi.waitFor(() =>
      expect(stub.tabs.sendMessage).toHaveBeenCalledWith(1, expect.anything(), { frameId: 0 }),
    )
    // Sin opener (pestaña abierta por el usuario): se ignora.
    stub.tabs.sendMessage.mockClear()
    stub.onTabCreated.listeners[0]!({ id: 7, pendingUrl: 'chrome://newtab/' })
    await settle()
    expect(stub.tabs.sendMessage).not.toHaveBeenCalled()
  })

  it('con "Anuncios" desactivado, una ventana nueva no provoca consultas ni cierres', async () => {
    stub.onChanged.listeners[1]!(
      { [WEB_PROTECTION_SETTINGS_KEY]: { newValue: { adsEnabled: false, trackersEnabled: true } } },
      'local',
    )
    stub.onCreatedNavigationTarget.listeners[0]!({
      sourceTabId: 1,
      sourceFrameId: 0,
      tabId: 2,
      url: 'https://x.test/',
      timeStamp: 1,
    })
    await settle()
    expect(stub.tabs.sendMessage).not.toHaveBeenCalled()
    expect(stub.tabs.remove).not.toHaveBeenCalled()
  })

  it('las navegaciones nunca tocan DNR ni el estado de Web Protection', async () => {
    stub.onBeforeNavigate.listeners[0]!({
      tabId: 3,
      frameId: 0,
      url: 'https://x.test/',
      timeStamp: 1,
    })
    stub.onCommitted.listeners[0]!({
      tabId: 3,
      frameId: 0,
      url: 'https://x.test/',
      transitionType: 'typed',
      transitionQualifiers: [],
    })
    await settle()
    expect(stub.dnr.updateEnabledRulesets).not.toHaveBeenCalled()
    expect(stub.tabs.goBack).not.toHaveBeenCalled()
  })

  it('al instalar, habilita los rulesets y guarda el estado en la sesión', async () => {
    stub.onInstalled.listeners[0]!({ reason: 'install' })
    await settle()
    await settle()
    expect(stub.dnr.updateEnabledRulesets).toHaveBeenCalled()
    expect(stub.session[WEB_PROTECTION_STATUS_KEY]).toMatchObject({
      reason: 'installed',
      outcome: 'applied',
    })
  })

  it('un cambio en la configuración de PHISHING no dispara ninguna reconciliación', async () => {
    stub.onChanged.listeners[0]!({ [SETTINGS_STORAGE_KEY]: { newValue: {} } }, 'local')
    await settle()
    expect(stub.dnr.getEnabledRulesets).not.toHaveBeenCalled()
  })

  it('un cambio de toggles de Web Protection sí reconcilia', async () => {
    stub.onChanged.listeners[0]!({ [WEB_PROTECTION_SETTINGS_KEY]: { newValue: {} } }, 'local')
    await settle()
    await settle()
    expect(stub.dnr.getEnabledRulesets).toHaveBeenCalled()
  })

  it('ignora cambios en otras áreas de storage (por ejemplo, su propio estado de sesión)', async () => {
    stub.onChanged.listeners[0]!({ [WEB_PROTECTION_STATUS_KEY]: { newValue: {} } }, 'session')
    await settle()
    expect(stub.dnr.getEnabledRulesets).not.toHaveBeenCalled()
  })

  it('atiende la petición cosmética con el hostname del emisor y responde de forma asíncrona', async () => {
    const sendResponse = vi.fn()
    const sender = {
      id: 'ext',
      frameId: 0,
      tab: { id: 1 },
      url: 'https://www.example.com/a?q=secreto',
    }
    const keepOpen = stub.onMessage.listeners[0]!(
      { type: COSMETIC_REQUEST_TYPE, v: 1 },
      sender,
      sendResponse,
    )
    expect(keepOpen).toBe(true)
    await settle()
    await settle()
    expect(sendResponse).toHaveBeenCalledWith({ ok: true, selectors: ['.ad'] })
    expect(stub.fetchIndex).toHaveBeenCalledTimes(1)
  })

  it('no toca los mensajes del motor de phishing (continuar/confiar): devuelve undefined', () => {
    const sendResponse = vi.fn()
    const result = stub.onMessage.listeners[0]!(
      { type: 'continue', url: 'https://x.test' },
      {},
      sendResponse,
    )
    expect(result).toBeUndefined()
    expect(sendResponse).not.toHaveBeenCalled()
  })
})
