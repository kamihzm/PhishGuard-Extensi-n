import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import manifest from '../../manifest.config'
import rulesetIndex from './generated/rulesetIndex.json'
import {
  PAGE_LAYER_CONTENT_SCRIPTS,
  PAGE_LAYER_MATCHES,
  PAGE_LAYER_SCRIPT,
  YOUTUBE_MAIN_MATCHES,
  YOUTUBE_MAIN_SCRIPT,
} from './page/manifestEntries'
import { createPageAdapters } from './page/registry'
import {
  MEDIUM_NOTICE_CONTENT_SCRIPT,
  MEDIUM_NOTICE_SCRIPT,
} from '../ui/mediumNotice/manifestEntry'
import { YOUTUBE_MATCHES } from './page/adapters/youtube/adapter'

type ManifestShape = {
  permissions: string[]
  host_permissions: string[]
  web_accessible_resources: Array<{ resources: string[] }>
  content_scripts?: Array<{
    matches: string[]
    js: string[]
    run_at?: string
    all_frames?: boolean
    world?: string
  }>
  declarative_net_request: { rule_resources: Array<{ id: string; enabled: boolean; path: string }> }
}
const m = manifest as unknown as ManifestShape
const EXTENSION_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

describe('manifest: integración mínima de Web Protection', () => {
  it('permisos mínimos: declarativeNetRequest y webRequest (solo observación); sin scripting, sin tabs, sin bloqueo', () => {
    expect(m.permissions).toEqual([
      'webNavigation',
      'storage',
      'declarativeNetRequest',
      'webRequest',
    ])
    for (const p of ['scripting', 'tabs', 'webRequestBlocking', 'declarativeNetRequestFeedback']) {
      expect(m.permissions).not.toContain(p)
    }
    expect(m.host_permissions).toEqual(['<all_urls>'])
  })

  it('no cambia los recursos accesibles: solo la advertencia de phishing', () => {
    expect(m.web_accessible_resources.flatMap((w) => w.resources)).toEqual([
      'src/ui/warning/warning.html',
    ])
  })

  it('declara los 19 rulesets del índice, TODOS deshabilitados (fail-open hasta que el gestor los habilite)', () => {
    const resources = m.declarative_net_request.rule_resources
    expect(resources.map((r) => r.id)).toEqual(rulesetIndex.rulesets.map((r) => r.id))
    expect(resources.every((r) => r.enabled === false)).toBe(true)
    expect(resources.every((r) => r.path.startsWith('generated/rulesets/'))).toBe(true)
  })

  it('respeta los límites de Chrome: ≤ 100 rulesets declarados', () => {
    expect(m.declarative_net_request.rule_resources.length).toBeLessThanOrEqual(100)
  })

  it.runIf(existsSync(join(EXTENSION_DIR, 'generated', 'rulesets')))(
    'cada ruleset declarado existe tras compilar (npm run wp:compile)',
    () => {
      for (const r of m.declarative_net_request.rule_resources) {
        expect(existsSync(join(EXTENSION_DIR, r.path))).toBe(true)
      }
    },
  )
})

describe('manifest: capa de página (content scripts estáticos)', () => {
  const scripts = m.content_scripts ?? []
  const pageLayer = scripts.find((c) => c.js.includes(PAGE_LAYER_SCRIPT))
  const youtubeMain = scripts.find((c) => c.js.includes(YOUTUBE_MAIN_SCRIPT))

  it('declara exactamente los content scripts de manifestEntries.ts (motor aislado y parte MAIN de YouTube) más el aviso de nivel medio', () => {
    expect(scripts).toEqual([...PAGE_LAYER_CONTENT_SCRIPTS, MEDIUM_NOTICE_CONTENT_SCRIPT])
    expect(scripts).toHaveLength(3)
    expect(pageLayer).toBeDefined()
    expect(youtubeMain).toBeDefined()
  })

  it('el motor corre en el mundo aislado, solo en el marco principal, en document_start y solo http(s)', () => {
    expect(pageLayer?.world).toBeUndefined()
    expect(pageLayer?.all_frames).toBe(false)
    expect(pageLayer?.run_at).toBe('document_start')
    expect(pageLayer?.matches).toEqual(['http://*/*', 'https://*/*'])
  })

  it('el script del mundo MAIN se limita a www.youtube.com (mismos patrones que su adaptador)', () => {
    expect(youtubeMain?.world).toBe('MAIN')
    expect(youtubeMain?.run_at).toBe('document_start')
    expect(youtubeMain?.all_frames).toBe(false)
    expect(youtubeMain?.matches).toEqual(YOUTUBE_MAIN_MATCHES)
    expect([...YOUTUBE_MATCHES]).toEqual(YOUTUBE_MAIN_MATCHES)
    // Ningún otro script corre en el mundo MAIN.
    expect(scripts.filter((c) => c.world === 'MAIN')).toHaveLength(1)
  })

  it('cada adaptador declara patrones cubiertos por los del motor (http/https)', () => {
    for (const adapter of createPageAdapters(null)) {
      for (const pattern of adapter.matches) {
        expect(PAGE_LAYER_MATCHES.some((p) => pattern.startsWith(p.slice(0, p.indexOf('*'))))).toBe(
          true,
        )
      }
    }
  })

  it('los content scripts se empaquetan como IIFE síncrono (*.iife.ts), sin cargador asíncrono', () => {
    for (const c of scripts) for (const js of c.js) expect(js).toMatch(/.iife.ts$/)
  })

  it('el aviso de nivel medio corre en el mundo aislado, solo en el marco principal y solo http(s), sin exponer recursos', () => {
    const notice = scripts.find((c) => c.js.includes(MEDIUM_NOTICE_SCRIPT))
    expect(notice?.world).toBeUndefined()
    expect(notice?.all_frames).toBe(false)
    expect(notice?.run_at).toBe('document_idle')
    expect(notice?.matches).toEqual(['http://*/*', 'https://*/*'])
    expect(JSON.stringify(m.web_accessible_resources)).not.toContain('mediumNotice')
  })

  it('el índice cosmético NO se expone a las páginas (no es web_accessible_resource)', () => {
    expect(JSON.stringify(m.web_accessible_resources)).not.toContain('cosmetic')
  })
})
