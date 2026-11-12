import { canonicalNetworkKey, hasBadfilterOption, splitNetworkLine } from './parseLine'

/**
 * Paso previo de `$badfilter` (§4.1): `X$badfilter` anula el filtro `X`
 * idéntico en toda la lista, aunque aparezca antes. Se compara por forma
 * canónica (mismo patrón, misma excepción, mismas opciones en cualquier
 * orden). Si solo se descartara la directiva, el filtro anulado seguiría
 * activo y se bloquearía MÁS de lo que la lista pretende.
 */
export function isBadfilterDirective(line: string): boolean {
  return hasBadfilterOption(splitNetworkLine(line))
}

export function collectBadfilterKeys(networkCandidateLines: readonly string[]): Set<string> {
  const keys = new Set<string>()
  for (const line of networkCandidateLines) {
    const split = splitNetworkLine(line)
    if (hasBadfilterOption(split)) keys.add(canonicalNetworkKey(split))
  }
  return keys
}

export function isCancelledByBadfilter(line: string, keys: ReadonlySet<string>): boolean {
  return keys.size > 0 && keys.has(canonicalNetworkKey(splitNetworkLine(line)))
}
