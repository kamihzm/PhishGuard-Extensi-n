import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Reglas de seguridad de la capa de página verificadas sobre el código
 * fuente (no solo por revisión): el código que corre en páginas —y en
 * especial el del mundo MAIN— no ejecuta cadenas, no inyecta HTML y no
 * registra URLs, consultas ni contenido.
 */
const PAGE_DIR = dirname(fileURLToPath(import.meta.url))

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [path] : []
  })
}

const FILES = sources(PAGE_DIR).map((path) => ({
  path: relative(PAGE_DIR, path),
  // Sin comentarios: las reglas se aplican al código, no a la documentación.
  code: readFileSync(path, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1'),
}))

const FORBIDDEN: Array<[string, RegExp]> = [
  ['eval', /\beval\s*\(/],
  ['new Function', /\bnew\s+Function\b/],
  ['setTimeout/setInterval con cadena', /set(?:Timeout|Interval)\(\s*['"`]/],
  ['innerHTML/outerHTML asignado', /\.(?:inner|outer)HTML\s*=/],
  ['insertAdjacentHTML', /insertAdjacentHTML/],
  ['document.write', /document\.write/],
  ['importScripts', /importScripts/],
  ['pointer-events global', /pointer-events/],
]

describe('seguridad de la capa de página', () => {
  it('hay archivos que revisar (el test no pasa en vacío)', () => {
    expect(FILES.map((f) => f.path)).toEqual(
      expect.arrayContaining([
        'engine.ts',
        join('adapters', 'youtube', 'mainWorld.ts'),
        join('entries', 'youtubeMain.iife.ts'),
      ]),
    )
  })

  it.each(FORBIDDEN)('ningún archivo usa %s', (_name, pattern) => {
    expect(FILES.filter((f) => pattern.test(f.code)).map((f) => f.path)).toEqual([])
  })

  it('los logs no incluyen URLs, hostnames, consultas ni HTML', () => {
    const logCalls = FILES.flatMap((f) =>
      [...f.code.matchAll(/\blog\(([^)]*)\)|console\.\w+\(([^)]*)\)/g)].map((m) => ({
        path: f.path,
        args: m[1] ?? m[2] ?? '',
      })),
    )
    expect(logCalls.length).toBeGreaterThan(0)
    for (const call of logCalls) {
      expect(call.args, call.path).not.toMatch(
        /location|href|url|hostname|search|query|innerText|textContent|HTML/i,
      )
    }
  })

  it('el canal hacia el MAIN no transporta datos: nunca se lee event.detail', () => {
    for (const f of FILES.filter((x) => /youtubeMain|mainWorld|mainChannel/.test(x.path))) {
      expect(f.code, f.path).not.toMatch(/.detail/)
    }
  })

  it('la parte MAIN no lee chrome.* ni accede al storage de la extensión', () => {
    for (const f of FILES.filter((x) => /youtubeMain|mainWorld|sanitize/.test(x.path))) {
      expect(f.code, f.path).not.toMatch(/\bchrome\./)
    }
  })
})
