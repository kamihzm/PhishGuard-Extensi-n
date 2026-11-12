import { beforeEach, describe, expect, it } from 'vitest'
import {
  NOTICE_DISMISS_MESSAGE_TYPE,
  NOTICE_QUERY_MESSAGE_TYPE,
  NOTICE_READY_MESSAGE_TYPE,
  NOTICE_TRUST_MESSAGE_TYPE,
  type MediumNoticeContent,
} from '../shared/messages'
import { getTrustedSites } from '../trustedSites/service'
import { forgetMediumNoticeTab, handleNoticeMessage, isSameDocument } from './mediumNotice'
import { handleNavigation, handleSameDocumentNavigation } from './navigationGate'

const EXTENSION_ID = 'phishguard-test-id'
const MEDIUM_URL = 'https://paypal.com.login.example/'
const LOW_URL = 'https://www.biblioteca.example/'

let badgeTexts: Array<{ tabId: number; text: string }>
let tabMessages: Array<{ tabId: number; message: unknown; frameId?: number }>

function installChromeStub(): void {
  const sessionData = new Map<string, unknown>()
  const localData = new Map<string, unknown>()
  badgeTexts = []
  tabMessages = []
  ;(globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      session: {
        get: async (key: string) => ({ [key]: sessionData.get(key) }),
        set: async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) sessionData.set(k, v)
        },
        remove: async (keys: string | string[]) => {
          for (const key of [keys].flat()) sessionData.delete(key)
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
      get: async () => ({ url: 'https://inicio.example/' }),
      update: async () => {},
      sendMessage: async (tabId: number, message: unknown, options?: { frameId?: number }) => {
        tabMessages.push({ tabId, message, frameId: options?.frameId })
      },
    },
    runtime: { id: EXTENSION_ID, getURL: (p: string) => `chrome-extension://${EXTENSION_ID}/${p}` },
    action: {
      setBadgeText: async (args: { tabId: number; text: string }) => {
        badgeTexts.push(args)
      },
      setBadgeBackgroundColor: async () => {},
      setBadgeTextColor: async () => {},
      setTitle: async () => {},
    },
  }
}

function sender(overrides: Partial<chrome.runtime.MessageSender> = {}) {
  return {
    id: EXTENSION_ID,
    tab: { id: 5 } as chrome.tabs.Tab,
    frameId: 0,
    url: MEDIUM_URL,
    ...overrides,
  } as chrome.runtime.MessageSender
}

const query = { type: NOTICE_QUERY_MESSAGE_TYPE }

beforeEach(() => {
  installChromeStub()
})

