import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isAtOpenerEdge, isPastOpenerFarEdge, type WindowBounds } from './popupClassifier'
import { createPopupGuard, type PopupGuardDeps } from './popupGuard'
import type { PopupWindowGeometry } from './popupState'
import type { TabSnapshot } from './redirectGuard'
import type { AdEvidence, UserIntent } from './types'

const evidence: AdEvidence = {
  isAdUrl: (u) => /(^|\.)adnet\.test$/.test(new URL(u).hostname),
  isException: () => false,
}
const SOURCE_TAB = 1
let now = 100_000
const click = (over: Partial<UserIntent> = {}): UserIntent => ({
  kind: 'click',
  at: now - 5,
  newTab: false,
  expectedUrl: 'https://anime.test/serie/2/',
  form: false,
  ...over,
})

let timers: Array<() => void> = []
const fireTimers = () => timers.splice(0).forEach((fn) => fn())

function setup(over: Partial<PopupGuardDeps> = {}) {
  timers = []
  const deps = {
    isEnabled: vi.fn(async () => true),
    queryIntents: vi.fn(async (): Promise<UserIntent[] | null> => [click()]),
    getTabUrl: vi.fn(async () => 'https://anime.test/serie/1/'),
    getTab: vi.fn(async (): Promise<TabSnapshot | null> => null),
    getTabSize: vi.fn(async (): Promise<{ width: number; height: number } | null> => ({
      width: 131,
      height: 110,
    })),
    getFrameUrl: vi.fn(async (): Promise<string | null> => 'about:blank'),
    takeIntentRecord: vi.fn(async (): Promise<unknown> => null),
    getIntentToken: vi.fn(async (): Promise<string | null> => null),
    loadEvidence: vi.fn(async () => evidence),
    closeTab: vi.fn(async () => undefined),
    goBack: vi.fn(async () => undefined),
    now: () => now,
    schedule: vi.fn((fn: () => void) => {
      timers.push(fn)
      return () => undefined
    }),
    log: vi.fn(),
    ...over,
  }
  const guard = createPopupGuard(deps)
  // La pestaña de origen ya tiene una página confirmada.
  void guard.onCommitted(SOURCE_TAB, 0, 'https://anime.test/serie/1/', 'link', [])
  return { guard, deps }
}
const created = (tabId: number, url: string) => ({
  sourceTabId: SOURCE_TAB,
  sourceFrameId: 0,
  tabId,
  url,
  timeStamp: now,
})

describe('Popup Guard: ventanas nuevas', () => {
  beforeEach(() => {
    now += 60_000
  })

  it('ventana publicitaria confirmada: cierra ESA pestaña, nunca la de origen', async () => {
    const { guard, deps } = setup()
    await guard.onCreatedNavigationTarget(created(7, 'https://adnet.test/c'))
    expect(deps.closeTab).toHaveBeenCalledTimes(1)
    expect(deps.closeTab).toHaveBeenCalledWith(7)
    expect(deps.closeTab).not.toHaveBeenCalledWith(SOURCE_TAB)
  })

  it('evidencia que llega después por una redirección de servidor (webRequest)', async () => {
    const { guard, deps } = setup()
    await guard.onCreatedNavigationTarget(created(8, 'https://rnd-hop.test/'))
    expect(deps.closeTab).not.toHaveBeenCalled()
    guard.onMainFrameRequest(8, 'https://pxl.adnet.test/r')
    await vi.waitFor(() => expect(deps.closeTab).toHaveBeenCalledWith(8))
  })

  it('evidencia en una navegación posterior de la ventana (redirección de cliente)', async () => {
    const { guard, deps } = setup()
    await guard.onCreatedNavigationTarget(created(9, 'https://rnd-hop.test/'))
    await guard.onBeforeNavigate(9, 0, 'https://adnet.test/landing', now + 100)
    await vi.waitFor(() => expect(deps.closeTab).toHaveBeenCalledWith(9))
  })

  it('redirector propio (mismo sitio) que responde 302 hacia una red listada: se cierra (P3)', async () => {
    const { guard, deps } = setup()
    await guard.onCreatedNavigationTarget(created(30, 'https://anime.test/out?to=1'))
    guard.onMainFrameRequest(30, 'https://anime.test/out?to=1')
    guard.onServerRedirect(30, 'https://adnet.test/landing', 302)
    guard.onMainFrameRequest(30, 'https://adnet.test/landing')
    await vi.waitFor(() => expect(deps.closeTab).toHaveBeenCalledWith(30))
    expect(deps.closeTab).not.toHaveBeenCalledWith(SOURCE_TAB)
  })

  it('ventana del mismo sitio ya cargada: un clic del usuario hacia una red listada no la cierra (P3)', async () => {
    const { guard, deps } = setup()
    await guard.onCreatedNavigationTarget(created(31, 'https://anime.test/galeria'))
    await guard.onCommitted(31, 0, 'https://anime.test/galeria', 'link', [])
    now += 2_000
    await guard.onBeforeNavigate(31, 0, 'https://adnet.test/deal', now)
    guard.onMainFrameRequest(31, 'https://adnet.test/deal')
    await guard.onCommitted(31, 0, 'https://adnet.test/deal', 'link', [])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(deps.closeTab).not.toHaveBeenCalled()
    expect(deps.goBack).not.toHaveBeenCalled()
    // La observación sigue viva (no pasó al Redirect Guard): decidió el Popup Guard.
    expect(guard.state.observations.has(31)).toBe(true)
  })

  it('sin evidencia (SUSPICIOUS): se permite', async () => {
    const { guard, deps } = setup()
    await guard.onCreatedNavigationTarget(created(10, 'https://rotating.test/'))
    guard.onMainFrameRequest(10, 'https://shop.test/')
    await guard.onCommitted(10, 0, 'https://shop.test/', 'link', [])
    expect(deps.closeTab).not.toHaveBeenCalled()
  })

  it('Ctrl+clic / clic central hacia su destino: se permite', async () => {
    const { guard, deps } = setup({
      queryIntents: vi.fn(async () => [
        click({ newTab: true, expectedUrl: 'https://externo.test/doc' }),
      ]),
    })
    await guard.onCreatedNavigationTarget(created(11, 'https://externo.test/doc'))
    expect(deps.closeTab).not.toHaveBeenCalled()
  })

  it('target=_blank a un enlace externo legítimo: se permite', async () => {
    const { guard, deps } = setup({
      queryIntents: vi.fn(async () => [
        click({ newTab: true, expectedUrl: 'https://docs.test/manual' }),
      ]),
    })
    await guard.onCreatedNavigationTarget(created(12, 'https://docs.test/manual'))
    expect(deps.closeTab).not.toHaveBeenCalled()
  })

  it('fail-open: si no se puede consultar la intención, no se cierra nada', async () => {
    const { guard, deps } = setup({ queryIntents: vi.fn(async () => null) })
    await guard.onCreatedNavigationTarget(created(13, 'https://adnet.test/c'))
    expect(deps.closeTab).not.toHaveBeenCalled()
  })

  it('con "Anuncios" desactivado no hace nada (ni consulta)', async () => {
    const { guard, deps } = setup({ isEnabled: vi.fn(async () => false) })
    await guard.onCreatedNavigationTarget(created(14, 'https://adnet.test/c'))
    expect(deps.queryIntents).not.toHaveBeenCalled()
    expect(deps.closeTab).not.toHaveBeenCalled()
  })

  it('sin bucles: una pestaña se cierra una sola vez aunque lleguen más eventos', async () => {
    const { guard, deps } = setup()
    await guard.onCreatedNavigationTarget(created(15, 'https://adnet.test/c'))
    guard.onMainFrameRequest(15, 'https://adnet.test/d')
    await guard.onBeforeNavigate(15, 0, 'https://adnet.test/e', now)
    expect(deps.closeTab).toHaveBeenCalledTimes(1)
  })

  it('varias ventanas de una sola interacción: se cierra cada una confirmada', async () => {
    const { guard, deps } = setup()
    await guard.onCreatedNavigationTarget(created(16, 'https://adnet.test/1'))
    await guard.onCreatedNavigationTarget(created(17, 'https://b.adnet.test/2'))
    expect(vi.mocked(deps.closeTab).mock.calls.map((c) => c[0])).toEqual([16, 17])
  })

  it('origen no http(s) (p. ej. página de la extensión): se ignora', async () => {
    const { guard, deps } = setup({
      getTabUrl: vi.fn(async () => 'chrome-extension://x/popup.html'),
    })
    await guard.onCreatedNavigationTarget({
      ...created(18, 'https://adnet.test/c'),
      sourceTabId: 99,
    })
    expect(deps.closeTab).not.toHaveBeenCalled()
  })

  it('pestaña cerrada por el usuario: se olvida su estado', async () => {
    const { guard } = setup()
    await guard.onCreatedNavigationTarget(created(19, 'https://rnd.test/'))
    guard.onTabRemoved(19)
    expect(guard.state.observations.has(19)).toBe(false)
  })
})

