import { beforeEach, describe, expect, it, vi } from 'vitest'
import { watchDom } from './domWatcher'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('watchDom: sin bucles ni polling', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('agrupa muchas mutaciones en un solo escaneo por intervalo', async () => {
    const scan = vi.fn()
    const watcher = watchDom({
      root: document.body,
      window,
      scan,
      isOwnNode: () => false,
      intervalMs: 20,
    })
    for (let i = 0; i < 20; i++) document.body.appendChild(document.createElement('div'))
    await wait(60)
    expect(scan).toHaveBeenCalledTimes(1)
    watcher.stop()
  })

  it('sin mutaciones no hay escaneos (no es polling)', async () => {
    const scan = vi.fn()
    const watcher = watchDom({
      root: document.body,
      window,
      scan,
      isOwnNode: () => false,
      intervalMs: 10,
    })
    await wait(80)
    expect(scan).not.toHaveBeenCalled()
    expect(watcher.scans()).toBe(0)
    watcher.stop()
  })

  it('los cambios de atributos (marcas de ocultación) no vuelven a disparar el escaneo', async () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const scan = vi.fn(() => target.setAttribute('data-phishguard-wp-hidden', 'x'))
    const watcher = watchDom({
      root: document.body,
      window,
      scan,
      isOwnNode: () => false,
      intervalMs: 10,
    })
    document.body.appendChild(document.createElement('span'))
    await wait(100)
    expect(scan).toHaveBeenCalledTimes(1)
    watcher.stop()
  })

  it('ignora los nodos propios (hoja de estilo de la capa)', async () => {
    const own = document.createElement('style')
    const scan = vi.fn()
    const watcher = watchDom({
      root: document.documentElement,
      window,
      scan,
      isOwnNode: (n) => n === own,
      intervalMs: 10,
    })
    document.head.appendChild(own)
    own.remove()
    await wait(60)
    expect(scan).not.toHaveBeenCalled()
    watcher.stop()
  })

  it('stop() desconecta el observer y cancela el escaneo pendiente', async () => {
    const scan = vi.fn()
    const watcher = watchDom({
      root: document.body,
      window,
      scan,
      isOwnNode: () => false,
      intervalMs: 30,
    })
    document.body.appendChild(document.createElement('div'))
    await wait(0)
    watcher.stop()
    document.body.appendChild(document.createElement('div'))
    await wait(100)
    expect(scan).not.toHaveBeenCalled()
  })
})
