/**
 * Vigila la llegada de nodos nuevos y ejecuta `scan` como mucho una vez
 * cada `intervalMs` (sin polling: solo reacciona a mutaciones reales).
 *
 * Garantías contra bucles:
 * - solo observa `childList` (las marcas de ocultación son atributos);
 * - ignora lotes cuyos nodos añadidos/quitados son todos propios
 *   (`isOwnNode`, p. ej. la hoja de estilo de la capa de página);
 * - `stop()` desconecta el observer y cancela el escaneo pendiente.
 */
export interface DomWatcher {
  stop(): void
  scans(): number
}

export interface DomWatcherOptions {
  root: Node
  window: Window & typeof globalThis
  scan: () => void
  isOwnNode: (node: Node) => boolean
  intervalMs?: number
}

export function watchDom(options: DomWatcherOptions): DomWatcher {
  const { root, window: win, scan, isOwnNode } = options
  const intervalMs = options.intervalMs ?? 150
  let timer: number | null = null
  let stopped = false
  let count = 0

  const run = () => {
    timer = null
    if (stopped) return
    count++
    scan()
  }

  const onlyOwnNodes = (records: MutationRecord[]) =>
    records.every((r) => [...r.addedNodes].every(isOwnNode) && [...r.removedNodes].every(isOwnNode))

  const observer = new win.MutationObserver((records: MutationRecord[]) => {
    if (stopped || timer !== null || onlyOwnNodes(records)) return
    timer = win.setTimeout(run, intervalMs)
  })
  observer.observe(root, { childList: true, subtree: true })

  return {
    stop() {
      stopped = true
      observer.disconnect()
      if (timer !== null) win.clearTimeout(timer)
      timer = null
    },
    scans: () => count,
  }
}