describe('Popup Guard: redirecciones de la pestaña original', () => {
  beforeEach(() => {
    now += 60_000
  })

  it('página → publicidad sin intención, con evidencia: vuelve atrás UNA vez', async () => {
    const { guard, deps } = setup()
    await guard.onBeforeNavigate(SOURCE_TAB, 0, 'https://hop.test/x', now)
    guard.onMainFrameRequest(SOURCE_TAB, 'https://adnet.test/r')
    await guard.onCommitted(SOURCE_TAB, 0, 'https://advertiser.test/', 'link', ['client_redirect'])
    expect(deps.goBack).toHaveBeenCalledTimes(1)
    // Enfriamiento: otra redirección inmediata no provoca un segundo retroceso (sin bucles).
    await guard.onBeforeNavigate(SOURCE_TAB, 0, 'https://adnet.test/r2', now + 10)
    await guard.onCommitted(SOURCE_TAB, 0, 'https://adnet.test/r2', 'link', ['client_redirect'])
    expect(deps.goBack).toHaveBeenCalledTimes(1)
  })

  it('clic legítimo JKANIME → ANIME (mismo sitio): se mantiene', async () => {
    const { guard, deps } = setup()
    await guard.onBeforeNavigate(SOURCE_TAB, 0, 'https://anime.test/serie/2/', now)
    await guard.onCommitted(SOURCE_TAB, 0, 'https://anime.test/serie/2/', 'link', [])
    expect(deps.goBack).not.toHaveBeenCalled()
  })

  it.each([
    ['escrita en la barra', 'typed', []],
    ['atrás/adelante', 'link', ['forward_back']],
    ['recarga', 'reload', []],
    ['formulario', 'form_submit', []],
  ])(
    'navegación del usuario (%s) hacia un host listado: nunca se revierte',
    async (_n, type, qualifiers) => {
      const { guard, deps } = setup()
      await guard.onBeforeNavigate(SOURCE_TAB, 0, 'https://adnet.test/', now)
      await guard.onCommitted(SOURCE_TAB, 0, 'https://adnet.test/', type, qualifiers)
      expect(deps.goBack).not.toHaveBeenCalled()
    },
  )

  it('redirección a un sitio legítimo sin evidencia: se permite', async () => {
    const { guard, deps } = setup()
    await guard.onBeforeNavigate(SOURCE_TAB, 0, 'https://otro.test/', now)
    await guard.onCommitted(SOURCE_TAB, 0, 'https://otro.test/', 'link', ['client_redirect'])
    expect(deps.goBack).not.toHaveBeenCalled()
  })

  it('pestaña abierta manualmente (sin página previa): no se evalúa', async () => {
    const { guard, deps } = setup()
    await guard.onBeforeNavigate(50, 0, 'https://adnet.test/', now)
    await guard.onCommitted(50, 0, 'https://adnet.test/', 'link', [])
    expect(deps.goBack).not.toHaveBeenCalled()
    expect(deps.closeTab).not.toHaveBeenCalled()
  })
})

