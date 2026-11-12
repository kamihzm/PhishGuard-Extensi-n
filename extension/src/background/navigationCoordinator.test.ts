import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPopupGuard } from '../webProtection/popups/popupGuard'
import type { AdEvidence, UserIntent } from '../webProtection/popups/types'
import {
  executeUnlessHandled,
  MAX_HOLD_MS,
  setActionHoldProvider,
  type HoldResult,
} from './navigationCoordinator'

const never = () => new Promise<void>(() => undefined)

describe('coordinador de acciones: solo sincroniza la EJECUCIÓN', () => {
  afterEach(() => setActionHoldProvider(null))

  it('sin proveedor: ejecuta la acción inmediatamente', async () => {
    const action = vi.fn(async () => undefined)
    expect(await executeUnlessHandled(1, action)).toBe('executed')
    expect(action).toHaveBeenCalledOnce()
  })

  it('pestaña no observada (hold null): ejecuta', async () => {
    setActionHoldProvider({ hold: () => null })
    const action = vi.fn(async () => undefined)
    expect(await executeUnlessHandled(1, action)).toBe('executed')
  })

  it('popup confirmado por Web Protection: NO ejecuta', async () => {
    setActionHoldProvider({ hold: () => Promise.resolve<HoldResult>('handled-by-web-protection') })
    const action = vi.fn(async () => undefined)
    expect(await executeUnlessHandled(1, action)).toBe('skipped')
    expect(action).not.toHaveBeenCalled()
  })

  it('liberada (legítima, ambigua o TTL vencido): ejecuta', async () => {
    setActionHoldProvider({ hold: () => Promise.resolve<HoldResult>('release') })
    const action = vi.fn(async () => undefined)
    expect(await executeUnlessHandled(1, action)).toBe('executed')
  })

  it('fail-safe: si el proveedor lanza o rechaza, ejecuta', async () => {
    setActionHoldProvider({
      hold: () => {
        throw new Error('x')
      },
    })
    expect(
      await executeUnlessHandled(
        1,
        vi.fn(async () => undefined),
      ),
    ).toBe('executed')
    setActionHoldProvider({ hold: () => Promise.reject(new Error('y')) })
    expect(
      await executeUnlessHandled(
        1,
        vi.fn(async () => undefined),
      ),
    ).toBe('executed')
  })

  it('tope de espera: si la decisión nunca llega, ejecuta tras MAX_HOLD_MS', async () => {
    setActionHoldProvider({ hold: () => new Promise<HoldResult>(() => undefined) })
    const waits: number[] = []
    const action = vi.fn(async () => undefined)
    const result = await executeUnlessHandled(1, action, async (ms) => {
      waits.push(ms)
    })
    expect(result).toBe('executed')
    expect(waits).toEqual([MAX_HOLD_MS])
  })

  it('no importa módulos del motor de phishing ni de Web Protection', () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'navigationCoordinator.ts'),
      'utf-8',
    )
    expect(src).not.toMatch(/from\s+['"]/)
  })
})

