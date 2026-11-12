import { describe, expect, it, vi } from 'vitest'
import { createHider } from '../../hider'
import type { IsolatedChannel } from '../../mainChannel'
import { createYoutubeAdapter } from './adapter'
import { createYoutubeMainWorld, INITIAL_PLAYER_RESPONSE_KEY } from './mainWorld'
import { isPlayerEndpoint, sanitizePlayerPayload } from './sanitize'

const ORIGIN = 'https://www.youtube.com'
const playerResponse = () => ({
  playabilityStatus: { status: 'OK' },
  videoDetails: { videoId: 'abc' },
  streamingData: { adaptiveFormats: [{ itag: 1 }] },
  adPlacements: [{ adPlacementRenderer: {} }],
  playerAds: [{ playerLegacyDesktopWatchAdsRenderer: {} }],
  adSlots: [{ adSlotRenderer: {} }],
  adBreakHeartbeatParams: 'x',
})

describe('sanitizePlayerPayload: solo claves publicitarias de respuestas del reproductor', () => {
  it('carga inicial (ytInitialPlayerResponse)', () => {
    const data = playerResponse()
    expect(sanitizePlayerPayload(data)).toBe(4)
    expect(Object.keys(data).sort()).toEqual(['playabilityStatus', 'streamingData', 'videoDetails'])
    // No toca el contenido del video.
    expect(data.streamingData.adaptiveFormats).toEqual([{ itag: 1 }])
  })

  it('/youtubei/v1/player con playerResponse anidado', () => {
    const data = { responseContext: {}, playerResponse: playerResponse() }
    expect(sanitizePlayerPayload(data)).toBe(4)
    expect('adSlots' in data.playerResponse).toBe(false)
  })

  it('/youtubei/v1/get_watch: arreglo con [i].playerResponse', () => {
    const data = [
      { playerResponse: playerResponse(), responseType: 'x' },
      { watchNextResponse: {} },
    ]
    expect(sanitizePlayerPayload(data)).toBe(4)
    expect(data[0]!.playerResponse).not.toHaveProperty('playerAds')
  })

  it('NO modifica objetos que no tienen forma de respuesta del reproductor', () => {
    const other = { adSlots: [1], playerAds: [2], title: 'comentarios' }
    expect(sanitizePlayerPayload(other)).toBe(0)
    expect(other).toEqual({ adSlots: [1], playerAds: [2], title: 'comentarios' })
  })

  it('profundidad acotada y tolerante a valores no objeto', () => {
    const deep = { a: { b: { c: { d: { e: playerResponse() } } } } }
    expect(sanitizePlayerPayload(deep)).toBe(0)
    for (const v of [null, undefined, 3, 'x', true]) expect(sanitizePlayerPayload(v)).toBe(0)
  })

  it('isPlayerEndpoint: solo /player y /get_watch del mismo origen', () => {
    expect(isPlayerEndpoint('/youtubei/v1/player?key=1', ORIGIN)).toBe(true)
    expect(isPlayerEndpoint(`${ORIGIN}/youtubei/v1/get_watch`, ORIGIN)).toBe(true)
    expect(isPlayerEndpoint('/youtubei/v1/next', ORIGIN)).toBe(false)
    expect(isPlayerEndpoint('/youtubei/v1/search', ORIGIN)).toBe(false)
    expect(isPlayerEndpoint('https://evil.example/youtubei/v1/player', ORIGIN)).toBe(false)
    expect(isPlayerEndpoint('https://rr1---sn.googlevideo.com/videoplayback', ORIGIN)).toBe(false)
  })
})