describe('Redirect Guard: contexto tras reiniciar el service worker (P1)', () => {
  beforeEach(() => {
    now += 60_000
  })
  // Sin `onCommitted` previo en la pestaña 70: es lo que ve un service worker recién reiniciado.
  const TAB = 70
  const hijack = async (guard: ReturnType<typeof setup>['guard']) => {
    await guard.onBeforeNavigate(TAB, 0, 'https://adnet.test/ad', now)
    await guard.onCommitted(TAB, 0, 'https://adnet.test/ad', 'link', [])
  }

  it('sin lastUrl, la pestaña aún muestra la página anterior (pendingUrl): se recupera y se revierte', async () => {
    const getTab = vi.fn(async () => ({
      url: 'https://anime.test/serie/1/',
      pendingUrl: 'https://adnet.test/ad',
    }))
    const { guard, deps } = setup({ getTab })
    await hijack(guard)
    expect(getTab).toHaveBeenCalledWith(TAB)
    expect(deps.goBack).toHaveBeenCalledWith(TAB)
  })

  it('sin lastUrl y sin navegación pendiente (ya confirmada): no se adivina la página anterior', async () => {
    const getTab = vi.fn(async () => ({ url: 'https://adnet.test/ad' }))
    const { guard, deps } = setup({ getTab })
    await hijack(guard)
    expect(deps.goBack).not.toHaveBeenCalled()
  })

  it('sin lastUrl y la pestaña anterior no es http(s) (p. ej. nueva pestaña): no se evalúa', async () => {
    const getTab = vi.fn(async () => ({
      url: 'chrome://newtab/',
      pendingUrl: 'https://adnet.test/ad',
    }))
    const { guard, deps } = setup({ getTab })
    await hijack(guard)
    expect(deps.goBack).not.toHaveBeenCalled()
  })

  it('sin lastUrl y tabs.get falla: fail-open, no se revierte', async () => {
    const getTab = vi.fn(async () => {
      throw new Error('No tab with id: 70.')
    })
    const { guard, deps } = setup({ getTab })
    await hijack(guard)
    expect(deps.goBack).not.toHaveBeenCalled()
  })

  it('sin lastUrl, destino pedido por el usuario: no se revierte', async () => {
    const getTab = vi.fn(async () => ({
      url: 'https://anime.test/serie/1/',
      pendingUrl: 'https://anime.test/serie/2/',
    }))
    const { guard, deps } = setup({ getTab })
    await guard.onBeforeNavigate(TAB, 0, 'https://anime.test/serie/2/', now)
    await guard.onCommitted(TAB, 0, 'https://anime.test/serie/2/', 'link', [])
    expect(deps.goBack).not.toHaveBeenCalled()
  })

  describe('arranque en frío: intención persistida por el content script', () => {
    // Lo que ve un worker que despierta con la navegación ya confirmada.
    const committed = vi.fn(async () => ({ url: 'https://adnet.test/ad' }))
    const persisted = (over: Record<string, unknown> = {}) => ({
      v: 1,
      token: 'tok-70',
      at: now - 15,
      kind: 'click',
      form: false,
      expectedUrl: 'https://anime.test/serie/2/',
      documentUrl: 'https://anime.test/serie/1/',
      ...over,
    })
    const coldSetup = (record: unknown, token: string | null = 'tok-70', over = {}) =>
      setup({
        getTab: committed,
        takeIntentRecord: vi.fn(async () => record),
        getIntentToken: vi.fn(async () => token),
        ...over,
      })

    it('registro válido de esta pestaña: se usa como contexto y el hijack se revierte', async () => {
      const { guard, deps } = coldSetup(persisted())
      await hijack(guard)
      expect(deps.takeIntentRecord).toHaveBeenCalledWith(TAB)
      expect(deps.goBack).toHaveBeenCalledWith(TAB)
    })

    it('sin registro: falta información, no se revierte', async () => {
      const { guard, deps } = coldSetup(null)
      await hijack(guard)
      expect(deps.goBack).not.toHaveBeenCalled()
    })

    it('token distinto (otra pestaña o registro falsificado): no se revierte', async () => {
      const { guard, deps } = coldSetup(persisted({ token: 'tok-71' }))
      await hijack(guard)
      expect(deps.goBack).not.toHaveBeenCalled()
    })

    it('sin token de sesión para la pestaña: no se revierte', async () => {
      const { guard, deps } = coldSetup(persisted(), null)
      await hijack(guard)
      expect(deps.goBack).not.toHaveBeenCalled()
    })

    it('registro vencido: no se revierte', async () => {
      const { guard, deps } = coldSetup(persisted({ at: now - 60_000 }))
      await hijack(guard)
      expect(deps.goBack).not.toHaveBeenCalled()
    })

    it('registro malformado: no se revierte', async () => {
      const { guard, deps } = coldSetup({ ...persisted(), documentUrl: 42 })
      await hijack(guard)
      expect(deps.goBack).not.toHaveBeenCalled()
    })

    it('el usuario pidió ese destino listado (afiliado): no se revierte', async () => {
      const { guard, deps } = coldSetup(persisted({ expectedUrl: 'https://adnet.test/ad' }))
      await hijack(guard)
      expect(deps.goBack).not.toHaveBeenCalled()
    })

    it('formulario enviado por el usuario: no se revierte', async () => {
      const { guard, deps } = coldSetup(
        persisted({ kind: 'submit', form: true, expectedUrl: 'https://anime.test/buscar' }),
      )
      await hijack(guard)
      expect(deps.goBack).not.toHaveBeenCalled()
    })

    it('la respuesta de la consulta (documento NUEVO) no se usa en frío', async () => {
      // El documento del anuncio podría "decir" que el usuario pidió ir ahí.
      const queryIntents = vi.fn(async () => [
        click({ expectedUrl: 'https://adnet.test/ad', at: now - 5 }),
      ])
      const { guard, deps } = coldSetup(persisted(), 'tok-70', { queryIntents })
      await hijack(guard)
      expect(deps.goBack).toHaveBeenCalledWith(TAB)
    })
  })

  describe('worker vivo: el registro persistido complementa la consulta', () => {
    const persisted = (over: Record<string, unknown> = {}) => ({
      v: 1,
      token: 'tok-70',
      at: now - 15,
      kind: 'click',
      form: false,
      expectedUrl: 'https://anime.test/serie/2/',
      documentUrl: 'https://anime.test/serie/1/',
      ...over,
    })
    const liveSetup = (record: unknown, queryIntents: PopupGuardDeps['queryIntents']) => {
      const ctx = setup({
        queryIntents,
        takeIntentRecord: vi.fn(async () => record),
        getIntentToken: vi.fn(async () => 'tok-70'),
      })
      return ctx
    }

    it('la consulta llega vacía (respondió el documento nuevo) pero el usuario pidió ese destino listado: no se revierte', async () => {
      const { guard, deps } = liveSetup(
        persisted({ expectedUrl: 'https://adnet.test/ad' }),
        vi.fn(async () => []),
      )
      await guard.onCommitted(TAB, 0, 'https://anime.test/serie/1/', 'link', [])
      await hijack(guard)
      expect(deps.goBack).not.toHaveBeenCalled()
    })

    it('la consulta no responde (intención desconocida) y el registro muestra otro destino pedido: se revierte', async () => {
      const { guard, deps } = liveSetup(persisted(), vi.fn(async () => null))
      await guard.onCommitted(TAB, 0, 'https://anime.test/serie/1/', 'link', [])
      await hijack(guard)
      expect(deps.goBack).toHaveBeenCalledWith(TAB)
    })

    it('registro de otra pestaña (token distinto): se ignora y decide la consulta', async () => {
      const { guard, deps } = liveSetup(persisted({ token: 'tok-71' }), vi.fn(async () => null))
      await guard.onCommitted(TAB, 0, 'https://anime.test/serie/1/', 'link', [])
      await hijack(guard)
      expect(deps.goBack).not.toHaveBeenCalled()
    })
  })

  it('carrera: onCommitted llega antes de que onBeforeNavigate termine de leer isEnabled', async () => {
    let enable: (on: boolean) => void = () => undefined
    const isEnabled = vi.fn(() => new Promise<boolean>((r) => (enable = r)))
    const { guard, deps } = setup({ isEnabled })
    await guard.onCommitted(TAB, 0, 'https://anime.test/serie/1/', 'link', [])
    const before = guard.onBeforeNavigate(TAB, 0, 'https://adnet.test/ad', now)
    const committed = guard.onCommitted(TAB, 0, 'https://adnet.test/ad', 'link', [])
    enable(true)
    await Promise.all([before, committed])
    expect(deps.goBack).toHaveBeenCalledWith(TAB)
  })

  it('"Anuncios" desactivado: no consulta la intención ni revierte', async () => {
    const { guard, deps } = setup({ isEnabled: vi.fn(async () => false) })
    await guard.onCommitted(TAB, 0, 'https://anime.test/serie/1/', 'link', [])
    vi.mocked(deps.queryIntents).mockClear()
    await hijack(guard)
    expect(deps.queryIntents).not.toHaveBeenCalled()
    expect(deps.goBack).not.toHaveBeenCalled()
  })

  it('con lastUrl en memoria: no consulta tabs.get', async () => {
    const getTab = vi.fn(async () => null)
    const { guard, deps } = setup({ getTab })
    await guard.onCommitted(TAB, 0, 'https://anime.test/serie/1/', 'link', [])
    await hijack(guard)
    expect(getTab).not.toHaveBeenCalled()
    expect(deps.goBack).toHaveBeenCalledWith(TAB)
  })
})

