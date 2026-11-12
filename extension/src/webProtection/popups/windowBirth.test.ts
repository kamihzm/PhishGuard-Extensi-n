import { describe, expect, it, vi } from 'vitest'
import { createWindowBirths, WINDOW_BIRTH_WAIT_MS, type WindowBirthDeps } from './windowBirth'
import type { WindowBounds } from './popupClassifier'

// Chrome real del usuario (T8): pantalla 1536×864, ventana normal maximizada.
const OPENER: WindowBounds = { left: -7, top: -7, width: 1552, height: 832 }
/** Popunder al nacer: pegado a la derecha, dentro de la pantalla. */
const BORN: WindowBounds = { left: 1358, top: 0, width: 178, height: 182 }
/** La misma ventana releída tarde: ya crecida (y minimizada) en (0,0). */
const GROWN: WindowBounds = { left: 0, top: 0, width: 1536, height: 816 }
const TAB = { windowId: 7, width: 131, height: 110 }

function setup(over: Partial<WindowBirthDeps> = {}) {
  let now = 1_000
  const pendingWaits: Array<() => void> = []
  const deps = {
    getWindow: vi.fn(async () => ({ type: 'popup', bounds: GROWN })),
    getOpenerBounds: vi.fn(async (): Promise<WindowBounds | null> => OPENER),
    now: () => now,
    wait: vi.fn((_ms: number) => new Promise<void>((resolve) => pendingWaits.push(resolve))),
    ...over,
  }
  const births = createWindowBirths(deps)
  return {
    births,
    deps,
    advance: (ms: number) => (now += ms),
    expireWaits: () => pendingWaits.splice(0).forEach((resolve) => resolve()),
  }
}

describe('createWindowBirths — geometría de la popup al nacer (T8)', () => {
  it('windows.onCreated antes de tabs.onCreated: usa la geometría del evento aunque la relectura ya la vea crecida', async () => {
    const { births, deps, advance } = setup()
    births.onWindowCreated(7, 'popup', BORN)
    advance(3)
    const geometry = await births.measure(TAB, 1, 1_002)

    expect(deps.getWindow).not.toHaveBeenCalled()
    expect(geometry).toEqual({
      type: 'popup',
      width: 131,
      height: 110,
      atEdge: false,
      atFarEdge: true,
      measure: { source: 'windows.onCreated', delayMs: -2, popup: BORN, opener: OPENER },
    })
  })

  it('tabs.onCreated antes que windows.onCreated: espera el evento y usa su geometría', async () => {
    const { births, deps, advance } = setup()
    const measuring = births.measure(TAB, 1, 1_000)
    await vi.waitFor(() => expect(deps.wait).toHaveBeenCalledWith(WINDOW_BIRTH_WAIT_MS))
    advance(4)
    births.onWindowCreated(7, 'popup', BORN)
    const geometry = await measuring

    expect(geometry?.atFarEdge).toBe(true)
    expect(geometry?.measure).toEqual({
      source: 'windows.onCreated',
      delayMs: 4,
      popup: BORN,
      opener: OPENER,
    })
  })

  it('windows.onCreated no llega a tiempo: mide con windows.get (tarde) y lo dice', async () => {
    const { births, deps, advance, expireWaits } = setup()
    const measuring = births.measure(TAB, 1, 1_000)
    await vi.waitFor(() => expect(deps.wait).toHaveBeenCalled())
    advance(WINDOW_BIRTH_WAIT_MS)
    expireWaits()
    const geometry = await measuring

    expect(geometry?.measure?.source).toBe('windows.get')
    expect(geometry?.measure?.popup).toEqual(GROWN)
  })

  it('la ventana no es type popup: null sin esperar al evento', async () => {
    const { births, deps } = setup({ getWindow: vi.fn(async () => ({ type: 'normal', bounds: OPENER })) })
    expect(await births.measure(TAB, 1, 1_000)).toBeNull()
    expect(deps.wait).not.toHaveBeenCalled()
  })

  it('windows.onCreated de una ventana que no es popup no se guarda', async () => {
    const { births, deps } = setup({ getWindow: vi.fn(async () => ({ type: 'normal', bounds: OPENER })) })
    births.onWindowCreated(7, 'normal', BORN)
    expect(await births.measure(TAB, 1, 1_000)).toBeNull()
    expect(deps.getWindow).toHaveBeenCalledWith(7)
  })

  it('no se puede leer la ventana: null (fail-open)', async () => {
    const { births } = setup({
      getWindow: vi.fn(async () => {
        throw new Error('No window with id: 7')
      }),
    })
    expect(await births.measure(TAB, 1, 1_000)).toBeNull()
  })

  it('no se puede leer la ventana de origen: sin atEdge ni atFarEdge (sin medir), con los números que sí hay', async () => {
    const { births } = setup({ getOpenerBounds: vi.fn(async () => null) })
    births.onWindowCreated(7, 'popup', BORN)
    const geometry = await births.measure(TAB, 1, 1_000)

    expect(geometry).not.toHaveProperty('atEdge')
    expect(geometry).not.toHaveProperty('atFarEdge')
    expect(geometry?.measure).toEqual({ source: 'windows.onCreated', delayMs: 0, popup: BORN })
  })

  it('un nacimiento vencido (> 10 s) no se usa: se mide con windows.get', async () => {
    const { births, deps, advance, expireWaits } = setup()
    births.onWindowCreated(7, 'popup', BORN)
    advance(10_001)
    const measuring = births.measure(TAB, 1, 11_001)
    await vi.waitFor(() => expect(deps.wait).toHaveBeenCalled())
    expireWaits()
    expect((await measuring)?.measure?.source).toBe('windows.get')
  })

  it('windows.onCreated de una popup sin límites: espera y cae a windows.get', async () => {
    const { births, deps, expireWaits } = setup()
    births.onWindowCreated(7, 'popup', null)
    const measuring = births.measure(TAB, 1, 1_000)
    await vi.waitFor(() => expect(deps.wait).toHaveBeenCalled())
    expireWaits()
    expect((await measuring)?.measure?.source).toBe('windows.get')
  })

  it('un nacimiento se usa una sola vez y se olvida al cerrar la ventana', async () => {
    const { births, deps } = setup()
    births.onWindowCreated(7, 'popup', BORN)
    births.onWindowRemoved(7)
    void births.measure(TAB, 1, 1_000)
    await vi.waitFor(() => expect(deps.getWindow).toHaveBeenCalledWith(7))
  })
})
