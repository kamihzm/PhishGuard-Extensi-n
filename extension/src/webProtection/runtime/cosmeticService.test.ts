import { describe, expect, it, vi } from 'vitest'
import type { CosmeticIndex } from '../cosmetic/compileCosmetic'
import { COSMETIC_REQUEST_TYPE } from '../page/protocol'
import {
  answerCosmeticRequest,
  createIndexLoader,
  type CosmeticServiceDeps,
} from './cosmeticService'

const INDEX: CosmeticIndex = {
  hide: { 'youtube.com': ['ytd-ad-slot-renderer'], 'example.com': ['.ad'] },
  allow: { 'youtube.com': ['.video-ads'] },
}
const REQUEST = { type: COSMETIC_REQUEST_TYPE, v: 1 }
const SENDER = {
  id: 'ext',
  frameId: 0,
  tab: { id: 1 },
  url: 'https://www.youtube.com/watch?v=abc&t=1',
}

function deps(overrides: Partial<CosmeticServiceDeps> = {}): CosmeticServiceDeps {
  return {
    extensionId: 'ext',
    loadIndex: async () => INDEX,
    readSettings: async () => ({ adsEnabled: true, trackersEnabled: true }),
    ...overrides,
  }
}

describe('servicio cosmético del background', () => {
  it('responde con los selectores del hostname que ve Chrome', async () => {
    expect(await answerCosmeticRequest(REQUEST, SENDER, deps())).toEqual({
      ok: true,
      selectors: ['ytd-ad-slot-renderer'],
    })
  })

  it('ignora mensajes ajenos (devuelve null para que otro listener los procese)', async () => {
    expect(await answerCosmeticRequest({ type: 'continue', url: 'x' }, SENDER, deps())).toBeNull()
  })

  it('no acepta un hostname en el mensaje: el mensaje con campos extra no es una petición válida', async () => {
    const forged = { ...REQUEST, hostname: 'example.com' }
    expect(await answerCosmeticRequest(forged, SENDER, deps())).toBeNull()
  })

  it('rechaza emisores no confiables (otra extensión, iframe, sin pestaña)', async () => {
    for (const sender of [
      { ...SENDER, id: 'otra' },
      { ...SENDER, frameId: 1 },
      { ...SENDER, tab: undefined },
    ]) {
      expect(await answerCosmeticRequest(REQUEST, sender, deps())).toEqual({
        ok: false,
        selectors: [],
      })
    }
  })

  it('con Anuncios desactivado responde vacío', async () => {
    const off = deps({ readSettings: async () => ({ adsEnabled: false, trackersEnabled: true }) })
    expect(await answerCosmeticRequest(REQUEST, SENDER, off)).toEqual({ ok: true, selectors: [] })
  })

  it('fail-open: si el índice no carga, responde vacío', async () => {
    const broken = deps({
      loadIndex: async () => {
        throw new Error('sin índice')
      },
    })
    expect(await answerCosmeticRequest(REQUEST, SENDER, broken)).toEqual({
      ok: true,
      selectors: [],
    })
  })

  it('el cargador del índice carga una sola vez, valida la forma y reintenta tras un fallo', async () => {
    const fetchIndex = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('red'))
      .mockResolvedValueOnce({ nada: 1 })
      .mockResolvedValue(INDEX)
    const load = createIndexLoader(fetchIndex)
    await expect(load()).rejects.toThrow('red')
    await expect(load()).rejects.toThrow('índice cosmético inválido')
    expect(await load()).toBe(INDEX)
    expect(await load()).toBe(INDEX)
    expect(fetchIndex).toHaveBeenCalledTimes(3)
  })
})
