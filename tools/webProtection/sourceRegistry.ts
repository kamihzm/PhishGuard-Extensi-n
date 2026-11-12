import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ListCategory } from '../../extension/src/webProtection/filters/types'

export const TOOL_DIR = dirname(fileURLToPath(import.meta.url))
export const SOURCES_DIR = join(TOOL_DIR, 'sources')
export const OUT_DIR = join(TOOL_DIR, 'out')

export interface SourceDefinition {
  id: string
  name: string
  category: ListCategory
  url: string
  homepage: string
  license: string
  licenseUrl: string
  redistribution: string
  approvedForBundling: boolean
}

/** Metadatos del snapshot descargado: permiten verificar que la compilación es reproducible. */
export interface SnapshotMeta {
  id: string
  url: string
  fetchedAt: string
  sha256: string
  bytes: number
  lines: number
  /** Cabecera `! Version:` de la lista (si existe). */
  version: string | null
  lastModified: string | null
}

/** Solo las fuentes con licencia verificada y aprobadas para empaquetar (§2). */
export function approvedSources(): SourceDefinition[] {
  const { sources } = JSON.parse(readFileSync(join(TOOL_DIR, 'sources.json'), 'utf-8')) as {
    sources: SourceDefinition[]
  }
  return sources.filter((source) => source.approvedForBundling)
}

export function snapshotPath(id: string): string {
  return join(SOURCES_DIR, `${id}.txt`)
}

export function snapshotMetaPath(id: string): string {
  return join(SOURCES_DIR, `${id}.meta.json`)
}
