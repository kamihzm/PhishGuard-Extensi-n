import { beforeEach, describe, expect, it } from 'vitest'
import { clearBadge, updateBadge } from './badge'

interface BadgeCall {
  method: 'setBadgeText' | 'setBadgeBackgroundColor' | 'setBadgeTextColor' | 'setTitle'
  args: Record<string, unknown>
}

let calls: BadgeCall[]

function installChromeStub(): void {
  calls = []
  ;(globalThis as unknown as { chrome: unknown }).chrome = {
    action: {
      setBadgeText: async (args: Record<string, unknown>) => {
        calls.push({ method: 'setBadgeText', args })
      },
      setBadgeBackgroundColor: async (args: Record<string, unknown>) => {
        calls.push({ method: 'setBadgeBackgroundColor', args })
      },
      setBadgeTextColor: async (args: Record<string, unknown>) => {
        calls.push({ method: 'setBadgeTextColor', args })
      },
      setTitle: async (args: Record<string, unknown>) => {
        calls.push({ method: 'setTitle', args })
      },
    },
  }
}

beforeEach(() => {
  installChromeStub()
})

describe('badge', () => {
  it('bajo: sin texto en la insignia, con título en español que no dice "seguro"', async () => {
    await updateBadge(7, 'low', true)
    expect(calls).toContainEqual({ method: 'setBadgeText', args: { tabId: 7, text: '' } })
    expect(calls).toContainEqual({
      method: 'setTitle',
      args: { tabId: 7, title: 'PhishGuard: no encontramos señales de riesgo en este sitio' },
    })
    expect(JSON.stringify(calls)).not.toMatch(/segur/i)
  })

  it('medio: "!" sobre ámbar oscuro con texto blanco y título que invita a abrir', async () => {
    await updateBadge(7, 'medium', true)
    expect(calls).toEqual([
      { method: 'setBadgeText', args: { tabId: 7, text: '!' } },
      { method: 'setBadgeBackgroundColor', args: { tabId: 7, color: '#b45309' } },
      { method: 'setBadgeTextColor', args: { tabId: 7, color: '#ffffff' } },
      {
        method: 'setTitle',
        args: {
          tabId: 7,
          title: 'PhishGuard: ten cuidado con este sitio. Abre PhishGuard para ver por qué',
        },
      },
    ])
  })

  it('alto: "!!" sobre rojo con texto blanco y título en español', async () => {
    await updateBadge(7, 'high', true)
    expect(calls).toContainEqual({ method: 'setBadgeText', args: { tabId: 7, text: '!!' } })
    expect(calls).toContainEqual({
      method: 'setBadgeBackgroundColor',
      args: { tabId: 7, color: '#b91c1c' },
    })
    expect(calls).toContainEqual({
      method: 'setTitle',
      args: { tabId: 7, title: 'PhishGuard: este sitio podría robar tus datos' },
    })
  })

  it('showBadgeEnabled=false limpia la insignia y deja el título por defecto', async () => {
    await updateBadge(7, 'high', false)

    expect(calls).toEqual([
      { method: 'setBadgeText', args: { tabId: 7, text: '' } },
      { method: 'setTitle', args: { tabId: 7, title: 'PhishGuard' } },
    ])
  })

  it('clearBadge limpia el texto y restablece el título', async () => {
    await clearBadge(7)

    expect(calls).toEqual([
      { method: 'setBadgeText', args: { tabId: 7, text: '' } },
      { method: 'setTitle', args: { tabId: 7, title: 'PhishGuard' } },
    ])
  })
})

/**
 * Carrera real reportada (Fase 1, `docs/dom-overlay-scoring.md`): la
 * pestaña se cierra (ej. Popup Early Gate, `chrome.tabs.remove()`) mientras
 * `handleNavigation` todavía tiene un `updateBadge`/`clearBadge` en vuelo
 * para esa MISMA pestaña — Chrome rechaza con "No tab with id: <id>".
 */
describe('badge — carrera con tabs.remove() (Fase 1)', () => {
  function installFailingChromeStub(errorMessage: string): void {
    calls = []
    ;(globalThis as unknown as { chrome: unknown }).chrome = {
      action: {
        setBadgeText: async () => {
          throw new Error(errorMessage)
        },
        setBadgeBackgroundColor: async () => {
          throw new Error(errorMessage)
        },
        setBadgeTextColor: async () => {
          throw new Error(errorMessage)
        },
        setTitle: async () => {
          throw new Error(errorMessage)
        },
      },
    }
  }

  it('updateBadge NO lanza si la pestaña ya no existe ("No tab with id: 42")', async () => {
    installFailingChromeStub('No tab with id: 42.')
    await expect(updateBadge(42, 'high', true)).resolves.toBeUndefined()
  })

  it('clearBadge NO lanza si la pestaña ya no existe', async () => {
    installFailingChromeStub('No tab with id: 42.')
    await expect(clearBadge(42)).resolves.toBeUndefined()
  })

  it('showBadgeEnabled=false (clearBadge interno de updateBadge) tampoco lanza si la pestaña ya no existe', async () => {
    installFailingChromeStub('No tab with id: 42.')
    await expect(updateBadge(42, 'high', false)).resolves.toBeUndefined()
  })

  it('un error DISTINTO (no relacionado con la pestaña inexistente) SÍ se propaga — nunca se esconden errores reales', async () => {
    installFailingChromeStub('Some other unrelated failure')
    await expect(updateBadge(42, 'high', true)).rejects.toThrow('Some other unrelated failure')
  })
})