describe('POPUP_PENDING y retención para el coordinador', () => {
  beforeEach(() => {
    now += 60_000
  })

  it('la observación se registra de forma SÍNCRONA (el coordinador la ve aunque consulte de inmediato)', async () => {
    const { guard } = setup()
    const pending = guard.onCreatedNavigationTarget(created(30, 'https://hop.test/'))
    expect(guard.hold(30)).not.toBeNull()
    await pending
  })

  it('no solicitada tras un clic, otro sitio, sin evidencia aún → POPUP_PENDING; evidencia → handled', async () => {
    const { guard, deps } = setup()
    await guard.onCreatedNavigationTarget(created(31, 'https://hop.test/'))
    expect(guard.state.observations.get(31)?.hold).toBe('pending')
    const hold = guard.hold(31)!
    guard.onMainFrameRequest(31, 'https://x.adnet.test/r')
    expect(await hold).toBe('handled-by-web-protection')
    expect(deps.closeTab).toHaveBeenCalledWith(31)
  })

  it('cierre confirmado: handled solo después de que closeTab resuelve', async () => {
    let finishClose: () => void = () => undefined
    const closeTab = vi.fn(() => new Promise<void>((r) => (finishClose = r)))
    const { guard } = setup({ closeTab })
    await guard.onCreatedNavigationTarget(created(41, 'https://hop.test/'))
    const hold = guard.hold(41)!
    let settled: string | undefined
    void hold.then((r) => (settled = r))
    guard.onMainFrameRequest(41, 'https://x.adnet.test/r')
    await vi.waitFor(() => expect(closeTab).toHaveBeenCalledWith(41))
    await Promise.resolve()
    expect(settled).toBeUndefined()
    finishClose()
    expect(await hold).toBe('handled-by-web-protection')
    expect(guard.state.observations.get(41)?.hold).toBe('handled')
  })

  it('cierre fallido (pestaña inexistente o error): NO queda handled, se libera', async () => {
    const closeTab = vi.fn(async () => {
      throw new Error('No tab with id: 42.')
    })
    const { guard } = setup({ closeTab })
    await guard.onCreatedNavigationTarget(created(42, 'https://hop.test/'))
    const hold = guard.hold(42)!
    guard.onMainFrameRequest(42, 'https://x.adnet.test/r')
    expect(await hold).toBe('release')
    expect(guard.state.observations.get(42)?.hold).toBe('released')
    expect(await guard.hold(42)).toBe('release')
  })

  it('onTabRemoved del propio cierre llega antes de que closeTab resuelva: sigue siendo handled', async () => {
    let finishClose: () => void = () => undefined
    const closeTab = vi.fn(() => new Promise<void>((r) => (finishClose = r)))
    const { guard } = setup({ closeTab })
    await guard.onCreatedNavigationTarget(created(43, 'https://hop.test/'))
    const hold = guard.hold(43)!
    guard.onMainFrameRequest(43, 'https://x.adnet.test/r')
    await vi.waitFor(() => expect(closeTab).toHaveBeenCalledWith(43))
    guard.onTabRemoved(43) // Chrome puede emitir onRemoved antes de resolver tabs.remove
    finishClose()
    expect(await hold).toBe('handled-by-web-protection')
  })

  describe('TTL de POPUP_PENDING durante un cierre en curso', () => {
    // Como `setTimeout`/`clearTimeout` reales: la cancelación quita el temporizador.
    const cancellableSchedule = vi.fn((fn: () => void) => {
      timers.push(fn)
      return () => {
        timers = timers.filter((t) => t !== fn)
      }
    })
    const deferredClose = () => {
      const ctl = { resolve: () => undefined as void, reject: (_e: Error) => undefined as void }
      const closeTab = vi.fn(
        () =>
          new Promise<void>((resolve, reject) => {
            ctl.resolve = resolve
            ctl.reject = reject
          }),
      )
      return { closeTab, ctl }
    }
    const logs = (deps: { log: (m: string) => void }) =>
      vi.mocked(deps.log).mock.calls.map((c) => c[0])

    it('el TTL no libera mientras closeTab está pendiente; cierre exitoso → handled', async () => {
      const { closeTab, ctl } = deferredClose()
      const { guard, deps } = setup({ closeTab, schedule: cancellableSchedule })
      await guard.onCreatedNavigationTarget(created(44, 'https://hop.test/'))
      expect(guard.state.observations.get(44)?.hold).toBe('pending')
      const hold = guard.hold(44)!
      guard.onMainFrameRequest(44, 'https://x.adnet.test/r')
      await vi.waitFor(() => expect(closeTab).toHaveBeenCalledWith(44))
      fireTimers()
      expect(guard.state.observations.get(44)?.hold).toBe('pending')
      expect(logs(deps).some((m) => m.includes('TTL de POPUP_PENDING vencido'))).toBe(false)
      expect(logs(deps).some((m) => m.includes('→ cerrada'))).toBe(false)
      ctl.resolve()
      expect(await hold).toBe('handled-by-web-protection')
      expect(guard.state.observations.get(44)?.hold).toBe('handled')
      const messages = logs(deps)
      const attempt = messages.findIndex((m) => m.includes('CONFIRMED_POPUP_AD → cerrando'))
      const closed = messages.findIndex((m) => m.includes('CONFIRMED_POPUP_AD → cerrada'))
      expect(attempt).toBeGreaterThanOrEqual(0)
      expect(closed).toBeGreaterThan(attempt)
    })

    it('el TTL no libera mientras closeTab está pendiente; cierre fallido → released', async () => {
      const { closeTab, ctl } = deferredClose()
      const { guard, deps } = setup({ closeTab, schedule: cancellableSchedule })
      await guard.onCreatedNavigationTarget(created(45, 'https://hop.test/'))
      const hold = guard.hold(45)!
      guard.onMainFrameRequest(45, 'https://x.adnet.test/r')
      await vi.waitFor(() => expect(closeTab).toHaveBeenCalledWith(45))
      fireTimers()
      expect(guard.state.observations.get(45)?.hold).toBe('pending')
      ctl.reject(new Error('No tab with id: 45.'))
      expect(await hold).toBe('release')
      expect(guard.state.observations.get(45)?.hold).toBe('released')
      expect(logs(deps).some((m) => m.includes('→ cerrada'))).toBe(false)
      expect(logs(deps).some((m) => m.includes('CONFIRMED_POPUP_AD → no se pudo cerrar'))).toBe(true)
    })
  })

  it('sin evidencia: al vencer el TTL se libera (SUSPICIOUS permitida) y no se cierra', async () => {
    const { guard, deps } = setup()
    await guard.onCreatedNavigationTarget(created(32, 'https://hop.test/'))
    const hold = guard.hold(32)!
    fireTimers()
    expect(await hold).toBe('release')
    expect(deps.closeTab).not.toHaveBeenCalled()
  })

  it('evidencia tras vencer el TTL: se cierra igual (sigue siendo publicidad confirmada)', async () => {
    const { guard, deps } = setup()
    await guard.onCreatedNavigationTarget(created(33, 'https://hop.test/'))
    fireTimers()
    guard.onMainFrameRequest(33, 'https://adnet.test/late')
    await vi.waitFor(() => expect(deps.closeTab).toHaveBeenCalledWith(33))
  })

  it.each([
    [
      'Ctrl+clic hacia su destino',
      { newTab: true, expectedUrl: 'https://externo.test/doc' },
      'https://externo.test/doc',
    ],
    [
      'clic central sin destino conocido',
      { newTab: true, expectedUrl: null },
      'https://externo.test/x',
    ],
    ['OAuth', {}, 'https://accounts.idp.test/o/oauth2/auth'],
    ['mismo sitio', {}, 'https://cdn.anime.test/player'],
    ['sin interacción reciente (abierta por temporizador)', { at: -60_000 }, 'https://hop.test/'],
  ])('%s → no entra en POPUP_PENDING (se libera de inmediato)', async (_n, over, url) => {
    const o = over as Partial<UserIntent>
    const intent = click({ ...o, at: o.at !== undefined ? now + o.at : now - 5 })
    const { guard } = setup({ queryIntents: vi.fn(async () => [intent]) })
    await guard.onCreatedNavigationTarget(created(34, url))
    expect(await guard.hold(34)).toBe('release')
  })

  it('intención desconocida → se libera (fail-open)', async () => {
    const { guard } = setup({ queryIntents: vi.fn(async () => null) })
    await guard.onCreatedNavigationTarget(created(35, 'https://hop.test/'))
    expect(await guard.hold(35)).toBe('release')
  })

  it('pendiente que resulta ser un destino legítimo (mismo sitio) → se libera antes del TTL', async () => {
    const { guard } = setup()
    await guard.onCreatedNavigationTarget(created(36, 'about:blank'))
    const hold = guard.hold(36)!
    guard.onMainFrameRequest(36, 'https://anime.test/serie/9/')
    expect(await hold).toBe('release')
  })

  it('"Anuncios" desactivado: se libera y deja de observarse', async () => {
    const { guard } = setup({ isEnabled: vi.fn(async () => false) })
    const created1 = guard.onCreatedNavigationTarget(created(37, 'https://adnet.test/'))
    const hold = guard.hold(37)!
    await created1
    expect(await hold).toBe('release')
    expect(guard.hold(37)).toBeNull()
  })

  it('pestaña cerrada mientras está pendiente → espera liberada', async () => {
    const { guard } = setup()
    await guard.onCreatedNavigationTarget(created(38, 'https://hop.test/'))
    const hold = guard.hold(38)!
    guard.onTabRemoved(38)
    expect(await hold).toBe('release')
  })

  it('estado viejo: una observación de hace > 10 s se libera y se olvida al llegar otro evento', async () => {
    const { guard } = setup()
    await guard.onCreatedNavigationTarget(created(39, 'https://hop.test/'))
    const hold = guard.hold(39)!
    now += 11_000
    await guard.onCreatedNavigationTarget(created(40, 'https://hop2.test/'))
    expect(await hold).toBe('release')
    expect(guard.hold(39)).toBeNull()
  })

  it('evento duplicado de la misma ventana: una sola observación y un solo cierre', async () => {
    const { guard, deps } = setup()
    await guard.onCreatedNavigationTarget(created(41, 'https://adnet.test/'))
    await guard.onCreatedNavigationTarget(created(41, 'https://adnet.test/'))
    expect(deps.closeTab).toHaveBeenCalledTimes(1)
  })

  it('reinicio del service worker: un guard nuevo no retiene nada (la otra acción se ejecuta)', () => {
    const { guard } = setup()
    expect(guard.hold(99)).toBeNull()
  })

  it('clics repetidos: cada ventana publicitaria se cierra una vez; sin bucle de abrir/cerrar', async () => {
    const { guard, deps } = setup()
    for (let i = 0; i < 5; i++)
      await guard.onCreatedNavigationTarget(created(50 + i, 'https://adnet.test/' + i))
    expect(vi.mocked(deps.closeTab).mock.calls.map((c) => c[0])).toEqual([50, 51, 52, 53, 54])
    guard.onMainFrameRequest(50, 'https://adnet.test/again')
    expect(deps.closeTab).toHaveBeenCalledTimes(5)
  })
})