/** Ventana mínima con fetch/Response propios para probar la parte MAIN sin tocar globals reales. */
function fakeWindow(body: unknown, init: { ok?: boolean; text?: string } = {}) {
  const calls: string[] = []
  const nativeFetch = vi.fn(async (input: RequestInfo | URL) => {
    calls.push(String(input))
    return new Response(init.text ?? JSON.stringify(body), {
      status: init.ok === false ? 500 : 200,
      headers: { 'content-type': 'application/json', 'content-length': '999' },
    })
  })
  const win = {
    fetch: nativeFetch,
    Response,
    Headers,
    Request,
    ReadableStream,
    TextDecoder,
    TextEncoder,
    location: { origin: ORIGIN },
  } as unknown as Window & typeof globalThis
  return { win, nativeFetch, calls }
}

describe('parte MAIN de YouTube (mainWorld)', () => {
  it('estado inicial desconocido = fail-open: no sanea nada todavía', async () => {
    const { win } = fakeWindow(playerResponse())
    const main = createYoutubeMainWorld(win)
    expect(main.gate()).toBe('unknown')
    const initial = playerResponse()
    ;(win as unknown as Record<string, unknown>)[INITIAL_PLAYER_RESPONSE_KEY] = initial
    expect('adPlacements' in initial).toBe(true)
    const data = await (await win.fetch('/youtubei/v1/player')).json()
    expect(data).toHaveProperty('adSlots')
  })

  it('habilitado: sanea ytInitialPlayerResponse al asignarse', () => {
    const { win } = fakeWindow({})
    const main = createYoutubeMainWorld(win)
    main.setEnabled(true)
    const w = win as unknown as Record<string, unknown>
    w[INITIAL_PLAYER_RESPONSE_KEY] = playerResponse()
    expect(w[INITIAL_PLAYER_RESPONSE_KEY]).not.toHaveProperty('adPlacements')
    expect(w[INITIAL_PLAYER_RESPONSE_KEY]).toHaveProperty('streamingData')
    expect(main.stats().initialKeysRemoved).toBe(4)
  })

  it('habilitado: sanea fetch de /player y conserva status, url y cabeceras (sin content-length)', async () => {
    const { win } = fakeWindow({ playerResponse: playerResponse() })
    createYoutubeMainWorld(win).setEnabled(true)
    const res = await win.fetch('/youtubei/v1/player')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/json')
    expect(res.headers.get('content-length')).toBeNull()
    const data = await res.json()
    expect(data.playerResponse).not.toHaveProperty('adSlots')
    expect(data.playerResponse.videoDetails).toEqual({ videoId: 'abc' })
  })

  it('no toca otras peticiones: devuelve la MISMA respuesta original', async () => {
    const { win, nativeFetch } = fakeWindow({ playerResponse: playerResponse() })
    createYoutubeMainWorld(win).setEnabled(true)
    const original = await nativeFetch.getMockImplementation()!('/youtubei/v1/next')
    nativeFetch.mockResolvedValueOnce(original)
    expect(await win.fetch('/youtubei/v1/next')).toBe(original)
  })

  it('fail-open: respuesta no JSON o con error HTTP → respuesta original intacta', async () => {
    const bad = fakeWindow(null, { text: 'no es json' })
    createYoutubeMainWorld(bad.win).setEnabled(true)
    expect(await (await bad.win.fetch('/youtubei/v1/player')).text()).toBe('no es json')

    const failed = fakeWindow(playerResponse(), { ok: false })
    createYoutubeMainWorld(failed.win).setEnabled(true)
    expect(await (await failed.win.fetch('/youtubei/v1/player')).json()).toHaveProperty('adSlots')
  })

  it('deshabilitar desinstala: fetch vuelve a ser el original y la propiedad es normal', () => {
    const { win, nativeFetch } = fakeWindow({})
    const main = createYoutubeMainWorld(win)
    main.setEnabled(true)
    const w = win as unknown as Record<string, unknown>
    w[INITIAL_PLAYER_RESPONSE_KEY] = playerResponse()
    main.setEnabled(false)
    expect(win.fetch).toBe(nativeFetch)
    const descriptor = Object.getOwnPropertyDescriptor(win, INITIAL_PLAYER_RESPONSE_KEY)!
    expect(descriptor.get).toBeUndefined()
    expect(descriptor.writable).toBe(true)
    // El valor ya asignado se conserva; asignaciones nuevas no se tocan.
    expect(w[INITIAL_PLAYER_RESPONSE_KEY]).toHaveProperty('videoDetails')
    const fresh = playerResponse()
    w[INITIAL_PLAYER_RESPONSE_KEY] = fresh
    expect(fresh).toHaveProperty('adPlacements')
    expect(main.installed()).toBe(false)
  })

  it('re-habilitar vuelve a instalar (idempotente)', () => {
    const { win, nativeFetch } = fakeWindow({})
    const main = createYoutubeMainWorld(win)
    main.setEnabled(true)
    main.setEnabled(true)
    main.setEnabled(false)
    main.setEnabled(true)
    expect(win.fetch).not.toBe(nativeFetch)
    expect(main.installed()).toBe(true)
  })

  it('no pisa un envoltorio de fetch que la página instaló después', () => {
    const { win } = fakeWindow({})
    const main = createYoutubeMainWorld(win)
    const pageWrapper = vi.fn() as unknown as typeof fetch
    win.fetch = pageWrapper
    main.setEnabled(false)
    expect(win.fetch).toBe(pageWrapper)
  })

  it('no toca una propiedad no configurable definida por la página', () => {
    const { win } = fakeWindow({})
    Object.defineProperty(win, INITIAL_PLAYER_RESPONSE_KEY, { value: 1, configurable: false })
    const main = createYoutubeMainWorld(win)
    main.setEnabled(true)
    expect(Object.getOwnPropertyDescriptor(win, INITIAL_PLAYER_RESPONSE_KEY)!.value).toBe(1)
  })
})