describe('integración: Popup Guard + coordinador + acción de phishing simulada', () => {
  afterEach(() => setActionHoldProvider(null))

  const evidence: AdEvidence = {
    isAdUrl: (u) => /(^|\.)adnet\.test$/.test(new URL(u).hostname),
    isException: () => false,
  }
  function setup(
    intents: UserIntent[] | null,
    closeTab: (tabId: number) => Promise<void> = vi.fn(async () => undefined),
  ) {
    let now = 1_000_000
    let timers: Array<() => void> = []
    const guard = createPopupGuard({
      isEnabled: async () => true,
      queryIntents: async () => intents,
      getTabUrl: async () => 'https://anime.test/serie/1/',
      getTab: async () => null,
      getTabSize: async () => null,
      getFrameUrl: async () => null,
      takeIntentRecord: async () => null,
      getIntentToken: async () => null,
      loadEvidence: async () => evidence,
      closeTab,
      goBack: async () => undefined,
      now: () => now,
      // Como `setTimeout`/`clearTimeout` reales: la cancelación quita el temporizador.
      schedule: (fn) => {
        timers.push(fn)
        return () => {
          timers = timers.filter((t) => t !== fn)
        }
      },
      log: () => undefined,
    })
    setActionHoldProvider({ hold: (tabId) => guard.hold(tabId) })
    return {
      guard,
      closeTab,
      fireTimers: () => timers.splice(0).forEach((f) => f()),
      at: () => now,
      advance: (ms: number) => (now += ms),
    }
  }
  const plainClick = (at: number): UserIntent => ({
    kind: 'click',
    at: at - 5,
    newTab: false,
    expectedUrl: 'https://anime.test/serie/2/',
    form: false,
  })

  it('salto marcado por phishing → evidencia de lista: Web Protection cierra y la advertencia NO se abre', async () => {
    const ctx = setup([plainClick(1_000_000)])
    const created = ctx.guard.onCreatedNavigationTarget({
      sourceTabId: 1,
      sourceFrameId: 0,
      tabId: 9,
      url: 'https://risky-hop.test/cx',
      timeStamp: ctx.at(),
    })
    const phishingAction = vi.fn(async () => undefined)
    // El motor de phishing intenta actuar sobre la ventana mientras está en POPUP_PENDING.
    const execution = executeUnlessHandled(9, phishingAction, never)
    await created
    ctx.guard.onMainFrameRequest(9, 'https://pxl.adnet.test/r')
    expect(await execution).toBe('skipped')
    expect(phishingAction).not.toHaveBeenCalled()
    expect(ctx.closeTab).toHaveBeenCalledWith(9)
  })

  it('popup confirmado pero el cierre falla (pestaña inexistente): la advertencia de phishing SÍ se ejecuta', async () => {
    const closeTab = vi.fn(async () => {
      throw new Error('No tab with id: 12.')
    })
    const ctx = setup([plainClick(1_000_000)], closeTab)
    const created = ctx.guard.onCreatedNavigationTarget({
      sourceTabId: 1,
      sourceFrameId: 0,
      tabId: 12,
      url: 'https://risky-hop.test/cx',
      timeStamp: ctx.at(),
    })
    const phishingAction = vi.fn(async () => undefined)
    const execution = executeUnlessHandled(12, phishingAction, never)
    await created
    ctx.guard.onMainFrameRequest(12, 'https://pxl.adnet.test/r')
    expect(await execution).toBe('executed')
    expect(phishingAction).toHaveBeenCalledOnce()
    expect(closeTab).toHaveBeenCalledWith(12)
  })

  it('TTL vencido mientras el cierre está en curso y luego el cierre falla: la advertencia se ejecuta una vez, tras el fallo', async () => {
    let failClose: (e: Error) => void = () => undefined
    const closeTab = vi.fn(
      () => new Promise<void>((_resolve, reject) => (failClose = reject)),
    )
    const ctx = setup([plainClick(1_000_000)], closeTab)
    const created = ctx.guard.onCreatedNavigationTarget({
      sourceTabId: 1,
      sourceFrameId: 0,
      tabId: 13,
      url: 'https://risky-hop.test/cx',
      timeStamp: ctx.at(),
    })
    const phishingAction = vi.fn(async () => undefined)
    const execution = executeUnlessHandled(13, phishingAction, never)
    await created
    ctx.guard.onMainFrameRequest(13, 'https://pxl.adnet.test/r')
    await vi.waitFor(() => expect(closeTab).toHaveBeenCalledWith(13))
    ctx.fireTimers()
    await new Promise((r) => setTimeout(r, 0)) // vacía todas las microtareas pendientes
    expect(phishingAction).not.toHaveBeenCalled()
    failClose(new Error('No tab with id: 13.'))
    expect(await execution).toBe('executed')
    expect(phishingAction).toHaveBeenCalledOnce()
  })

  it('salto marcado por phishing SIN evidencia: al vencer el TTL se ejecuta la advertencia', async () => {
    const ctx = setup([plainClick(1_000_000)])
    const created = ctx.guard.onCreatedNavigationTarget({
      sourceTabId: 1,
      sourceFrameId: 0,
      tabId: 10,
      url: 'https://risky-hop.test/cx',
      timeStamp: ctx.at(),
    })
    const phishingAction = vi.fn(async () => undefined)
    const execution = executeUnlessHandled(10, phishingAction, never)
    await created
    ctx.guard.onMainFrameRequest(10, 'https://benign.test/')
    ctx.fireTimers()
    expect(await execution).toBe('executed')
    expect(phishingAction).toHaveBeenCalledOnce()
    expect(ctx.closeTab).not.toHaveBeenCalled()
  })

  it('ventana pedida por el usuario (Ctrl+clic) hacia un sitio peligroso: la advertencia se ejecuta sin esperar', async () => {
    const ctx = setup([
      { ...plainClick(1_000_000), newTab: true, expectedUrl: 'https://risky-hop.test/cx' },
    ])
    const created = ctx.guard.onCreatedNavigationTarget({
      sourceTabId: 1,
      sourceFrameId: 0,
      tabId: 11,
      url: 'https://risky-hop.test/cx',
      timeStamp: ctx.at(),
    })
    const phishingAction = vi.fn(async () => undefined)
    const execution = executeUnlessHandled(11, phishingAction, never)
    await created
    expect(await execution).toBe('executed')
  })

  it('navegación normal en una pestaña no observada: la advertencia se ejecuta como siempre', async () => {
    setup(null)
    expect(
      await executeUnlessHandled(
        42,
        vi.fn(async () => undefined),
        never,
      ),
    ).toBe('executed')
  })
})