describe('evidencia comportamental en el guard (sin evidencia de lista)', () => {
  beforeEach(() => {
    now += 60_000
  })

  it('cadena 3/3 sin evidencia de lista: NO se cierra; el comportamiento solo se registra', async () => {
    const { guard, deps } = setup()
    await guard.onCreatedNavigationTarget(created(60, 'https://jump.test/cx'))
    await guard.onBeforeNavigate(60, 0, 'https://jump.test/cx', now + 20)
    await guard.onBeforeNavigate(60, 0, 'https://linknet.test/link2', now + 400)
    guard.onServerRedirect(60, 'https://advertiser.test/', 302)
    await Promise.resolve()
    fireTimers()
    expect(deps.closeTab).not.toHaveBeenCalled()
    const log = vi
      .mocked(deps.log)
      .mock.calls.map((c) => c[0])
      .find((m) => m.includes('TTL de POPUP_PENDING vencido'))
    expect(log).toContain('SUSPICIOUS (permitida)')
    expect(log).toContain('comportamiento 3/3')
    // Privacidad: el registro no contiene URLs ni hosts.
    expect(log).not.toMatch(/https?:|\.test/)
  })

  it('window.open → 302 → sitio legítimo: no se cierra (1/3)', async () => {
    const { guard, deps } = setup()
    await guard.onCreatedNavigationTarget(created(61, 'https://hop.test/r'))
    await guard.onBeforeNavigate(61, 0, 'https://hop.test/r', now + 10)
    guard.onServerRedirect(61, 'https://legit.test/landing', 302)
    await guard.onCommitted(61, 0, 'https://legit.test/landing', 'link', ['server_redirect'])
    fireTimers()
    expect(deps.closeTab).not.toHaveBeenCalled()
  })

  it('Ctrl+clic con cadena publicitaria sin evidencia de lista: no se cierra (el usuario pidió pestaña nueva)', async () => {
    const { guard, deps } = setup({ queryIntents: vi.fn(async () => [click({ newTab: true })]) })
    await guard.onCreatedNavigationTarget(created(62, 'https://jump.test/cx'))
    await guard.onBeforeNavigate(62, 0, 'https://jump.test/cx', now + 20)
    await guard.onBeforeNavigate(62, 0, 'https://linknet.test/link2', now + 400)
    guard.onServerRedirect(62, 'https://advertiser.test/', 302)
    expect(deps.closeTab).not.toHaveBeenCalled()
  })

  it('peticiones sueltas repetidas no inflan la puntuación', async () => {
    const { guard, deps } = setup()
    await guard.onCreatedNavigationTarget(created(63, 'https://jump.test/cx'))
    guard.onMainFrameRequest(63, 'https://a-request.test/')
    guard.onMainFrameRequest(63, 'https://b-request.test/')
    guard.onMainFrameRequest(63, 'https://c-request.test/')
    expect(deps.closeTab).not.toHaveBeenCalled()
  })
})

describe('experimento popupGuardTabCreated: ventanas vistas por tabs.onCreated', () => {
  beforeEach(() => {
    now += 60_000
  })
  const tabCreated = (tabId: number, url = '') => ({
    tabId,
    openerTabId: SOURCE_TAB,
    url,
    timeStamp: now,
  })

  it('popunder about:blank → redirección de cliente con evidencia: se cierra (sin onCreatedNavigationTarget)', async () => {
    const { guard, deps } = setup()
    await guard.onTabCreated(tabCreated(20, 'about:blank'))
    await guard.onBeforeNavigate(20, 0, 'https://rnd-hop.test/', now + 60)
    await guard.onBeforeNavigate(20, 0, 'https://adnet.test/landing', now + 400)
    await vi.waitFor(() => expect(deps.closeTab).toHaveBeenCalledWith(20))
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('[origen: tabs.onCreated]'))
    expect(deps.goBack).not.toHaveBeenCalled()
  })

  it('popunder sin evidencia de lista: se permite (misma política que siempre)', async () => {
    const { guard, deps } = setup()
    await guard.onTabCreated(tabCreated(21, 'about:blank'))
    await guard.onBeforeNavigate(21, 0, 'https://rotating.test/', now + 60)
    await guard.onCommitted(21, 0, 'https://shop.test/', 'link', ['client_redirect'])
    expect(deps.closeTab).not.toHaveBeenCalled()
  })

  it('Ctrl+clic hacia su destino visto por tabs.onCreated: se permite', async () => {
    const { guard, deps } = setup({
      queryIntents: vi.fn(async () => [
        click({ newTab: true, expectedUrl: 'https://adnet.test/oferta' }),
      ]),
    })
    await guard.onTabCreated(tabCreated(22, 'https://adnet.test/oferta'))
    await guard.onBeforeNavigate(22, 0, 'https://adnet.test/oferta', now + 50)
    expect(deps.closeTab).not.toHaveBeenCalled()
  })

  it('OAuth abierto como about:blank y redirigido a /authorize: nunca se cierra', async () => {
    const { guard, deps } = setup()
    await guard.onTabCreated(tabCreated(23, ''))
    await guard.onBeforeNavigate(23, 0, 'https://accounts.idp.test/o/oauth2/authorize', now + 50)
    await guard.onBeforeNavigate(23, 0, 'https://adnet.test/after', now + 300)
    expect(deps.closeTab).not.toHaveBeenCalled()
  })

  it('si después llega onCreatedNavigationTarget: una sola observación y se suma el destino inicial', async () => {
    const { guard, deps } = setup()
    await guard.onTabCreated(tabCreated(24, ''))
    await guard.onCreatedNavigationTarget(created(24, 'https://adnet.test/c'))
    await vi.waitFor(() => expect(deps.closeTab).toHaveBeenCalledTimes(1))
    expect(deps.closeTab).toHaveBeenCalledWith(24)
  })

  it('si onCreatedNavigationTarget llegó primero: tabs.onCreated no la duplica', async () => {
    const { guard } = setup()
    await guard.onCreatedNavigationTarget(created(25, 'https://rotating.test/'))
    await guard.onTabCreated(tabCreated(25, ''))
    expect(guard.state.observations.get(25)?.origin).toBe('navigation-target')
  })
})

/**
 * T6: popunder de animeyt.cc. Chrome no emite `onCreatedNavigationTarget`; el
 * service worker lo pasa por `tabs.onCreated` SOLO si la pestaña vive en una
 * ventana `type: popup` (con su tamaño al nacer). Sin evidencia de lista: se
 * cierra solo si además nació en about:blank, es diminuta y va a otro sitio.
 */
