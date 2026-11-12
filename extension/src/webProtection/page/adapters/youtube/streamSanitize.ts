import { sanitizePlayerPayload } from './sanitize'

/**
 * Saneamiento INCREMENTAL de un cuerpo JSON cuyo nivel superior es un
 * arreglo (`/youtubei/v1/get_watch`: `[{…playerResponse…}, {…watchNextResponse…}]`).
 *
 * Medición en Chrome real: el elemento 0 (el que trae las claves
 * publicitarias) termina de llegar a los 140–580 ms, pero el cuerpo completo
 * tarda 736–1195 ms. YouTube consume la respuesta a medida que llega, así
 * que esperar el cuerpo entero retrasaba el inicio del video. Aquí cada
 * elemento de primer nivel se retiene SOLO hasta que está completo, se
 * sanea y se entrega de inmediato; lo que está entre elementos (`[`, `,`,
 * `]`, espacios) pasa sin espera.
 *
 * Garantías:
 * - nunca se entrega un elemento a medias ni una versión parcialmente saneada;
 * - si un elemento no es JSON válido, se entrega su texto ORIGINAL (fail-open);
 * - si el cuerpo no empieza con `[` (p. ej. `/player`, un objeto), se retiene
 *   completo y se sanea al final, igual que antes;
 * - el texto de salida es idéntico a la entrada salvo en los elementos a los
 *   que efectivamente se les quitaron claves.
 */
export interface StreamSanitizer {
  /** Procesa un fragmento de texto; devuelve lo que ya se puede entregar. */
  push(chunk: string): string
  /** Fin del cuerpo: devuelve lo pendiente. */
  end(): string
  removed(): number
}

type Mode = 'start' | 'array' | 'whole'

export function createStreamSanitizer(): StreamSanitizer {
  let mode: Mode = 'start'
  let removed = 0
  // Estado del escáner (modo 'array').
  let depth = 0
  let inString = false
  let escaped = false
  let elementOpen = false
  let element = ''
  // Modo 'whole': todo el cuerpo.
  let whole = ''

  const finishElement = (text: string): string => {
    try {
      const value: unknown = JSON.parse(text)
      // Los elementos están un nivel por debajo del arreglo raíz.
      const n = sanitizePlayerPayload(value, 1)
      if (n === 0) return text
      removed += n
      return JSON.stringify(value)
    } catch {
      return text
    }
  }

  const scanArray = (chunk: string): string => {
    let out = ''
    let segmentStart = 0
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk.charCodeAt(i)
      if (inString) {
        if (escaped) escaped = false
        else if (c === 0x5c /* \ */) escaped = true
        else if (c === 0x22 /* " */) inString = false
        continue
      }
      if (c === 0x22) {
        inString = true
      } else if (c === 0x7b /* { */ || c === 0x5b /* [ */) {
        if (depth === 1 && !elementOpen) {
          // Empieza un elemento: lo anterior (separadores) se entrega ya.
          out += chunk.slice(segmentStart, i)
          segmentStart = i
          elementOpen = true
          element = ''
        }
        depth++
      } else if (c === 0x7d /* } */ || c === 0x5d /* ] */) {
        depth--
        if (elementOpen && depth === 1) {
          element += chunk.slice(segmentStart, i + 1)
          out += finishElement(element)
          element = ''
          elementOpen = false
          segmentStart = i + 1
        }
      }
    }
    if (elementOpen) element += chunk.slice(segmentStart)
    else out += chunk.slice(segmentStart)
    return out
  }

  return {
    push(chunk) {
      if (mode === 'start') {
        const first = chunk.search(/\S/)
        if (first < 0) return chunk // solo espacios: todavía no se sabe el tipo
        if (chunk[first] === '[') {
          mode = 'array'
          // El `[` raíz abre el nivel 1; se entrega tal cual.
          depth = 1
          return chunk.slice(0, first + 1) + scanArray(chunk.slice(first + 1))
        }
        mode = 'whole'
      }
      if (mode === 'whole') {
        whole += chunk
        return ''
      }
      return scanArray(chunk)
    },
    end() {
      if (mode === 'whole') {
        const text = whole
        whole = ''
        try {
          const value: unknown = JSON.parse(text)
          const n = sanitizePlayerPayload(value)
          if (n === 0) return text
          removed += n
          return JSON.stringify(value)
        } catch {
          return text
        }
      }
      // Elemento sin cerrar (cuerpo truncado): se entrega el texto original.
      const rest = element
      element = ''
      elementOpen = false
      return rest
    },
    removed: () => removed,
  }
}
