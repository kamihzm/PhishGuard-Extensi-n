import { describe, expect, it } from 'vitest'
import { sanitizePlayerPayload } from './sanitize'
import { createStreamSanitizer } from './streamSanitize'

const player = (extra: Record<string, unknown> = {}) => ({
  playabilityStatus: { status: 'OK' },
  videoDetails: { videoId: 'abc', title: 'con "comillas", [corchetes] {llaves} y \\ barra — ñ 🎵' },
  streamingData: { adaptiveFormats: [{ itag: 1 }] },
  ...extra,
})
const withAds = () =>
  player({
    adPlacements: [{ a: 1 }],
    playerAds: [{ b: '}]' }],
    adSlots: [{ c: '[{' }],
    adBreakHeartbeatParams: 'x',
  })
const GET_WATCH = JSON.stringify([
  { responseContext: {}, playerResponse: withAds(), responseType: 'x' },
  { watchNextResponse: { contents: ['[', ']', '{', '}', '\\"'] } },
])

/** Resultado de referencia: saneamiento del cuerpo completo (comportamiento anterior). */
function reference(text: string): string {
  const value = JSON.parse(text)
  return sanitizePlayerPayload(value) > 0 ? JSON.stringify(value) : text
}
function runChunks(text: string, size: number): { out: string; removed: number } {
  const s = createStreamSanitizer()
  let out = ''
  for (let i = 0; i < text.length; i += size) out += s.push(text.slice(i, i + size))
  out += s.end()
  return { out, removed: s.removed() }
}

describe('createStreamSanitizer: saneamiento incremental por elemento', () => {
  it.each([1, 2, 3, 7, 64, 1000, 1_000_000])(
    'con fragmentos de %i caracteres produce lo mismo que sanear el cuerpo completo',
    (size) => {
      const { out, removed } = runChunks(GET_WATCH, size)
      expect(JSON.parse(out)).toEqual(JSON.parse(reference(GET_WATCH)))
      expect(removed).toBe(4)
      expect(JSON.parse(out)[0].playerResponse).not.toHaveProperty('adSlots')
      // El contenido legítimo (incluidas cadenas con corchetes y escapes) queda intacto.
      expect(JSON.parse(out)[1]).toEqual(JSON.parse(GET_WATCH)[1])
    },
  )

  it('entrega el elemento 0 saneado en cuanto se completa, sin esperar el resto del cuerpo', () => {
    const s = createStreamSanitizer()
    const [first] = JSON.parse(GET_WATCH)
    const firstText = JSON.stringify(first)
    const emitted = s.push(`[${firstText},`)
    expect(emitted.startsWith('[')).toBe(true)
    expect(emitted.endsWith(',')).toBe(true)
    expect(JSON.parse(emitted.slice(1, -1)).playerResponse).not.toHaveProperty('adPlacements')
  })

  it('sin claves publicitarias el texto de salida es idéntico al de entrada', () => {
    const clean = JSON.stringify([{ playerResponse: player() }, { watchNextResponse: {} }])
    expect(runChunks(clean, 5)).toEqual({ out: clean, removed: 0 })
  })

  it('fail-open: un elemento que no es JSON válido se entrega tal cual', () => {
    const broken = '[{"playerResponse": {"playabilityStatus": {}, "adSlots": [1], }},{"ok":1}]'
    expect(runChunks(broken, 4).out).toBe(broken)
  })

  it('fail-open: cuerpo truncado → se entrega el texto original de lo pendiente', () => {
    const truncated = GET_WATCH.slice(0, GET_WATCH.length - 40)
    const { out } = runChunks(truncated, 16)
    expect(out.slice(-30)).toBe(truncated.slice(-30))
  })

  it('cuerpo objeto (/player): se sanea al final, como antes', () => {
    const body = JSON.stringify({ responseContext: {}, playerResponse: withAds() })
    const s = createStreamSanitizer()
    expect(s.push(body.slice(0, 10))).toBe('')
    expect(s.push(body.slice(10))).toBe('')
    const out = JSON.parse(s.end())
    expect(out.playerResponse).not.toHaveProperty('playerAds')
    expect(s.removed()).toBe(4)
  })

  it('cuerpo no JSON: se devuelve intacto', () => {
    expect(runChunks('no es json', 3).out).toBe('no es json')
  })

  it('espacios iniciales y elementos primitivos no rompen el escaneo', () => {
    const body = '  \n[1, "a]b", null, {"playerResponse": ' + JSON.stringify(withAds()) + '}]'
    const { out, removed } = runChunks(body, 2)
    expect(removed).toBe(4)
    expect(JSON.parse(out).slice(0, 3)).toEqual([1, 'a]b', null])
  })
})
