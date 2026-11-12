import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Separación estricta Phishing Engine ↔ Web Protection
 * (docs/web-protection-audit.md §3 y §7): ningún archivo de un lado puede
 * importar del otro, en ninguna dirección. Se resuelven las rutas reales
 * de cada import relativo, no se buscan cadenas sueltas.
 */
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPO = resolve(SRC, '..', '..')
const WEB_PROTECTION_DIRS = [join(SRC, 'webProtection'), join(REPO, 'tools', 'webProtection')]
const PHISHING_ENGINE_DIRS = ['agent', 'features', 'rules', 'ml', 'domainSimilarity'].map((d) =>
  join(SRC, d),
)

const IMPORT_PATTERN =
  /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g

function tsFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory())
      return name === 'node_modules' || name === 'out' ? [] : tsFiles(path)
    return name.endsWith('.ts') ? [path] : []
  })
}

function resolvedImports(file: string): string[] {
  const source = readFileSync(file, 'utf-8')
  const targets: string[] = []
  for (const match of source.matchAll(IMPORT_PATTERN)) {
    const specifier = match[1] ?? match[2]
    if (specifier?.startsWith('.')) targets.push(resolve(dirname(file), specifier))
  }
  return targets
}

const isInside = (path: string, dirs: string[]) =>
  dirs.some((dir) => path === dir || path.startsWith(dir + sep))

describe('arquitectura: Web Protection y Phishing Engine no se importan entre sí', () => {
  const webProtectionFiles = WEB_PROTECTION_DIRS.flatMap(tsFiles)
  const phishingFiles = PHISHING_ENGINE_DIRS.flatMap(tsFiles)

  it('hay archivos que revisar en ambos lados (el test no pasa en vacío)', () => {
    expect(webProtectionFiles.length).toBeGreaterThan(0)
    expect(phishingFiles.length).toBeGreaterThan(0)
  })

  it('cubre todos los módulos de Web Protection (filters, quota) y el tooling offline', () => {
    const covered = (fragment: string) => webProtectionFiles.some((file) => file.includes(fragment))
    expect(covered(join('webProtection', 'filters', 'compileList.ts'))).toBe(true)
    expect(covered(join('webProtection', 'quota', 'quotaManager.ts'))).toBe(true)
    expect(covered(join('webProtection', 'quota', 'partition.ts'))).toBe(true)
    expect(covered(join('tools', 'webProtection', 'compile.ts'))).toBe(true)
    // Capa de página: motor, adaptadores, parte MAIN y servicio cosmético.
    expect(covered(join('webProtection', 'page', 'engine.ts'))).toBe(true)
    expect(covered(join('webProtection', 'page', 'adapters', 'youtube', 'mainWorld.ts'))).toBe(true)
    expect(covered(join('webProtection', 'page', 'adapters', 'jkanime', 'detect.ts'))).toBe(true)
    expect(covered(join('webProtection', 'cosmetic', 'compileCosmetic.ts'))).toBe(true)
    expect(covered(join('webProtection', 'runtime', 'cosmeticService.ts'))).toBe(true)
    // Popup Guard.
    expect(covered(join('webProtection', 'popups', 'popupGuard.ts'))).toBe(true)
    expect(covered(join('webProtection', 'popups', 'popupClassifier.ts'))).toBe(true)
    expect(covered(join('webProtection', 'runtime', 'registerPopupGuard.ts'))).toBe(true)
  })

  it('ningún archivo de Web Protection importa del motor de phishing', () => {
    const violations = webProtectionFiles.flatMap((file) =>
      resolvedImports(file)
        .filter((target) => isInside(target, PHISHING_ENGINE_DIRS))
        .map((target) => `${relative(REPO, file)} → ${relative(REPO, target)}`),
    )
    expect(violations).toEqual([])
  })

  it('ningún archivo del motor de phishing importa de Web Protection', () => {
    const violations = phishingFiles.flatMap((file) =>
      resolvedImports(file)
        .filter((target) => isInside(target, WEB_PROTECTION_DIRS))
        .map((target) => `${relative(REPO, file)} → ${relative(REPO, target)}`),
    )
    expect(violations).toEqual([])
  })

  it('el registro de intención de Web Protection solo se usa dentro de Web Protection', () => {
    // Claves de `intentRecord.ts`: el resto de la extensión (incluido el motor de
    // phishing, background, trustedSites y la UI) no las lee ni las escribe, ni
    // importa sus módulos. Se revisan todos los archivos fuera de webProtection/.
    const forbidden = [
      'phishguard:wp:intent:',
      'phishguard:wp:intent-token:',
      'phishguard:wp:intent-session',
    ]
    const intentModules = [
      join(SRC, 'webProtection', 'popups', 'intentRecord'),
      join(SRC, 'webProtection', 'runtime', 'intentStore'),
    ]
    const outside = tsFiles(SRC).filter((file) => !isInside(file, WEB_PROTECTION_DIRS))
    expect(outside.some((f) => f.includes(join('background', 'navigationGate.ts')))).toBe(true)
    const violations = outside.flatMap((file) => {
      const source = readFileSync(file, 'utf-8')
      const keys = forbidden.filter((k) => source.includes(k)).map((k) => `${k} en`)
      const imports = resolvedImports(file).filter((t) => intentModules.includes(t))
      return [...keys, ...imports.map(() => 'import de')].map(
        (what) => `${what} ${relative(REPO, file)}`,
      )
    })
    expect(violations).toEqual([])
  })

  it('el detector funciona: reconoce un import cruzado si existiera', () => {
    const fakeFile = join(SRC, 'webProtection', 'fake.ts')
    const target = resolve(dirname(fakeFile), '../agent/combine')
    expect(isInside(target, PHISHING_ENGINE_DIRS)).toBe(true)
  })
})
