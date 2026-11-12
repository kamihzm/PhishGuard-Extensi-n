import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { INTENT_SESSION_TYPE, intentTokenKey } from '../popups/intentRecord'

/**
 * Token de correlación por pestaña (`issueIntentToken`). Defecto de la revisión
 * final de P1: dos pedidos simultáneos de la misma pestaña leían "sin token" y
 * cada uno escribía un UUID distinto; el documento que se quedaba con el token
 * perdedor escribía registros que `acceptIntentRecord` rechaza.
 *
 * El stub demora cada `get` un turno de temporizador (como la API real, que es
 * asíncrona), así ambos pedidos leen antes de que alguno escriba. Cada prueba
 * importa módulos nuevos: un módulo nuevo equivale a un service worker nuevo.
 */
type IntentStore = typeof import('./intentStore')
type MessageListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
) => boolean | undefined

const RUNTIME_ID = 'phishguard-test-extension'

let session: Map<string, unknown>
let setCalls: number
let setFails: boolean
/** Claves cuyo `get` espera hasta que la prueba lo libere. */
let heldGets: Map<string, Promise<void>>
let messageListener: MessageListener | undefined

const nextTimer = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function hold(key: string): () => void {
  let release!: () => void
  heldGets.set(key, new Promise<void>((resolve) => (release = resolve)))
  return release
}

function installChromeStub(): void {
  session = new Map()
  setCalls = 0
  setFails = false
  heldGets = new Map()
  messageListener = undefined
  const event = () => ({ addListener: vi.fn() })
  vi.stubGlobal('chrome', {
    runtime: {
      id: RUNTIME_ID,
      getURL: (path: string) => `chrome-extension://${RUNTIME_ID}/${path}`,
      onMessage: {
        addListener: (listener: MessageListener) => {
          messageListener = listener
        },
      },
    },
    storage: {
      session: {
        get: async (key: string) => {
          await nextTimer()
          await heldGets.get(key)
          return session.has(key) ? { [key]: session.get(key) } : {}
        },
        set: async (items: Record<string, unknown>) => {
          setCalls++
          await nextTimer()
          if (setFails) throw new Error('storage.session no disponible')
          for (const [k, v] of Object.entries(items)) session.set(k, v)
        },
        remove: async (key: string) => {
          session.delete(key)
        },
      },
      // "Anuncios" activo por defecto: sin ajustes guardados.
      local: { get: async () => ({}), set: async () => undefined, remove: async () => undefined },
      onChanged: event(),
    },
    webNavigation: {
      onCreatedNavigationTarget: event(),
      onBeforeNavigate: event(),
      onCommitted: event(),
    },
    webRequest: { onBeforeRequest: event(), onBeforeRedirect: event() },
    tabs: { onCreated: event(), onRemoved: event() },
    windows: { onCreated: event(), onRemoved: event() },
  })
}

/** Módulos nuevos: equivale a arrancar el service worker otra vez. */
async function freshIntentStore(): Promise<IntentStore> {
  vi.resetModules()
  return import('./intentStore')
}

beforeEach(() => {
  installChromeStub()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('issueIntentToken', () => {
  it('(a) dos llamadas simultáneas de la misma pestaña devuelven el mismo token, el guardado, con un solo set', async () => {
    const { issueIntentToken } = await freshIntentStore()

    const [first, second] = await Promise.all([issueIntentToken(7), issueIntentToken(7)])

    expect(second).toBe(first)
    expect(session.get(intentTokenKey(7))).toBe(first)
    expect(setCalls).toBe(1)
  })

  it('(b) pestañas distintas reciben tokens distintos y una no bloquea a la otra', async () => {
    const { issueIntentToken } = await freshIntentStore()
    const releaseTab7 = hold(intentTokenKey(7))

    let tab7Settled = false
    const tab7 = issueIntentToken(7).then((token) => {
      tab7Settled = true
      return token
    })
    const tab8 = await issueIntentToken(8)

    expect(tab7Settled).toBe(false)
    expect(session.get(intentTokenKey(8))).toBe(tab8)
    releaseTab7()
    const token7 = await tab7
    expect(token7).not.toBe(tab8)
    expect(session.get(intentTokenKey(7))).toBe(token7)
  })

  it('(c) si set falla, las dos llamadas fallan y la siguiente reintenta y funciona', async () => {
    const { issueIntentToken } = await freshIntentStore()
    setFails = true

    const results = await Promise.allSettled([issueIntentToken(7), issueIntentToken(7)])

    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected'])
    expect(session.has(intentTokenKey(7))).toBe(false)

    setFails = false
    const retried = await issueIntentToken(7)
    expect(session.get(intentTokenKey(7))).toBe(retried)
  })

  it('(d) con el mapa vacío (reinicio simulado) devuelve el token ya guardado sin escribir', async () => {
    const before = await freshIntentStore()
    const issued = await before.issueIntentToken(7)
    const setsBeforeRestart = setCalls

    const after = await freshIntentStore()
    const [first, second] = await Promise.all([
      after.issueIntentToken(7),
      after.issueIntentToken(7),
    ])

    expect(first).toBe(issued)
    expect(second).toBe(issued)
    expect(setCalls).toBe(setsBeforeRestart)
  })
})

describe('mensaje intent-session (registerPopupGuard)', () => {
  it('(e) dos mensajes simultáneos de la misma pestaña reciben respuestas idénticas', async () => {
    vi.resetModules()
    const { registerPopupGuard } = await import('./registerPopupGuard')
    registerPopupGuard()
    const listener = messageListener
    expect(listener).toBeDefined()

    const message = { type: INTENT_SESSION_TYPE, v: 1 }
    const sender = { id: RUNTIME_ID, tab: { id: 7 }, frameId: 0 } as chrome.runtime.MessageSender
    const ask = () =>
      new Promise<unknown>((resolve) => {
        expect(listener!(message, sender, resolve)).toBe(true)
      })

    const [first, second] = await Promise.all([ask(), ask()])

    expect(first).toEqual({ v: 1, tabId: 7, token: session.get(intentTokenKey(7)) })
    expect(second).toEqual(first)
  })
})