describe('parte MAIN: respuesta en streaming, sin espera artificial (regresión del retraso)', () => {
  const ENCODER = new TextEncoder()
  const first = JSON.stringify({ playerResponse: playerResponse(), responseType: 'x' })

  /** get_watch cuyo elemento 1 NO llega hasta que el test lo libere. */
  function controlledWindow() {
    let release: () => void = () => undefined
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(ENCODER.encode('[' + first + ','))
        release = () => {
          controller.enqueue(ENCODER.encode('{"watchNextResponse":{}}]'))
          controller.close()
        }
      },
    })
    const win = {
      fetch: vi.fn(
        async () =>
          new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }),
      ),
      Response,
      Headers,
      Request,
      ReadableStream,
      TextDecoder,
      TextEncoder,
      location: { origin: ORIGIN },
    } as unknown as Window & typeof globalThis
    return { win, release: () => release() }
  }
  const withTimeout = <T>(p: Promise<T>, ms = 300) =>
    Promise.race([
      p,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('esperó el cuerpo completo')), ms),
      ),
    ])

  it('fetch() resuelve con las cabeceras sin esperar el cuerpo completo', async () => {
    const { win } = controlledWindow()
    createYoutubeMainWorld(win).setEnabled(true)
    const res = await withTimeout(win.fetch('/youtubei/v1/get_watch'))
    expect(res.status).toBe(200)
  })

  it('el elemento 0 (ya saneado) se puede leer antes de que llegue el resto', async () => {
    const { win, release } = controlledWindow()
    createYoutubeMainWorld(win).setEnabled(true)
    const res = await win.fetch('/youtubei/v1/get_watch')
    const reader = res.body!.getReader()
    const { value } = await withTimeout(reader.read())
    const text = new TextDecoder().decode(value)
    expect(text.startsWith('[')).toBe(true)
    const element0 = JSON.parse(text.slice(1, text.lastIndexOf('}') + 1))
    expect(element0.playerResponse).not.toHaveProperty('adSlots')
    expect(element0.playerResponse.videoDetails).toEqual({ videoId: 'abc' })
    release()
    let rest = ''
    for (let r = await reader.read(); !r.done; r = await reader.read())
      rest += new TextDecoder().decode(r.value)
    expect(JSON.parse(text + rest)[1]).toEqual({ watchNextResponse: {} })
  })

  it.each([
    [
      'arreglo (get_watch)',
      '/youtubei/v1/get_watch',
      () => JSON.stringify([JSON.parse(first), { watchNextResponse: {} }]),
    ],
    ['objeto (player)', '/youtubei/v1/player', () => first],
  ])(
    'no se queda colgado cuando muchos fragmentos seguidos no completan ningún elemento: %s',
    async (_name, path, makeBody) => {
      // Fuente que entrega UN fragmento pequeño por cada pull (como la red).
      const bytes = ENCODER.encode(makeBody())
      let offset = 0
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (offset >= bytes.length) return controller.close()
          controller.enqueue(bytes.slice(offset, offset + 16))
          offset += 16
        },
      })
      const win = {
        fetch: vi.fn(async () => new Response(body)),
        Response,
        Headers,
        Request,
        ReadableStream,
        TextDecoder,
        TextEncoder,
        location: { origin: ORIGIN },
      } as unknown as Window & typeof globalThis
      createYoutubeMainWorld(win).setEnabled(true)
      const text = await withTimeout((await win.fetch(path)).text(), 1000)
      expect(text).not.toContain('adSlots')
      expect(text).toContain('videoDetails')
    },
  )

  it('un error de red a mitad del cuerpo se propaga igual que sin la extensión', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(ENCODER.encode('[{"a":1},'))
        controller.error(new Error('red cortada'))
      },
    })
    const win = {
      fetch: vi.fn(async () => new Response(body)),
      Response,
      Headers,
      Request,
      ReadableStream,
      TextDecoder,
      TextEncoder,
      location: { origin: ORIGIN },
    } as unknown as Window & typeof globalThis
    createYoutubeMainWorld(win).setEnabled(true)
    await expect((await win.fetch('/youtubei/v1/get_watch')).text()).rejects.toThrow()
  })

  it('las peticiones que no son del reproductor no se tocan (ni se leen)', async () => {
    const { win } = controlledWindow()
    const main = createYoutubeMainWorld(win)
    main.setEnabled(true)
    await win.fetch('/youtubei/v1/next')
    expect(main.stats().playerFetches).toBe(0)
  })
})

