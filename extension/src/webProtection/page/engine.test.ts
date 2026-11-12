import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebProtectionSettings } from '../settings'
import { startPageLayer, type PageLayerDeps } from './engine'
import { HIDDEN_ATTRIBUTE, STYLE_ELEMENT_ID } from './hider'
import type { PageAdapter } from './types'

const ON: WebProtectionSettings = { adsEnabled: true, trackersEnabled: true }
const OFF: WebProtectionSettings = { adsEnabled: false, trackersEnabled: true }
const settle = () => new Promise((r) => setTimeout(r, 0))

/** Adaptador de prueba: oculta `.ad-<id>` y registra su ciclo de vida. */
function testAdapter(id: string, host: string, opts: { throwOnStart?: boolean } = {}) {
  const life = { started: 0, stopped: 0 }
  const adapter: PageAdapter = {
    id,
    matches: [`https://${host}/*`],
    appliesTo: (h) => h === host,
    start({ document: doc, hider }) {
      life.started++
      for (const el of doc.querySelectorAll(`.ad-${id}`)) hider.hide(el, id)
      if (opts.throwOnStart) throw new Error('fallo del adaptador')
      return { stop: () => void life.stopped++ }
    },
  }
  return { adapter, life }
}

function setup(overrides: Partial<PageLayerDeps> = {}) {
  let listener: ((s: WebProtectionSettings) => void) | null = null
  const unsubscribe = vi.fn()
  const deps: PageLayerDeps = {
    document,
    window,
    hostname: 'site.test',
    readSettings: vi.fn(async () => ON),
    subscribeSettings: vi.fn((cb) => {
      listener = cb
      return unsubscribe
    }),
    requestCosmetic: vi.fn(async () => ['.cosmetic-ad']),
    adapters: [],
    log: vi.fn(),
    ...overrides,
  }
  const layer = startPageLayer(deps)
  return { layer, deps, unsubscribe, change: (s: WebProtectionSettings) => listener?.(s) }
}

