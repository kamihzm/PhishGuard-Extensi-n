/**
 * Decodificador Punycode (RFC 3492) escrito a mano, solo decodificación:
 * los navegadores no exponen `domainToUnicode` y `new URL()` siempre entrega
 * el host en forma ASCII (`xn--…`). Se usa para mostrar y analizar cómo ve
 * realmente el usuario un dominio internacionalizado.
 */
const BASE = 36
const T_MIN = 1
const T_MAX = 26
const SKEW = 38
const DAMP = 700
const INITIAL_BIAS = 72
const INITIAL_N = 128

function adapt(delta: number, numPoints: number, firstTime: boolean): number {
  let d = firstTime ? Math.floor(delta / DAMP) : delta >> 1
  d += Math.floor(d / numPoints)
  let k = 0
  while (d > ((BASE - T_MIN) * T_MAX) >> 1) {
    d = Math.floor(d / (BASE - T_MIN))
    k += BASE
  }
  return k + Math.floor(((BASE - T_MIN + 1) * d) / (d + SKEW))
}

function digitValue(codePoint: number): number {
  if (codePoint >= 0x30 && codePoint <= 0x39) return codePoint - 22 // 0-9 → 26-35
  if (codePoint >= 0x41 && codePoint <= 0x5a) return codePoint - 0x41 // A-Z → 0-25
  if (codePoint >= 0x61 && codePoint <= 0x7a) return codePoint - 0x61 // a-z → 0-25
  return BASE
}

/** Decodifica la parte posterior a `xn--` de UNA etiqueta. Lanza error si es inválida. */
export function decodePunycode(input: string): string {
  const output: number[] = []
  const basicEnd = input.lastIndexOf('-')
  for (let j = 0; j < Math.max(basicEnd, 0); j++) {
    const cp = input.charCodeAt(j)
    if (cp >= 0x80) throw new Error('punycode: carácter no básico')
    output.push(cp)
  }
  let n = INITIAL_N
  let bias = INITIAL_BIAS
  let i = 0
  for (let index = basicEnd > 0 ? basicEnd + 1 : 0; index < input.length;) {
    const oldI = i
    let w = 1
    for (let k = BASE; ; k += BASE) {
      if (index >= input.length) throw new Error('punycode: entrada truncada')
      const digit = digitValue(input.charCodeAt(index++))
      if (digit >= BASE) throw new Error('punycode: dígito inválido')
      i += digit * w
      const t = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias
      if (digit < t) break
      w *= BASE - t
    }
    const length = output.length + 1
    bias = adapt(i - oldI, length, oldI === 0)
    n += Math.floor(i / length)
    i %= length
    if (n > 0x10ffff) throw new Error('punycode: fuera de rango')
    output.splice(i++, 0, n)
  }
  return String.fromCodePoint(...output)
}

/** Etiqueta → Unicode si empieza por `xn--` (si es inválida, se devuelve tal cual). */
export function labelToUnicode(label: string): string {
  if (!label.toLowerCase().startsWith('xn--')) return label
  try {
    return decodePunycode(label.slice(4).toLowerCase())
  } catch {
    return label
  }
}

/** Host ASCII (`xn--pypal-4ve.com`) → host Unicode (`pаypal.com`), etiqueta por etiqueta. */
export function hostToUnicode(host: string): string {
  return host.split('.').map(labelToUnicode).join('.')
}
