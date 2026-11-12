import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Reglas de seguridad del Popup Guard verificadas sobre el código fuente:
 * no ejecuta cadenas, no registra URLs y solo cierra o retrocede pestañas
 * a través de las dependencias inyectadas (un único punto de decisión).
 */
const DIR = dirname(fileURLToPath(import.meta.url))
const RUNTIME = join(DIR, '..', 'runtime', 'registerPopupGuard.ts')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const FILES = [
  ...readdirSync(DIR)
    .filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts'))
    .map((n) => ({ name: n, code: strip(readFileSync(join(DIR, n), 'utf-8')) })),
  { name: 'registerPopupGuard.ts', code: strip(readFileSync(RUNTIME, 'utf-8')) },
]

describe('seguridad del Popup Guard', () => {
  it('revisa todos los módulos', () => {
    expect(FILES.map((f) => f.name)).toEqual(
      expect.arrayContaining([
        'popupGuard.ts',
        'popupClassifier.ts',
        'popupState.ts',
        'redirectGuard.ts',
        'navigationIntent.ts',
        'types.ts',
        'registerPopupGuard.ts',
      ]),
    )
  })

  it('sin eval, new Function ni temporizadores con cadenas', () => {
    for (const f of FILES) {
      expect(f.code, f.name).not.toMatch(
        /\beval\s*\(|\bnew\s+Function\b|set(?:Timeout|Interval)\(\s*['"`]/,
      )
    }
  })

  it('los registros no incluyen URLs ni datos de la intención', () => {
    for (const f of FILES) {
      for (const m of f.code.matchAll(/(?:\blog\(|console\.\w+\()([^)]*)\)/g)) {
        expect(m[1], f.name).not.toMatch(
          /url|href|chain|expected|intents?\b|sourceUrl|previousUrl/i,
        )
      }
    }
  })

  it('solo registerPopupGuard.ts toca chrome.tabs.remove / goBack (el resto usa dependencias inyectadas)', () => {
    for (const f of FILES.filter((x) => x.name !== 'registerPopupGuard.ts')) {
      expect(f.code, f.name).not.toMatch(/chrome\./)
    }
  })

  it('webRequest se usa solo para observar main_frame (sin bloqueo)', () => {
    const reg = FILES.find((f) => f.name === 'registerPopupGuard.ts')!.code
    expect(reg).toMatch(/types:\s*\['main_frame'\]/)
    // Se puede LEER `d.redirectUrl` (observar a dónde redirige), nunca devolver
    // `{ redirectUrl: … }` / `{ cancel: true }` (eso sería modo bloqueante).
    expect(reg).not.toMatch(/blocking|cancel:\s*true|redirectUrl\s*:/)
    expect(reg).toMatch(/onBeforeRedirect\.addListener/)
  })
})