describe('motor de la capa de página', () => {
  beforeEach(() => {
    document.head.innerHTML = ''
    document.body.innerHTML =
      '<div class="ad-a">A</div><div class="ad-b">B</div><div class="cosmetic-ad">C</div><p id="content">texto</p>'
  })

  it('con Anuncios activo inicia solo los adaptadores de este hostname y aplica la hoja cosmética', async () => {
    const a = testAdapter('a', 'site.test')
    const b = testAdapter('b', 'other.test')
    const { layer } = setup({ adapters: [a.adapter, b.adapter] })
    await settle()
    await settle()
    expect(layer.runningAdapters()).toEqual(['a'])
    expect(b.life.started).toBe(0)
    expect(document.querySelector('.ad-a')!.hasAttribute(HIDDEN_ATTRIBUTE)).toBe(true)
    expect(document.querySelector('.ad-b')!.hasAttribute(HIDDEN_ATTRIBUTE)).toBe(false)
    expect(document.getElementById(STYLE_ELEMENT_ID)!.textContent).toContain(
      '.cosmetic-ad{display:none',
    )
    layer.stop()
  })

  it('con Anuncios desactivado no hace nada (ni adaptadores ni petición cosmética)', async () => {
    const a = testAdapter('a', 'site.test')
    const { layer, deps } = setup({ adapters: [a.adapter], readSettings: async () => OFF })
    await settle()
    expect(a.life.started).toBe(0)
    expect(deps.requestCosmetic).not.toHaveBeenCalled()
    expect(document.getElementById(STYLE_ELEMENT_ID)).toBeNull()
    layer.stop()
  })

  it('apagar Anuncios en caliente restaura el DOM exacto; encenderlo vuelve a aplicar', async () => {
    const before = document.documentElement.outerHTML
    const a = testAdapter('a', 'site.test')
    const { layer, change } = setup({ adapters: [a.adapter] })
    await settle()
    await settle()
    change(OFF)
    expect(a.life.stopped).toBe(1)
    expect(document.documentElement.outerHTML).toBe(before)
    change(ON)
    await settle()
    expect(a.life.started).toBe(2)
    expect(document.querySelector('.ad-a')!.hasAttribute(HIDDEN_ATTRIBUTE)).toBe(true)
    layer.stop()
  })

  it('con Anuncios desactivado desde el inicio avisa a los adaptadores aplicables (announceInactive)', async () => {
    const a = testAdapter('a', 'site.test')
    const other = testAdapter('b', 'other.test')
    const inactive = vi.fn()
    const otherInactive = vi.fn()
    a.adapter.announceInactive = inactive
    other.adapter.announceInactive = otherInactive
    const { layer } = setup({ adapters: [a.adapter, other.adapter], readSettings: async () => OFF })
    await settle()
    expect(inactive).toHaveBeenCalledTimes(1)
    expect(otherInactive).not.toHaveBeenCalled()
    expect(a.life.started).toBe(0)
    layer.stop()
  })

  it('cambiar solo Rastreadores no reinicia nada', async () => {
    const a = testAdapter('a', 'site.test')
    const { layer, change } = setup({ adapters: [a.adapter] })
    await settle()
    change({ adsEnabled: true, trackersEnabled: false })
    expect(a.life.started).toBe(1)
    expect(a.life.stopped).toBe(0)
    layer.stop()
  })

  it('fail-open por adaptador: si uno lanza, se deshace lo suyo y el resto sigue', async () => {
    const bad = testAdapter('a', 'site.test', { throwOnStart: true })
    const good = testAdapter('b', 'site.test')
    const { layer, deps } = setup({ adapters: [bad.adapter, good.adapter] })
    await settle()
    expect(layer.runningAdapters()).toEqual(['b'])
    expect(document.querySelector('.ad-a')!.hasAttribute(HIDDEN_ATTRIBUTE)).toBe(false)
    expect(document.querySelector('.ad-b')!.hasAttribute(HIDDEN_ATTRIBUTE)).toBe(true)
    expect(deps.log).toHaveBeenCalledWith('adapter:start-error', { adapter: 'a' })
    layer.stop()
  })

  it('fail-open: configuración ilegible → no se aplica nada', async () => {
    const a = testAdapter('a', 'site.test')
    const { layer, deps } = setup({
      adapters: [a.adapter],
      readSettings: async () => {
        throw new Error('storage')
      },
    })
    await settle()
    expect(a.life.started).toBe(0)
    expect(deps.log).toHaveBeenCalledWith('settings:unreadable')
    layer.stop()
  })

  it('fail-open: el background no responde → sin hoja cosmética, los adaptadores siguen', async () => {
    const a = testAdapter('a', 'site.test')
    const { layer } = setup({
      adapters: [a.adapter],
      requestCosmetic: async () => {
        throw new Error('sin respuesta')
      },
    })
    await settle()
    await settle()
    expect(document.getElementById(STYLE_ELEMENT_ID)!.textContent).not.toContain('cosmetic-ad')
    expect(layer.runningAdapters()).toEqual(['a'])
    layer.stop()
  })

  it('ignora una respuesta cosmética que llega después de desactivar (sin estado viejo)', async () => {
    let resolve: (s: string[]) => void = () => undefined
    const { layer, change } = setup({ requestCosmetic: () => new Promise((r) => (resolve = r)) })
    await settle()
    change(OFF)
    resolve(['.cosmetic-ad'])
    await settle()
    expect(document.getElementById(STYLE_ELEMENT_ID)).toBeNull()
    layer.stop()
  })

  it('selectores cosméticos inválidos o que alcanzan body/main se descartan', async () => {
    const { layer } = setup({
      requestCosmetic: async () => ['.cosmetic-ad', 'body', 'div[', 'main'],
    })
    await settle()
    await settle()
    const css = document.getElementById(STYLE_ELEMENT_ID)!.textContent!
    expect(css).toContain('.cosmetic-ad')
    expect(css).not.toMatch(/(^|\n)(body|main|div\[)\{/)
    layer.stop()
  })

  it('pagehide (navegación real) hace teardown completo y quita listeners', async () => {
    const before = document.documentElement.outerHTML
    const a = testAdapter('a', 'site.test')
    const { layer, unsubscribe, change } = setup({ adapters: [a.adapter] })
    await settle()
    await settle()
    window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: false }))
    expect(a.life.stopped).toBe(1)
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(document.documentElement.outerHTML).toBe(before)
    // Tras el teardown, un cambio de configuración ya no reactiva nada.
    change(ON)
    await settle()
    expect(a.life.started).toBe(1)
    expect(layer.isActive()).toBe(false)
  })

  it('pagehide hacia el bfcache conserva el estado (la página puede volver tal cual)', async () => {
    const a = testAdapter('a', 'site.test')
    const { layer } = setup({ adapters: [a.adapter] })
    await settle()
    window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: true }))
    expect(layer.isActive()).toBe(true)
    layer.stop()
  })

  it('stop() es idempotente', async () => {
    const a = testAdapter('a', 'site.test')
    const { layer, unsubscribe } = setup({ adapters: [a.adapter] })
    await settle()
    layer.stop()
    layer.stop()
    expect(a.life.stopped).toBe(1)
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})
