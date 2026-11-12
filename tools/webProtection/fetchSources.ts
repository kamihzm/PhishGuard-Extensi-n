/**
 * Descarga un snapshot fechado de cada fuente APROBADA (sources.json) a
 * `tools/webProtection/sources/<id>.txt`, junto con `<id>.meta.json`
 * (fecha, SHA-256, versión de la lista). El compilador trabaja SOLO sobre
 * estos snapshots versionados, nunca sobre la red: así la compilación es
 * reproducible.
 *
 * Uso (desde extension/): npm run wp:fetch
 */
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import {
  approvedSources,
  SOURCES_DIR,
  snapshotMetaPath,
  snapshotPath,
  type SnapshotMeta,
} from './sourceRegistry'

function header(text: string, field: string): string | null {
  const match = new RegExp(`^! ${field}: (.+)$`, 'm').exec(text)
  return match ? match[1]!.trim() : null
}

async function main(): Promise<void> {
  mkdirSync(SOURCES_DIR, { recursive: true })
  for (const source of approvedSources()) {
    const response = await fetch(source.url, { signal: AbortSignal.timeout(60_000) })
    if (!response.ok) throw new Error(`${source.id}: HTTP ${response.status}`)
    const text = await response.text()
    const meta: SnapshotMeta = {
      id: source.id,
      url: source.url,
      fetchedAt: new Date().toISOString(),
      sha256: createHash('sha256').update(text).digest('hex'),
      bytes: Buffer.byteLength(text),
      lines: text.split(/\r?\n/).filter((_, i, all) => i < all.length - 1 || all[i] !== '').length,
      version: header(text, 'Version'),
      lastModified: header(text, 'Last modified'),
    }
    writeFileSync(snapshotPath(source.id), text)
    writeFileSync(snapshotMetaPath(source.id), JSON.stringify(meta, null, 2) + '\n')
    console.log(
      `${source.id}: ${meta.lines} líneas, versión ${meta.version}, sha256 ${meta.sha256.slice(0, 12)}…`,
    )
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
