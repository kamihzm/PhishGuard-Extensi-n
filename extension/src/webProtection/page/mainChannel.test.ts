import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CHANNEL_ACK,
  CHANNEL_ANNOUNCE,
  CHANNEL_REQUEST,
  COMMAND_DISABLE,
  COMMAND_ENABLE,
  openIsolatedChannel,
  openMainChannel,
} from './mainChannel'

/**
 * El "script de la página" se simula con eventos despachados sobre
 * `document` o sobre nodos propios, igual que podría hacerlo cualquier
 * script del sitio (comparte DOM con ambos mundos).
 */
const page = {
  dispatch: (type: string, detail?: unknown) =>
    document.dispatchEvent(new CustomEvent(type, { detail, bubbles: true })),
  dispatchFromOwnNode: (type: string) => {
    const own = document.createElement('div')
    document.body.appendChild(own)
    own.dispatchEvent(new CustomEvent(type, { bubbles: true, detail: { enabled: true } }))
    return own
  },
}

describe('canal privado aislado → MAIN: establecimiento', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('aislado primero, MAIN después: queda establecido y bloqueado', () => {
    const iso = openIsolatedChannel(document)
    const onCommand = vi.fn()
    const main = openMainChannel(document, onCommand)
    expect(iso.established()).toBe(true)
    expect(main.locked()).toBe(true)
    expect(iso.send(true)).toBe(true)
    expect(onCommand).toHaveBeenCalledWith(true)
    main.close()
  })

  it('MAIN primero, aislado después: se establece con un único re-anuncio', () => {
    const onCommand = vi.fn()
    const main = openMainChannel(document, onCommand)
    expect(main.locked()).toBe(false)
    const iso = openIsolatedChannel(document)
    expect(iso.established()).toBe(true)
    expect(main.locked()).toBe(true)
    iso.send(false)
    expect(onCommand).toHaveBeenCalledWith(false)
    main.close()
  })

  it('el nodo privado no queda en el documento', () => {
    openIsolatedChannel(document)
    const main = openMainChannel(document, vi.fn())
    expect(document.querySelectorAll('span')).toHaveLength(0)
    main.close()
  })

  it('sin MAIN (no inyectado): el aislado no se establece y send() no hace nada', () => {
    const iso = openIsolatedChannel(document)
    expect(iso.established()).toBe(false)
    expect(iso.send(true)).toBe(false)
  })
})

describe('canal privado: intentos de falsificación desde la página', () => {
  let onCommand: ReturnType<typeof vi.fn<(enabled: boolean) => void>>
  let main: ReturnType<typeof openMainChannel>
  let iso: ReturnType<typeof openIsolatedChannel>
  beforeEach(() => {
    document.body.innerHTML = ''
    onCommand = vi.fn<(enabled: boolean) => void>()
    iso = openIsolatedChannel(document)
    main = openMainChannel(document, onCommand)
  })

  it('órdenes despachadas en document (con o sin datos) se ignoran', () => {
    page.dispatch(COMMAND_ENABLE)
    page.dispatch(COMMAND_DISABLE, { enabled: false })
    page.dispatch(COMMAND_ENABLE, {
      v: 1,
      adapter: 'youtube',
      enabled: true,
      selector: 'body',
      code: 'alert(1)',
    })
    expect(onCommand).not.toHaveBeenCalled()
    main.close()
  })

  it('órdenes despachadas desde nodos propios de la página se ignoran', () => {
    page.dispatchFromOwnNode(COMMAND_ENABLE)
    page.dispatchFromOwnNode(COMMAND_DISABLE)
    expect(onCommand).not.toHaveBeenCalled()
    main.close()
  })

  it('campos extra, tipos incorrectos o payloads malformados no existen: el tipo del evento es la orden', () => {
    for (const detail of [
      null,
      1,
      'true',
      { enabled: 'yes' },
      [true],
      { __proto__: { enabled: true } },
    ]) {
      page.dispatch(COMMAND_ENABLE, detail)
    }
    expect(onCommand).not.toHaveBeenCalled()
    main.close()
  })

  it('pedir un re-anuncio tras el establecimiento no revela el nodo', () => {
    const seen = vi.fn()
    document.addEventListener(CHANNEL_ANNOUNCE, seen, true)
    page.dispatch(CHANNEL_REQUEST)
    page.dispatch(CHANNEL_REQUEST)
    expect(seen).not.toHaveBeenCalled()
    document.removeEventListener(CHANNEL_ANNOUNCE, seen, true)
    main.close()
  })

  it('un anuncio falso posterior no desvía las órdenes a un nodo de la página', () => {
    const pageNode = page.dispatchFromOwnNode(CHANNEL_ANNOUNCE)
    const received = vi.fn()
    pageNode.addEventListener(COMMAND_ENABLE, received)
    iso.send(true)
    expect(received).not.toHaveBeenCalled()
    expect(onCommand).toHaveBeenCalledWith(true)
    main.close()
  })

  it('un ACK falso en document no afecta; mensajes repetidos legítimos son idempotentes para el receptor', () => {
    page.dispatch(CHANNEL_ACK)
    iso.send(true)
    iso.send(true)
    iso.send(false)
    expect(onCommand.mock.calls).toEqual([[true], [true], [false]])
    main.close()
  })

  it('cambio de estado no autorizado: tras desactivar, la página no puede reactivar', () => {
    iso.send(false)
    page.dispatch(COMMAND_ENABLE)
    page.dispatchFromOwnNode(COMMAND_ENABLE)
    expect(onCommand.mock.calls).toEqual([[false]])
    main.close()
  })

  it('close() deja de atender órdenes', () => {
    main.close()
    iso.send(true)
    expect(onCommand).not.toHaveBeenCalled()
  })
})

describe('canal privado: presupuesto y cierre', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('MAIN atiende como máximo UN re-anuncio aunque nadie haya respondido', () => {
    const main = openMainChannel(document, vi.fn())
    const seen = vi.fn()
    document.addEventListener(CHANNEL_ANNOUNCE, seen, true)
    page.dispatch(CHANNEL_REQUEST)
    page.dispatch(CHANNEL_REQUEST)
    expect(seen).toHaveBeenCalledTimes(1)
    document.removeEventListener(CHANNEL_ANNOUNCE, seen, true)
    main.close()
  })

  it('lock() por tiempo: después no se atiende ningún re-anuncio', () => {
    const main = openMainChannel(document, vi.fn())
    main.lock()
    const seen = vi.fn()
    document.addEventListener(CHANNEL_ANNOUNCE, seen, true)
    page.dispatch(CHANNEL_REQUEST)
    expect(seen).not.toHaveBeenCalled()
    document.removeEventListener(CHANNEL_ANNOUNCE, seen, true)
    main.close()
  })

  it('sin MAIN: tras DOMContentLoaded el aislado ignora anuncios (de la página)', () => {
    const iso = openIsolatedChannel(document)
    document.dispatchEvent(new Event('DOMContentLoaded'))
    page.dispatchFromOwnNode(CHANNEL_ANNOUNCE)
    expect(iso.established()).toBe(false)
    expect(iso.send(true)).toBe(false)
  })
})