describe('aviso de nivel medio — background', () => {
  it('una navegación "medio" deja preparado el aviso con los textos ya calculados', async () => {
    await handleNavigation({ url: MEDIUM_URL, tabId: 5, frameId: 0 })

    const response = (await handleNoticeMessage(query, sender())) as {
      notice: MediumNoticeContent
    }
    expect(response.notice).toMatchObject({
      verdict: 'Ten cuidado con este sitio',
      realDomain: 'login.example',
      apparent: 'paypal.com',
      trustHostname: 'paypal.com.login.example',
    })
    expect(response.notice.signals.length).toBeGreaterThan(0)
  })

  it('al guardar el aviso avisa al marco principal de la pestaña (sin datos) para que vuelva a preguntar', async () => {
    await handleNavigation({ url: MEDIUM_URL, tabId: 5, frameId: 0 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(tabMessages).toEqual([
      { tabId: 5, message: { type: NOTICE_READY_MESSAGE_TYPE }, frameId: 0 },
    ])
  })

  it('una navegación "bajo" no deja aviso, y descarta el de la página anterior', async () => {
    await handleNavigation({ url: MEDIUM_URL, tabId: 5, frameId: 0 })
    await handleNavigation({ url: LOW_URL, tabId: 5, frameId: 0 })

    expect(await handleNoticeMessage(query, sender())).toEqual({ notice: null })
    expect(await handleNoticeMessage(query, sender({ url: LOW_URL }))).toEqual({ notice: null })
  })

  it('solo responde a la misma pestaña, la misma dirección, el marco principal y esta extensión', async () => {
    await handleNavigation({ url: MEDIUM_URL, tabId: 5, frameId: 0 })

    const denied = { notice: null }
    expect(await handleNoticeMessage(query, sender({ tab: { id: 6 } as chrome.tabs.Tab }))).toEqual(
      denied,
    )
    expect(await handleNoticeMessage(query, sender({ url: 'https://otra.example/' }))).toEqual(
      denied,
    )
    expect(await handleNoticeMessage(query, sender({ frameId: 3 }))).toEqual(denied)
    expect(await handleNoticeMessage(query, sender({ id: 'otra-extension' }))).toEqual(denied)
    expect(await handleNoticeMessage(query, sender({ tab: undefined }))).toEqual(denied)
  })

  it('cerrado por el usuario: no se vuelve a mostrar en esa pestaña para esa dirección', async () => {
    await handleNavigation({ url: MEDIUM_URL, tabId: 5, frameId: 0 })

    expect(await handleNoticeMessage({ type: NOTICE_DISMISS_MESSAGE_TYPE }, sender())).toEqual({
      ok: true,
    })
    expect(await handleNoticeMessage(query, sender())).toEqual({ notice: null })

    // Recargar vuelve a analizar la dirección, pero el aviso cerrado no reaparece.
    await handleNavigation({ url: MEDIUM_URL, tabId: 5, frameId: 0 })
    expect(await handleNoticeMessage(query, sender())).toEqual({ notice: null })
    // En otra pestaña sí aparece.
    await handleNavigation({ url: MEDIUM_URL, tabId: 6, frameId: 0 })
    const other = await handleNoticeMessage(query, sender({ tab: { id: 6 } as chrome.tabs.Tab }))
    expect(other).not.toEqual({ notice: null })
  })

  it('cerrar la pestaña descarta también los avisos cerrados', async () => {
    await handleNavigation({ url: MEDIUM_URL, tabId: 5, frameId: 0 })
    await handleNoticeMessage({ type: NOTICE_DISMISS_MESSAGE_TYPE }, sender())
    await forgetMediumNoticeTab(5)
    await handleNavigation({ url: MEDIUM_URL, tabId: 5, frameId: 0 })
    expect(await handleNoticeMessage(query, sender())).not.toEqual({ notice: null })
  })

  it('"Confiar en este sitio" usa la dirección analizada (no una que mande la página) y limpia la insignia', async () => {
    await handleNavigation({ url: MEDIUM_URL, tabId: 5, frameId: 0 })

    expect(await handleNoticeMessage({ type: NOTICE_TRUST_MESSAGE_TYPE }, sender())).toEqual({
      ok: true,
    })
    expect((await getTrustedSites()).map((site) => site.hostname)).toEqual([
      'paypal.com.login.example',
    ])
    expect(badgeTexts.at(-1)).toEqual({ tabId: 5, text: '' })
    expect(await handleNoticeMessage(query, sender())).toEqual({ notice: null })
  })

  it('sin aviso guardado, "confiar" no agrega nada', async () => {
    expect(await handleNoticeMessage({ type: NOTICE_TRUST_MESSAGE_TYPE }, sender())).toEqual({
      ok: false,
    })
    expect(await getTrustedSites()).toEqual([])
  })

  it('isSameDocument ignora el fragmento y el usuario/contraseña, pero no la ruta ni la consulta', () => {
    expect(isSameDocument('https://a.example/x?q=1', 'https://a.example/x?q=1#arriba')).toBe(true)
    expect(isSameDocument('https://u@a.example/x', 'https://a.example/x')).toBe(true)
    expect(isSameDocument('https://a.example/x', 'https://a.example/y')).toBe(false)
    expect(isSameDocument('https://a.example/x?q=1', 'https://a.example/x?q=2')).toBe(false)
    expect(isSameDocument('https://a.example/', 'http://a.example/')).toBe(false)
  })
})

describe('aviso de nivel medio — history.pushState (misma página, otra dirección)', () => {
  it('si la dirección nueva resulta de nivel bajo: retira el aviso, limpia la insignia y avisa a la página', async () => {
    await handleNavigation({ url: MEDIUM_URL, tabId: 5, frameId: 0 })
    tabMessages = []

    // La función no depende del origen; en una página real el origen no cambia
    // con pushState, pero el nivel puede cambiar con la ruta.
    await handleSameDocumentNavigation({ url: LOW_URL, tabId: 5, frameId: 0 })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(await handleNoticeMessage(query, sender({ url: LOW_URL }))).toEqual({ notice: null })
    expect(await handleNoticeMessage(query, sender())).toEqual({ notice: null })
    expect(badgeTexts.at(-1)).toEqual({ tabId: 5, text: '' })
    expect(tabMessages).toEqual([
      { tabId: 5, message: { type: NOTICE_READY_MESSAGE_TYPE }, frameId: 0 },
    ])
  })

  it('usa la dirección actual de la pestaña (sender.tab.url), que Chrome sí actualiza tras pushState', async () => {
    await handleNavigation({ url: MEDIUM_URL, tabId: 5, frameId: 0 })
    const next = 'https://paypal.com.login.example/ayuda'
    await handleSameDocumentNavigation({ url: next, tabId: 5, frameId: 0 })

    // sender.url se queda con la dirección de carga; la de la pestaña es la nueva.
    const fromPage = sender({ url: MEDIUM_URL, tab: { id: 5, url: next } as chrome.tabs.Tab })
    expect(await handleNoticeMessage(query, fromPage)).not.toEqual({ notice: null })
  })

  it('misma página, otra ruta: el aviso de la dirección anterior deja de valer', async () => {
    await handleNavigation({ url: MEDIUM_URL, tabId: 5, frameId: 0 })
    const next = 'https://paypal.com.login.example/ayuda'
    await handleSameDocumentNavigation({ url: next, tabId: 5, frameId: 0 })

    // La página ya está en `next`: una consulta desde la dirección vieja no recibe aviso…
    expect(await handleNoticeMessage(query, sender())).toEqual({ notice: null })
    // …y la nueva vuelve a consultar el nivel (aquí sigue siendo "medio").
    expect(await handleNoticeMessage(query, sender({ url: next }))).not.toEqual({ notice: null })
  })

  it('pasar a otra dirección que sigue siendo "medio" deja el aviso para la dirección nueva', async () => {
    await handleNavigation({ url: LOW_URL, tabId: 5, frameId: 0 })
    const next = 'https://paypal.com.login.example/verificar'

    await handleSameDocumentNavigation({ url: next, tabId: 5, frameId: 0 })

    const response = (await handleNoticeMessage(query, sender({ url: next }))) as {
      notice: MediumNoticeContent | null
    }
    expect(response.notice?.verdict).toBe('Ten cuidado con este sitio')
    expect(badgeTexts.at(-1)).toEqual({ tabId: 5, text: '!' })
  })

  it('ignora iframes y esquemas que no son http(s)', async () => {
    await handleNavigation({ url: MEDIUM_URL, tabId: 5, frameId: 0 })
    await handleSameDocumentNavigation({ url: LOW_URL, tabId: 5, frameId: 2 })
    await handleSameDocumentNavigation({ url: 'about:blank', tabId: 5, frameId: 0 })
    expect(await handleNoticeMessage(query, sender())).not.toEqual({ notice: null })
  })
})
