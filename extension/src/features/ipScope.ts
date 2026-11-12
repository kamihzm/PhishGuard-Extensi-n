/**
 * ¿La IP del host es pública (enrutable en Internet)? Distingue el caso
 * "IP pública + palabras sensibles en la ruta" (riesgo alto, ver la regla
 * `ip-host-sensitive-path`) de portales cautivos, routers y servicios
 * locales en IP privada o local, que NO deben subir de riesgo por esa regla.
 *
 * Rangos no públicos (IANA Special-Purpose Address Registry, RFC 6890 y
 * RFC 4193/4291): sin especificar, privados, CGNAT, loopback, link-local,
 * documentación, benchmarking, multicast y reservados.
 *
 * El `hostname` ya viene normalizado por `new URL()`: las formas hex/octal
 * (`0x7f.1`) se convierten a decimal con puntos, e IPv6 llega entre
 * corchetes.
 */
const NON_PUBLIC_IPV4: Array<[number, number, number, number, number]> = [
  // [a, b, c, d, longitud del prefijo]
  [0, 0, 0, 0, 8], // "esta red"
  [10, 0, 0, 0, 8], // privada
  [100, 64, 0, 0, 10], // CGNAT
  [127, 0, 0, 0, 8], // loopback
  [169, 254, 0, 0, 16], // link-local
  [172, 16, 0, 0, 12], // privada
  [192, 0, 0, 0, 24], // asignaciones de protocolo IETF
  [192, 0, 2, 0, 24], // documentación (TEST-NET-1)
  [192, 168, 0, 0, 16], // privada
  [198, 18, 0, 0, 15], // benchmarking
  [198, 51, 100, 0, 24], // documentación (TEST-NET-2)
  [203, 0, 113, 0, 24], // documentación (TEST-NET-3)
  [224, 0, 0, 0, 4], // multicast
  [240, 0, 0, 0, 4], // reservado (incluye 255.255.255.255)
]

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

function ipv4ToInt(a: number, b: number, c: number, d: number): number {
  return ((a << 24) >>> 0) + (b << 16) + (c << 8) + d
}

function isPublicIpv4(hostname: string): boolean {
  const m = IPV4_PATTERN.exec(hostname)
  if (!m) return false
  const octets = m.slice(1, 5).map(Number) as [number, number, number, number]
  if (octets.some((o) => o > 255)) return false
  const ip = ipv4ToInt(...octets)
  return !NON_PUBLIC_IPV4.some(([a, b, c, d, prefix]) => {
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
    return (ip & mask) >>> 0 === (ipv4ToInt(a, b, c, d) & mask) >>> 0
  })
}

function isPublicIpv6(hostname: string): boolean {
  const ip = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (ip === '::' || ip === '::1') return false
  // IPv4 mapeada (::ffff:a.b.c.d o su forma hex que produce `new URL`): se decide por la IPv4.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip)
  if (mapped) return isPublicIpv4(mapped[1]!)
  const hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip)
  if (hexMapped) {
    const hi = parseInt(hexMapped[1]!, 16)
    const lo = parseInt(hexMapped[2]!, 16)
    return isPublicIpv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`)
  }
  const first = parseInt(ip.split(':')[0] || '0', 16)
  if ((first & 0xfe00) === 0xfc00) return false // ULA fc00::/7
  if ((first & 0xffc0) === 0xfe80) return false // link-local fe80::/10
  if ((first & 0xff00) === 0xff00) return false // multicast ff00::/8
  if (ip.startsWith('2001:db8:') || ip === '2001:db8::') return false // documentación
  return true
}

/** `true` solo si `hostname` es una IP (v4 o v6) enrutable públicamente. */
export function isPublicIpAddress(hostname: string): boolean {
  if (IPV4_PATTERN.test(hostname)) return isPublicIpv4(hostname)
  if (hostname.includes(':')) return isPublicIpv6(hostname)
  return false
}
