import { beforeEach, describe, expect, it } from 'vitest'
import { badgeStateKey, clearBadge, forgetBadge, reapplyBadge, updateBadge } from './badge'

/**
 * Insignia que se pierde al navegar (prueba con sitios reales, 2026-10-06):
 * Chrome borra los valores de la insignia propios de la pestaña cuando la
 * navegación se confirma, y la insignia se escribe antes, en onBeforeNavigate.
 * El stub imita a Chrome: guarda los valores por pestaña y `chromeClears(tab)`
 * los borra como lo hace la confirmación de la navegación.
 */
interface TabBadge {
  text?: string
  color?: string
  textColor?: string
  title?: string
}

let tabs: Map<number, TabBadge>
let session: Map<string, unknown>
let sessionFails: boolean
/** Si se define, se ejecuta después de setBadgeText (para simular la confirmación en medio). */
let afterText: (() => void) | undefined

function chromeClears(tabId: number): void {
  tabs.delete(tabId)
}

function installChromeStub(): void {
  tabs = new Map()
  session = new Map()
  sessionFails = false
  afterText = undefined
  const tab = (id: number): TabBadge => {
    if (!tabs.has(id)) tabs.set(id, {})
    return tabs.get(id)!
  }
  ;(globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      session: {
        get: async (key: string) => {
          if (sessionFails) throw new Error('storage no disponible')
          return session.has(key) ? { [key]: session.get(key) } : {}
        },
        set: async (items: Record<string, unknown>) => {
          if (sessionFails) throw new Error('storage no disponible')
          for (const [k, v] of Object.entries(items)) session.set(k, v)
        },
        remove: async (key: string) => {
          session.delete(key)
        },
      },
    },
    action: {
      setBadgeText: async ({ tabId, text }: { tabId: number; text: string }) => {
        tab(tabId).text = text
        afterText?.()
      },
      setBadgeBackgroundColor: async ({ tabId, color }: { tabId: number; color: string }) => {
        tab(tabId).color = color
      },
      setBadgeTextColor: async ({ tabId, color }: { tabId: number; color: string }) => {
        tab(tabId).textColor = color
      },
      setTitle: async ({ tabId, title }: { tabId: number; title: string }) => {
        tab(tabId).title = title
      },
    },
  }
}

beforeEach(() => {
  installChromeStub()
})

const MEDIUM = {
  text: '!',
  color: '#b45309',
  textColor: '#ffffff',
  title: 'PhishGuard: ten cuidado con este sitio. Abre PhishGuard para ver por qué',
}
const HIGH = {
  text: '!!',
  color: '#b91c1c',
  textColor: '#ffffff',
  title: 'PhishGuard: este sitio podría robar tus datos',
}

describe('reapplyBadge: la insignia sobrevive a la confirmación de la navegación', () => {
  it('Chrome la borra al confirmar → onCommitted la vuelve a poner completa', async () => {
    await updateBadge(5, 'medium', true)
    chromeClears(5)
    expect(tabs.get(5)).toBeUndefined()

    await reapplyBadge(5, 'https://paypal.com.login.example/')

    expect(tabs.get(5)).toEqual(MEDIUM)
  })

  it('si la confirmación cae entre setBadgeText y el resto (se pierde solo el "!"), se repone', async () => {
    afterText = () => {
      afterText = undefined
      chromeClears(5)
    }
    await updateBadge(5, 'medium', true)
    expect(tabs.get(5)?.text).toBeUndefined() // el caso visto: color y título sí, "!" no

    await reapplyBadge(5, 'https://paypal.com.login.example/')

    expect(tabs.get(5)).toEqual(MEDIUM)
  })

  it('el estado se guarda ANTES de tocar la insignia', async () => {
    afterText = () => {
      expect(session.get(badgeStateKey(5))).toBe('high')
    }
    await updateBadge(5, 'high', true)
    expect(tabs.get(5)).toEqual(HIGH)
  })

  it('onCompleted repite lo mismo (dos reposiciones no cambian el resultado)', async () => {
    await updateBadge(5, 'high', true)
    chromeClears(5)
    await reapplyBadge(5, 'https://example.com/')
    await reapplyBadge(5, 'https://example.com/')
    expect(tabs.get(5)).toEqual(HIGH)
  })

  it('bajo: se repone el título en español (texto vacío)', async () => {
    await updateBadge(5, 'low', true)
    chromeClears(5)
    await reapplyBadge(5, 'https://www.youtube.com/watch?v=x')
    expect(tabs.get(5)).toEqual({
      text: '',
      color: '#15803d',
      textColor: '#ffffff',
      title: 'PhishGuard: no encontramos señales de riesgo en este sitio',
    })
  })

  it('insignia limpia (sitio confiable o protección apagada) se repone limpia', async () => {
    await clearBadge(5)
    chromeClears(5)
    await reapplyBadge(5, 'https://example.com/')
    expect(tabs.get(5)).toEqual({ text: '', title: 'PhishGuard' })
  })

  it('showBadgeEnabled=false también se guarda como insignia limpia', async () => {
    await updateBadge(5, 'high', false)
    expect(session.get(badgeStateKey(5))).toBeNull()
  })

  it('sin estado guardado (la decisión de esta navegación aún no llega) no hace nada', async () => {
    await reapplyBadge(5, 'https://example.com/')
    expect(tabs.get(5)).toBeUndefined()
  })

  it('forgetBadge borra el estado: no se repone el nivel de la página anterior', async () => {
    await updateBadge(5, 'high', true)
    await forgetBadge(5)
    chromeClears(5)
    await reapplyBadge(5, 'https://otra-pagina.example/')
    expect(tabs.get(5)).toBeUndefined()
  })

  it('no toca páginas que no son http(s): la advertencia pone su propia insignia', async () => {
    await updateBadge(5, 'high', true)
    chromeClears(5)
    await reapplyBadge(5, 'chrome-extension://id/src/ui/warning/warning.html?id=1')
    await reapplyBadge(5, 'chrome://newtab/')
    expect(tabs.get(5)).toBeUndefined()
  })

  it('cada pestaña tiene su propio estado', async () => {
    await updateBadge(1, 'medium', true)
    await updateBadge(2, 'high', true)
    chromeClears(1)
    chromeClears(2)
    await reapplyBadge(1, 'https://a.example/')
    await reapplyBadge(2, 'https://b.example/')
    expect(tabs.get(1)).toEqual(MEDIUM)
    expect(tabs.get(2)).toEqual(HIGH)
  })

  it('un fallo de chrome.storage.session no impide poner la insignia', async () => {
    sessionFails = true
    await expect(updateBadge(5, 'medium', true)).resolves.toBeUndefined()
    expect(tabs.get(5)).toEqual(MEDIUM)
    await expect(reapplyBadge(5, 'https://example.com/')).resolves.toBeUndefined()
  })

  it('ignora un estado guardado que no es un nivel válido', async () => {
    session.set(badgeStateKey(5), 'rojo')
    await reapplyBadge(5, 'https://example.com/')
    expect(tabs.get(5)).toBeUndefined()
  })
})