describe('popunder (T6): ventanas type popup vistas por tabs.onCreated', () => {
  beforeEach(() => {
    now += 60_000
  })
  const TINY = { type: 'popup', width: 131, height: 110 }
  const popupWindow = (tabId: number, window: PopupWindowGeometry = TINY) => ({
    tabId,
    openerTabId: SOURCE_TAB,
    url: '',
    timeStamp: now,
    origin: 'popup-window' as const,
    window,
  })
  /** Secuencia medida en animeyt: about:blank confirmado y ~1 s después, el anuncio. */
  const bornBlankThenGo = async (
    guard: ReturnType<typeof setup>['guard'],
    tabId: number,
    to = 'https://rotating.test/?rv=1',
  ) => {
    await guard.onBeforeNavigate(tabId, 0, 'about:blank', now + 80)
    await guard.onCommitted(tabId, 0, 'about:blank', 'link', [])
    await guard.onBeforeNavigate(tabId, 0, to, now + 1100)
  }

  it('popunder diminuto nacido en about:blank → otro sitio sin lista: se cierra', async () => {
    const { guard, deps } = setup({ queryIntents: vi.fn(async () => [click({ expectedUrl: null })]) })
    await guard.onTabCreated(popupWindow(40))
    await bornBlankThenGo(guard, 40)
    await vi.waitFor(() => expect(deps.closeTab).toHaveBeenCalledWith(40))
    expect(deps.closeTab).not.toHaveBeenCalledWith(SOURCE_TAB)
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('popunder-window'))
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('[origen: ventana popup]'))
  })

  it('popup de tamaño real (OAuth 516×735) con la misma secuencia: no se cierra', async () => {
    const { guard, deps } = setup()
    await guard.onTabCreated(popupWindow(41, { type: 'popup', width: 516, height: 735 }))
    await bornBlankThenGo(guard, 41)
    await guard.onCommitted(41, 0, 'https://rotating.test/?rv=1', 'link', ['client_redirect'])
    expect(deps.closeTab).not.toHaveBeenCalled()
  })

  it('diminuta pero abierta directamente con su URL (no nació en about:blank): no se cierra', async () => {
    const { guard, deps } = setup()
    await guard.onTabCreated(popupWindow(42))
    await guard.onBeforeNavigate(42, 0, 'https://player.test/pop', now + 20)
    await guard.onCommitted(42, 0, 'https://player.test/pop', 'link', [])
    expect(deps.closeTab).not.toHaveBeenCalled()
  })

  it('diminuta, nacida en about:blank, que va al mismo sitio: no se cierra', async () => {
    const { guard, deps } = setup()
    await guard.onTabCreated(popupWindow(43))
    await bornBlankThenGo(guard, 43, 'https://anime.test/widget')
    await guard.onCommitted(43, 0, 'https://anime.test/widget', 'link', [])
    expect(deps.closeTab).not.toHaveBeenCalled()
  })

  it('onCreatedNavigationTarget(about:blank) llegó antes: el tamaño se suma a esa observación', async () => {
    const { guard, deps } = setup()
    await guard.onCreatedNavigationTarget(created(44, 'about:blank'))
    await guard.onTabCreated(popupWindow(44))
    await bornBlankThenGo(guard, 44)
    await vi.waitFor(() => expect(deps.closeTab).toHaveBeenCalledWith(44))
    expect(guard.state.observations.get(44)?.origin).toBe('navigation-target')
  })

  it('una sola observación y un solo cierre aunque lleguen ambos eventos', async () => {
    const { guard, deps } = setup()
    await guard.onTabCreated(popupWindow(45))
    await guard.onCreatedNavigationTarget(created(45, 'about:blank'))
    await bornBlankThenGo(guard, 45)
    await vi.waitFor(() => expect(deps.closeTab).toHaveBeenCalledTimes(1))
  })

  it('sigue cerrando ventanas popup con evidencia de lista (excavatenearbywand y similares)', async () => {
    const { guard, deps } = setup()
    await guard.onTabCreated(popupWindow(46, { type: 'popup', width: 800, height: 600 }))
    await guard.onBeforeNavigate(46, 0, 'https://adnet.test/c', now + 20)
    await vi.waitFor(() => expect(deps.closeTab).toHaveBeenCalledWith(46))
  })

  it('"Anuncios" desactivado: no observa ni cierra', async () => {
    const { guard, deps } = setup({ isEnabled: vi.fn(async () => false) })
    await guard.onTabCreated(popupWindow(47))
    await bornBlankThenGo(guard, 47)
    expect(deps.closeTab).not.toHaveBeenCalled()
    expect(guard.state.observations.has(47)).toBe(false)
  })

  it('la ventana creció antes de navegar (abre chica y luego se agranda): no se cierra', async () => {
    const { guard, deps } = setup({
      getTabSize: vi.fn(async () => ({ width: 600, height: 700 })),
    })
    await guard.onTabCreated(popupWindow(48))
    await bornBlankThenGo(guard, 48)
    await vi.waitFor(() => expect(deps.getTabSize).toHaveBeenCalledWith(48))
    expect(deps.closeTab).not.toHaveBeenCalled()
  })

  it('nació pegada al borde y se agranda antes de navegar (popunder real de animeyt): se cierra', async () => {
    const { guard, deps } = setup({
      getTabSize: vi.fn(async () => ({ width: 1352, height: 696 })),
    })
    await guard.onTabCreated(popupWindow(56, { ...TINY, atEdge: true }))
    await bornBlankThenGo(guard, 56)
    await vi.waitFor(() => expect(deps.closeTab).toHaveBeenCalledWith(56))
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('popunder-window'))
  })

  it('nació dentro de la ventana (no en el borde) y se agranda antes de navegar: no se cierra', async () => {
    const { guard, deps } = setup({
      getTabSize: vi.fn(async () => ({ width: 1352, height: 696 })),
    })
    await guard.onTabCreated(popupWindow(58, { ...TINY, atEdge: false }))
    await bornBlankThenGo(guard, 58)
    await vi.waitFor(() => expect(deps.getTabSize).toHaveBeenCalledWith(58))
    expect(deps.closeTab).not.toHaveBeenCalled()
  })

  it('nació pegada al borde pero ya no se puede releer el tamaño: no se cierra (fail-open)', async () => {
    const { guard, deps } = setup({ getTabSize: vi.fn(async () => null) })
    await guard.onTabCreated(popupWindow(57, { ...TINY, atEdge: true }))
    await bornBlankThenGo(guard, 57)
    await vi.waitFor(() => expect(deps.getTabSize).toHaveBeenCalledWith(57))
    expect(deps.closeTab).not.toHaveBeenCalled()
  })

  it('no se puede releer el tamaño antes de cerrar: no se cierra (fail-open)', async () => {
    const { guard, deps } = setup({ getTabSize: vi.fn(async () => null) })
    await guard.onTabCreated(popupWindow(49))
    await bornBlankThenGo(guard, 49)
    await vi.waitFor(() => expect(deps.getTabSize).toHaveBeenCalledWith(49))
    expect(deps.closeTab).not.toHaveBeenCalled()
  })

  describe('clic en un control de la página (T7: play, episodio)', () => {
    const button = () => vi.fn(async () => [click({ expectedUrl: null, control: true })])

    // Borde derecho o inferior de la ventana que la abrió (popunder real: left=1366).
    const FAR_EDGE = { ...TINY, atEdge: true, atFarEdge: true }

    it('(a) nació en el borde derecho, diminuta, en about:blank y salta a otro sitio en < 3 s: se cierra', async () => {
      const { guard, deps } = setup({ queryIntents: button() })
      await guard.onTabCreated(popupWindow(60, FAR_EDGE))
      await bornBlankThenGo(guard, 60)
      await vi.waitFor(() => expect(deps.closeTab).toHaveBeenCalledWith(60))
      expect(deps.closeTab).not.toHaveBeenCalledWith(SOURCE_TAB)
      expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('popunder-window'))
    })

    it('(a) nació en el borde derecho y se agranda antes de navegar (como el real): se cierra', async () => {
      const { guard, deps } = setup({
        queryIntents: button(),
        getTabSize: vi.fn(async () => ({ width: 1352, height: 696 })),
      })
      await guard.onTabCreated(popupWindow(61, FAR_EDGE))
      await bornBlankThenGo(guard, 61)
      await vi.waitFor(() => expect(deps.closeTab).toHaveBeenCalledWith(61))
    })

    it('nació en el borde derecho pero ya no se puede releer el tamaño: no se cierra (fail-open)', async () => {
      const { guard, deps } = setup({ queryIntents: button(), getTabSize: vi.fn(async () => null) })
      await guard.onTabCreated(popupWindow(62, FAR_EDGE))
      await bornBlankThenGo(guard, 62)
      await vi.waitFor(() => expect(deps.getTabSize).toHaveBeenCalledWith(62))
      expect(deps.closeTab).not.toHaveBeenCalled()
    })

    it('nació en el borde izquierdo o superior (p. ej. left=0, top=0 con la ventana sin maximizar): no se cierra', async () => {
      const { guard, deps } = setup({ queryIntents: button() })
      await guard.onTabCreated(popupWindow(67, { ...TINY, atEdge: true, atFarEdge: false }))
      await bornBlankThenGo(guard, 67)
      await guard.onCommitted(67, 0, 'https://rotating.test/?rv=1', 'link', [])
      fireTimers()
      expect(deps.closeTab).not.toHaveBeenCalled()
      expect(deps.log).toHaveBeenCalledWith(
        expect.stringContaining('popunder no confirmado: control(atFarEdge=false)'),
      )
    })

    it('(b) chat pequeño abierto por un botón en el centro: no se cierra', async () => {
      const { guard, deps } = setup({ queryIntents: button() })
      await guard.onTabCreated(
        popupWindow(63, { type: 'popup', width: 180, height: 140, atEdge: false, atFarEdge: false }),
      )
      await bornBlankThenGo(guard, 63, 'https://chat.test/room')
      await guard.onCommitted(63, 0, 'https://chat.test/room', 'link', [])
      fireTimers()
      expect(deps.closeTab).not.toHaveBeenCalled()
      expect(deps.log).toHaveBeenCalledWith(
        expect.stringContaining('popunder no confirmado: control(atFarEdge=false)'),
      )
    })

    it('(c) fuera del borde y la ventana crece antes de navegar: no se cierra (la frena el veto del control, antes de la relectura)', async () => {
      const getTabSize = vi.fn(async () => ({ width: 600, height: 700 }))
      const { guard, deps } = setup({ queryIntents: button(), getTabSize })
      await guard.onTabCreated(popupWindow(64, { ...TINY, atEdge: false, atFarEdge: false }))
      await bornBlankThenGo(guard, 64)
      await guard.onCommitted(64, 0, 'https://rotating.test/?rv=1', 'link', [])
      fireTimers()
      expect(deps.closeTab).not.toHaveBeenCalled()
      // Sin clic en un control, la que frena esta ventana es la relectura (test
      // T6 "nació dentro de la ventana ... se agranda"); con el control, el
      // clasificador la veta antes y la relectura ni se consulta.
      expect(getTabSize).not.toHaveBeenCalled()
      expect(deps.log).toHaveBeenCalledWith(
        expect.stringContaining('popunder no confirmado: control(atFarEdge=false)'),
      )
    })

    it('(d) no se pudo medir el borde (atFarEdge undefined): el veto se mantiene', async () => {
      const { guard, deps } = setup({ queryIntents: button() })
      await guard.onTabCreated(popupWindow(65))
      await bornBlankThenGo(guard, 65)
      await guard.onCommitted(65, 0, 'https://rotating.test/?rv=1', 'link', [])
      fireTimers()
      expect(deps.closeTab).not.toHaveBeenCalled()
      expect(deps.log).toHaveBeenCalledWith(
        expect.stringContaining('popunder no confirmado: control(atFarEdge=unmeasured)'),
      )
    })

    describe('Chrome real del usuario (T8): ventana maximizada en (-7,-7) 1552×832, pantalla 1536×864', () => {
      const MAXIMIZED = { left: -7, top: -7, width: 1552, height: 832 }
      /** Geometría como la calcula el registro de nacimientos (`windowBirth.ts`). */
      const bornAt = (popup: WindowBounds, opener: WindowBounds): PopupWindowGeometry => ({
        ...TINY,
        atEdge: isAtOpenerEdge(popup, opener),
        atFarEdge: isPastOpenerFarEdge(popup, opener),
        measure: { source: 'windows.onCreated', delayMs: 1, popup, opener },
      })
      // Crecida y escondida al releerla, como la vio el usuario (1536×816).
      const grown = () => vi.fn(async () => ({ width: 1536, height: 760 }))

      it('nacida pegada a la derecha dentro de la pantalla (left=1358, width=178) y crecida al releer: se cierra', async () => {
        const { guard, deps } = setup({ queryIntents: button(), getTabSize: grown() })
        await guard.onTabCreated(
          popupWindow(70, bornAt({ left: 1358, top: 0, width: 178, height: 182 }, MAXIMIZED)),
        )
        await bornBlankThenGo(guard, 70)
        await vi.waitFor(() => expect(deps.closeTab).toHaveBeenCalledWith(70))
        expect(deps.closeTab).not.toHaveBeenCalledWith(SOURCE_TAB)
      })

      it('sin clic en un control, nacida pegada a la derecha (atEdge false) y crecida al releer: se cierra (relectura T8)', async () => {
        const { guard, deps } = setup({
          queryIntents: vi.fn(async () => [click({ expectedUrl: null })]),
          getTabSize: grown(),
        })
        const geometry = bornAt({ left: 1358, top: 0, width: 178, height: 182 }, MAXIMIZED)
        expect(geometry.atEdge).toBe(false)
        await guard.onTabCreated(popupWindow(75, geometry))
        await bornBlankThenGo(guard, 75)
        await vi.waitFor(() => expect(deps.closeTab).toHaveBeenCalledWith(75))
      })

      it('medido en el Chrome del usuario (left=1418, ancho 146) y crecida al releer: se cierra', async () => {
        const { guard, deps } = setup({ queryIntents: button(), getTabSize: grown() })
        await guard.onTabCreated(
          popupWindow(76, bornAt({ left: 1418, top: 0, width: 146, height: 182 }, MAXIMIZED)),
        )
        await bornBlankThenGo(guard, 76)
        await vi.waitFor(() => expect(deps.closeTab).toHaveBeenCalledWith(76))
      })

      it('opener anclado a la mitad izquierda y popup centrada en la pantalla (cruza 73 px): no se cierra', async () => {
        const leftHalf = { left: 0, top: 0, width: 768, height: 816 }
        const { guard, deps } = setup({ queryIntents: button(), getTabSize: grown() })
        await guard.onTabCreated(
          popupWindow(77, bornAt({ left: 695, top: 341, width: 146, height: 182 }, leftHalf)),
        )
        await bornBlankThenGo(guard, 77)
        await guard.onCommitted(77, 0, 'https://rotating.test/?rv=1', 'link', [])
        fireTimers()
        expect(deps.closeTab).not.toHaveBeenCalled()
        expect(deps.log).toHaveBeenCalledWith(
          expect.stringContaining('popunder no confirmado: control(atFarEdge=false)'),
        )
      })

      it('sin clic en un control, opener a la mitad izquierda, popup centrada que crece: no se cierra (relectura con la misma banda)', async () => {
        const leftHalf = { left: 0, top: 0, width: 768, height: 816 }
        const getTabSize = grown()
        const { guard, deps } = setup({
          queryIntents: vi.fn(async () => [click({ expectedUrl: null })]),
          getTabSize,
        })
        await guard.onTabCreated(
          popupWindow(78, bornAt({ left: 695, top: 341, width: 146, height: 182 }, leftHalf)),
        )
        await bornBlankThenGo(guard, 78)
        // Sin control el clasificador confirma; la que decide es la relectura.
        await vi.waitFor(() => expect(getTabSize).toHaveBeenCalledWith(78))
        await new Promise((r) => setTimeout(r, 0))
        expect(deps.closeTab).not.toHaveBeenCalled()
      })

      it('popup en left=0, top=0 con la ventana de origen flotante: no se cierra', async () => {
        const floating = { left: 300, top: 120, width: 1000, height: 700 }
        const { guard, deps } = setup({ queryIntents: button(), getTabSize: grown() })
        await guard.onTabCreated(
          popupWindow(71, bornAt({ left: 0, top: 0, width: 178, height: 182 }, floating)),
        )
        await bornBlankThenGo(guard, 71)
        await guard.onCommitted(71, 0, 'https://rotating.test/?rv=1', 'link', [])
        fireTimers()
        expect(deps.closeTab).not.toHaveBeenCalled()
      })

      it('popup centrada con la ventana maximizada: no se cierra', async () => {
        const { guard, deps } = setup({ queryIntents: button(), getTabSize: grown() })
        await guard.onTabCreated(
          popupWindow(72, bornAt({ left: 679, top: 341, width: 178, height: 182 }, MAXIMIZED)),
        )
        await bornBlankThenGo(guard, 72)
        await guard.onCommitted(72, 0, 'https://rotating.test/?rv=1', 'link', [])
        fireTimers()
        expect(deps.closeTab).not.toHaveBeenCalled()
      })

      it('el log de diagnóstico trae los números de la geometría usada y la demora de la medición', async () => {
        const { guard, deps } = setup({ queryIntents: button() })
        await guard.onTabCreated(
          popupWindow(73, bornAt({ left: 679, top: 341, width: 178, height: 182 }, MAXIMIZED)),
        )
        await bornBlankThenGo(guard, 73)
        await guard.onCommitted(73, 0, 'https://rotating.test/?rv=1', 'link', [])
        fireTimers()
        expect(deps.log).toHaveBeenCalledWith(
          expect.stringContaining(
            '| geometría popup=679,341,178x182 opener=-7,-7,1552x832 fuente=windows.onCreated medida_ms=1',
          ),
        )
      })

      it('sin medición: el log lo dice con "?" y la ventana no se cierra', async () => {
        const { guard, deps } = setup({ queryIntents: button() })
        await guard.onTabCreated(
          popupWindow(74, { ...TINY, measure: { source: 'windows.get', delayMs: 40 } }),
        )
        await bornBlankThenGo(guard, 74)
        await guard.onCommitted(74, 0, 'https://rotating.test/?rv=1', 'link', [])
        fireTimers()
        expect(deps.closeTab).not.toHaveBeenCalled()
        expect(deps.log).toHaveBeenCalledWith(
          expect.stringContaining('| geometría popup=? opener=? fuente=windows.get medida_ms=40'),
        )
      })
    })
  })

  it('popup que no es diminuta: el log dice que falló el tamaño (T7)', async () => {
    const { guard, deps } = setup()
    await guard.onTabCreated(popupWindow(66, { type: 'popup', width: 516, height: 735 }))
    await bornBlankThenGo(guard, 66)
    await guard.onCommitted(66, 0, 'https://rotating.test/?rv=1', 'link', [])
    fireTimers()
    expect(deps.closeTab).not.toHaveBeenCalled()
    expect(deps.log).toHaveBeenCalledWith(
      expect.stringContaining('popunder no confirmado: size=516x735'),
    )
  })

  it('el tamaño llega cuando la observación ya venció (> 10 s): no decide nada', async () => {
    const { guard, deps } = setup()
    await guard.onCreatedNavigationTarget(created(50, 'about:blank'))
    await bornBlankThenGo(guard, 50)
    now += 11_000
    await guard.onTabCreated(popupWindow(50))
    await new Promise((r) => setTimeout(r, 0))
    expect(deps.closeTab).not.toHaveBeenCalled()
  })

  describe('marco que abrió la ventana (onCreatedNavigationTarget.sourceFrameId)', () => {
    const fromFrame = (tabId: number, frameId: number) => ({
      ...created(tabId, 'about:blank'),
      sourceFrameId: frameId,
    })

    it('iframe oculto about:blank del propio sitio (técnica de animeyt): se cierra', async () => {
      const { guard, deps } = setup()
      await guard.onCreatedNavigationTarget(fromFrame(52, 5))
      await guard.onTabCreated(popupWindow(52))
      await bornBlankThenGo(guard, 52)
      await vi.waitFor(() => expect(deps.closeTab).toHaveBeenCalledWith(52))
      expect(deps.getFrameUrl).toHaveBeenCalledWith(SOURCE_TAB, 5)
    })

    it('iframe de OTRO sitio (widget de chat de un tercero, el clic no se registra): no se cierra', async () => {
      const { guard, deps } = setup({
        queryIntents: vi.fn(async () => []),
        getFrameUrl: vi.fn(async () => 'https://vendor.test/widget'),
      })
      await guard.onCreatedNavigationTarget(fromFrame(53, 3))
      await guard.onTabCreated(popupWindow(53))
      await bornBlankThenGo(guard, 53, 'https://vendor.test/chat')
      await vi.waitFor(() => expect(deps.getFrameUrl).toHaveBeenCalledWith(SOURCE_TAB, 3))
      expect(deps.closeTab).not.toHaveBeenCalled()
    })

    it('onCreatedNavigationTarget después de tabs.onCreated: también se usa su marco', async () => {
      const { guard, deps } = setup({
        getFrameUrl: vi.fn(async () => 'https://vendor.test/widget'),
      })
      await guard.onTabCreated(popupWindow(54))
      await guard.onCreatedNavigationTarget(fromFrame(54, 3))
      await bornBlankThenGo(guard, 54, 'https://vendor.test/chat')
      await vi.waitFor(() => expect(deps.getFrameUrl).toHaveBeenCalledWith(SOURCE_TAB, 3))
      expect(deps.closeTab).not.toHaveBeenCalled()
    })

    it('no se puede leer el marco (ya no existe): no se cierra (fail-open)', async () => {
      const { guard, deps } = setup({ getFrameUrl: vi.fn(async () => null) })
      await guard.onCreatedNavigationTarget(fromFrame(55, 3))
      await guard.onTabCreated(popupWindow(55))
      await bornBlankThenGo(guard, 55)
      await vi.waitFor(() => expect(deps.getFrameUrl).toHaveBeenCalled())
      expect(deps.closeTab).not.toHaveBeenCalled()
    })
  })

  it('about:blank con fragmento o consulta también cuenta como "nació vacía"', async () => {
    const { guard, deps } = setup()
    await guard.onTabCreated(popupWindow(51))
    await guard.onCommitted(51, 0, 'about:blank#pu', 'link', [])
    await guard.onBeforeNavigate(51, 0, 'https://rotating.test/?rv=2', now + 1100)
    await vi.waitFor(() => expect(deps.closeTab).toHaveBeenCalledWith(51))
  })
})