describe('adaptador de YouTube (mundo aislado)', () => {
  const ctx = () => ({ document, window, hider: createHider(document), log: vi.fn() })
  const channel = () => {
    const sent: boolean[] = []
    const c: IsolatedChannel = { send: (e) => (sent.push(e), true), established: () => true }
    return { c, sent }
  }

  it('solo aplica a www.youtube.com', () => {
    const adapter = createYoutubeAdapter(null)
    expect(adapter.appliesTo('www.youtube.com')).toBe(true)
    expect(adapter.appliesTo('m.youtube.com')).toBe(false)
    expect(adapter.appliesTo('youtube.com.evil.net')).toBe(false)
    expect(adapter.appliesTo('jkanime.net')).toBe(false)
  })

  it('al iniciar ordena activar; al detenerse, desactivar; inactivo → desactivar', () => {
    const { c, sent } = channel()
    const adapter = createYoutubeAdapter(c)
    adapter.start(ctx()).stop()
    adapter.announceInactive?.()
    expect(sent).toEqual([true, false, false])
  })

  it('sin canal establecido no hace nada y lo registra (fail-open)', () => {
    const context = ctx()
    const adapter = createYoutubeAdapter(null)
    expect(() => adapter.start(context).stop()).not.toThrow()
    expect(context.log).toHaveBeenCalledWith('youtube:channel-unavailable')
  })

  it('no modifica el DOM', () => {
    document.body.innerHTML = '<div id="movie_player"><video></video></div>'
    const before = document.body.innerHTML
    const { c } = channel()
    createYoutubeAdapter(c).start(ctx()).stop()
    expect(document.body.innerHTML).toBe(before)
  })
})
