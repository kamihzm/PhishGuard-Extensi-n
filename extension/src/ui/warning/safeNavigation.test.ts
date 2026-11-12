import { beforeEach, describe, expect, it } from 'vitest'
import { goToSafety } from './safeNavigation'

const BLOCKED_URL = 'https://xn--pypal-4ve.com/account'
const SAFE_URL = 'https://webmail.example.com/inbox'

interface TabsUpdateCall {
  tabId: number
  url: string | undefined
}

let updateCalls: TabsUpdateCall[]
let removeCalls: number[]
let removeShouldThrow: boolean
let updateShouldThrowFor: Set<string>

function installTabsStub(): void {
  updateCalls = []
  removeCalls = []
  removeShouldThrow = false
  updateShouldThrowFor = new Set()

  ;(globalThis as unknown as { chrome: unknown }).chrome = {
    tabs: {
      update: async (tabId: number, updateProperties: { url?: string }) => {
        if (updateProperties.url && updateShouldThrowFor.has(updateProperties.url)) {
          throw new Error(`no se pudo navegar a ${updateProperties.url}`)
        }
        updateCalls.push({ tabId, url: updateProperties.url })
      },
      remove: async (tabId: number) => {
        if (removeShouldThrow) throw new Error('no se pudo cerrar la pestaña')
        removeCalls.push(tabId)
      },
    },
  }
}

beforeEach(() => {
  installTabsStub()
})

describe('goToSafety', () => {
  it('vuelve a la página anterior cuando hay una URL segura conocida (historial útil)', async () => {
    await goToSafety(7, SAFE_URL, BLOCKED_URL)

    expect(updateCalls).toEqual([{ tabId: 7, url: SAFE_URL }])
    expect(removeCalls).toHaveLength(0)
  })

  it('sin historial útil (safeReturnUrl undefined), cierra la pestaña', async () => {
    await goToSafety(7, undefined, BLOCKED_URL)

    expect(removeCalls).toEqual([7])
    expect(updateCalls).toHaveLength(0)
  })

  it('nunca vuelve a la misma URL bloqueada, aunque llegue como safeReturnUrl por error: cae al cierre de pestaña', async () => {
    await goToSafety(7, BLOCKED_URL, BLOCKED_URL)

    expect(updateCalls.some((c) => c.url === BLOCKED_URL)).toBe(false)
    expect(removeCalls).toEqual([7])
  })

  it('no genera loop: si cerrar la pestaña falla, cae a chrome://newtab/ en vez de reintentar la URL bloqueada', async () => {
    removeShouldThrow = true

    await goToSafety(7, undefined, BLOCKED_URL)

    expect(updateCalls).toEqual([{ tabId: 7, url: 'chrome://newtab/' }])
    expect(updateCalls.some((c) => c.url === BLOCKED_URL)).toBe(false)
  })

  it('si además chrome://newtab/ falla, prueba con about:blank como último respaldo', async () => {
    removeShouldThrow = true
    updateShouldThrowFor.add('chrome://newtab/')

    await goToSafety(7, undefined, BLOCKED_URL)

    expect(updateCalls).toEqual([{ tabId: 7, url: 'about:blank' }])
  })
})