/**
 * P2: una observación vieja (> OBSERVATION_TTL_MS) no debe decidir nada. Antes
 * solo vencía cuando se registraba OTRA ventana; un clic del usuario dentro de
 * una ventana liberada hacía tiempo hacia un host listado la cerraba. Ahora el
 * evento descarta la observación y sigue su camino normal (Redirect Guard).
 */
describe('Popup Guard: observación vencida (P2)', () => {
  beforeEach(() => {
    now += 60_000
  })

  const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

  /** Ventana cruzada sin evidencia: POPUP_PENDING, liberada al vencer su TTL y ya confirmada. */
  async function releasedPopup(
    guard: ReturnType<typeof setup>['guard'],
    tabId: number,
  ): Promise<void> {
    await guard.onCreatedNavigationTarget(created(tabId, 'https://hop.test/landing'))
    fireTimers()
    expect(await guard.hold(tabId)).toBe('release')
    await guard.onCommitted(tabId, 0, 'https://hop.test/landing', 'link', [])
  }

  it('clic del usuario dentro de una ventana liberada hace > 10 s hacia un host listado: ni se cierra ni se revierte', async () => {
    const { guard, deps } = setup({
      queryIntents: vi.fn(async (tabId: number): Promise<UserIntent[] | null> =>
        tabId === 60 ? [click({ expectedUrl: 'https://adnet.test/deal' })] : [click()],
      ),
    })
    await releasedPopup(guard, 60)

    now += 11_000
    await guard.onBeforeNavigate(60, 0, 'https://adnet.test/deal', now)
    guard.onMainFrameRequest(60, 'https://adnet.test/deal')
    await guard.onCommitted(60, 0, 'https://adnet.test/deal', 'link', [])
    await flush()

    expect(deps.closeTab).not.toHaveBeenCalled()
    expect(deps.goBack).not.toHaveBeenCalled()
    expect(guard.hold(60)).toBeNull()
  })

  it('ventana vieja que se redirige sola a un host listado: la evalúa el Redirect Guard (atrás), no se cierra', async () => {
    const { guard, deps } = setup({
      queryIntents: vi.fn(async (tabId: number): Promise<UserIntent[] | null> =>
        tabId === 61 ? [] : [click()],
      ),
    })
    await releasedPopup(guard, 61)

    now += 11_000
    await guard.onBeforeNavigate(61, 0, 'https://adnet.test/auto', now)
    await guard.onCommitted(61, 0, 'https://adnet.test/auto', 'link', ['client_redirect'])
    await flush()

    expect(deps.closeTab).not.toHaveBeenCalled()
    expect(deps.goBack).toHaveBeenCalledTimes(1)
    expect(deps.goBack).toHaveBeenCalledWith(61)
  })

  it('evaluación en curso cuando la observación vence: no cierra una ventana ya liberada', async () => {
    let resolveEvidence!: (e: AdEvidence) => void
    let deferred = false
    const { guard, deps } = setup({
      loadEvidence: vi.fn(() =>
        deferred
          ? new Promise<AdEvidence>((resolve) => (resolveEvidence = resolve))
          : Promise.resolve(evidence),
      ),
    })
    await guard.onCreatedNavigationTarget(created(63, 'https://rnd-hop.test/'))
    const hold = guard.hold(63)!

    // A los 9,9 s llega evidencia: la evaluación espera la lista.
    deferred = true
    now += 9_900
    await guard.onBeforeNavigate(63, 0, 'https://adnet.test/landing', now)
    // A los 10,1 s otro evento la encuentra vencida: se libera y se olvida.
    now += 200
    guard.onMainFrameRequest(63, 'https://adnet.test/landing')
    expect(await hold).toBe('release')

    resolveEvidence(evidence)
    await flush()
    expect(deps.closeTab).not.toHaveBeenCalled()
  })

  it('sin cambios dentro del TTL: evidencia que llega justo a los 10 s todavía cierra la ventana', async () => {
    const { guard, deps } = setup()
    await guard.onCreatedNavigationTarget(created(62, 'https://rnd-hop.test/'))
    expect(deps.closeTab).not.toHaveBeenCalled()

    now += 10_000
    await guard.onBeforeNavigate(62, 0, 'https://adnet.test/landing', now)
    await vi.waitFor(() => expect(deps.closeTab).toHaveBeenCalledWith(62))
  })
})
