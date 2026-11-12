/**
 * Compila los snapshots versionados de las fuentes aprobadas a reglas DNR
 * y las parte en rulesets estáticos Core/opcionales (Fases B y C; nada se
 * carga todavía en el navegador).
 *
 * - `out/<id>.rules.json`: todas las reglas de una lista (no se versiona).
 * - `extension/generated/rulesets/<rulesetId>.json`: rulesets particionados
 *   que se EMPAQUETAN en la extensión (`rule_resources` del manifest). No se
 *   versionan: `npm run build` los regenera desde los snapshots versionados.
 * - `extension/src/webProtection/generated/rulesetIndex.json`: índice
 *   (tier, orden, conteos, SHA-256) que usan el manifest y el gestor de
 *   cuota (versionado).
 * - `out/report.json`: conteos por lista, por motivo y de la partición,
 *   con SHA-256 de entrada y de salida para verificar la reproducibilidad.
 *
 * Uso (desde extension/): npm run wp:compile
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  compileCosmetic,
  type CosmeticCompileReport,
  type CosmeticIndex,
} from '../../extension/src/webProtection/cosmetic/compileCosmetic'
import { compileList } from '../../extension/src/webProtection/filters/compileList'
import {
  compilePopupIndex,
  type PopupIndexReport,
} from '../../extension/src/webProtection/popups/popupIndex'
import type { CompileReport, DnrRule } from '../../extension/src/webProtection/filters/types'
import {
  CORE_RULE_BUDGET,
  GUARANTEED_MINIMUM_STATIC_RULES,
  OPTIONAL_CHUNK_SIZE,
} from '../../extension/src/webProtection/quota/constants'
import { partitionRulesets } from '../../extension/src/webProtection/quota/partition'
import type { RulesetIndex } from '../../extension/src/webProtection/quota/types'
import {
  approvedSources,
  OUT_DIR,
  snapshotMetaPath,
  snapshotPath,
  type SnapshotMeta,
  TOOL_DIR,
} from './sourceRegistry'
import { staleSnapshotWarning } from './snapshotAge'

const EXTENSION_DIR = join(TOOL_DIR, '..', '..', 'extension')
/** Carpeta de rulesets dentro de la extensión; el `path` de cada descriptor es relativo a su raíz. */
const RULESETS_PACKAGE_PATH = 'generated/rulesets'
const RULESETS_DIR = join(EXTENSION_DIR, RULESETS_PACKAGE_PATH)
const INDEX_PATH = join(EXTENSION_DIR, 'src', 'webProtection', 'generated', 'rulesetIndex.json')
/** Índice cosmético por dominio (capa de página); versionado igual que el índice de rulesets. */
const COSMETIC_INDEX_PATH = join(
  EXTENSION_DIR,
  'src',
  'webProtection',
  'generated',
  'cosmeticIndex.json',
)

/** Índice de evidencia del Popup Guard (reglas `$popup` y hosts de EasyList). */
const POPUP_INDEX_PATH = join(EXTENSION_DIR, 'src', 'webProtection', 'generated', 'popupIndex.json')

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

/** Une índices cosméticos de varias listas sin duplicar selectores, con orden estable. */
function mergeCosmetic(target: CosmeticIndex, source: CosmeticIndex): void {
  for (const key of ['hide', 'allow'] as const) {
    for (const [domain, selectors] of Object.entries(source[key])) {
      target[key][domain] = [...new Set([...(target[key][domain] ?? []), ...selectors])].sort()
    }
  }
}

function main(): void {
  mkdirSync(OUT_DIR, { recursive: true })
  mkdirSync(RULESETS_DIR, { recursive: true })
  mkdirSync(dirname(INDEX_PATH), { recursive: true })
  const compiled: Array<{ listId: string; category: CompileReport['category']; rules: DnrRule[] }> =
    []
  const lists: Array<{
    source: { id: string; name: string; license: string; licenseUrl: string }
    snapshot: Pick<SnapshotMeta, 'sha256' | 'version' | 'lastModified' | 'fetchedAt'>
    rulesetSha256: string
    report: CompileReport
  }> = []
  const cosmeticIndex: CosmeticIndex = { hide: {}, allow: {} }
  const cosmeticReports: Array<{ listId: string; report: CosmeticCompileReport }> = []
  let popupJson = ''
  let popupReport: PopupIndexReport | null = null

  for (const source of approvedSources()) {
    if (!existsSync(snapshotPath(source.id))) {
      throw new Error(`Falta el snapshot de ${source.id}: ejecuta primero npm run wp:fetch`)
    }
    const text = readFileSync(snapshotPath(source.id), 'utf-8')
    const meta = JSON.parse(readFileSync(snapshotMetaPath(source.id), 'utf-8')) as SnapshotMeta
    if (sha256(text) !== meta.sha256) {
      throw new Error(`${source.id}: el snapshot no coincide con su SHA-256 registrado`)
    }
    // Las reglas DNR quedan fijas en cada build: avisar si la copia de la lista está vieja.
    const staleWarning = staleSnapshotWarning(meta, new Date())
    if (staleWarning) console.warn(`AVISO [Web Protection] ${staleWarning}`)

    const { rules, report } = compileList(text, { listId: source.id, category: source.category })
    if (!report.check.sumsToTotal) {
      throw new Error(`${source.id}: los conteos no suman el total de líneas`)
    }
    // Capa de página: solo las listas de anuncios aportan filtros cosméticos.
    if (source.category === 'ads') {
      const cosmetic = compileCosmetic(text)
      mergeCosmetic(cosmeticIndex, cosmetic.index)
      cosmeticReports.push({ listId: source.id, report: cosmetic.report })
      const popup = compilePopupIndex(text)
      popupJson = JSON.stringify(popup.index)
      popupReport = popup.report
    }

    const ruleset = JSON.stringify(rules)
    writeFileSync(join(OUT_DIR, `${source.id}.rules.json`), ruleset)
    compiled.push({ listId: source.id, category: source.category, rules })
    lists.push({
      source: {
        id: source.id,
        name: source.name,
        license: source.license,
        licenseUrl: source.licenseUrl,
      },
      snapshot: {
        sha256: meta.sha256,
        version: meta.version,
        lastModified: meta.lastModified,
        fetchedAt: meta.fetchedAt,
      },
      rulesetSha256: sha256(ruleset),
      report,
    })

    const topRejected = Object.entries(report.rejected)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 6)
      .map(([reason, count]) => `${reason}=${count}`)
      .join(', ')
    console.log(
      `${source.id}: ${report.totalLines} líneas → ${report.dnrRules} reglas DNR ` +
        `(aceptadas ${report.accepted}, duplicadas ${report.duplicatesRemoved}, rechazadas ${report.rejectedTotal}, ` +
        `cosméticas diferidas ${report.deferredCosmeticTotal}, comentarios ${report.comments}, ` +
        `badfilter ${report.badfilterDirectives}/${report.badfilterCancelled})\n  principales rechazos: ${topRejected}`,
    )
  }
  const totalRules = lists.reduce((sum, list) => sum + list.report.dnrRules, 0)

  // Fase C: Core (dentro del mínimo garantizado) + rulesets opcionales.
  const partition = partitionRulesets(compiled, {
    coreBudget: CORE_RULE_BUDGET,
    chunkSize: OPTIONAL_CHUNK_SIZE,
  })
  const index: RulesetIndex = {
    guaranteedMinimumStaticRules: GUARANTEED_MINIMUM_STATIC_RULES,
    coreRuleBudget: CORE_RULE_BUDGET,
    optionalChunkSize: OPTIONAL_CHUNK_SIZE,
    rulesets: partition.rulesets.map((ruleset) => {
      const json = JSON.stringify(ruleset.rules)
      writeFileSync(join(RULESETS_DIR, `${ruleset.id}.json`), json)
      return {
        id: ruleset.id,
        listId: ruleset.listId,
        category: ruleset.category,
        tier: ruleset.tier,
        ruleCount: ruleset.rules.length,
        exceptionCount: ruleset.exceptionCount,
        order: ruleset.order,
        path: `${RULESETS_PACKAGE_PATH}/${ruleset.id}.json`,
        sha256: sha256(json),
      }
    }),
  }
  writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2) + '\n')
  const cosmeticJson = JSON.stringify(cosmeticIndex)
  writeFileSync(COSMETIC_INDEX_PATH, cosmeticJson + '\n')
  writeFileSync(POPUP_INDEX_PATH, popupJson + '\n')
  const partitionedTotal = index.rulesets.reduce((sum, ruleset) => sum + ruleset.ruleCount, 0)
  if (partitionedTotal !== totalRules) {
    throw new Error(`La partición tiene ${partitionedTotal} reglas y el compilado ${totalRules}`)
  }

  const output = {
    $comment:
      'Generado por tools/webProtection/compile.ts a partir de los snapshots de tools/webProtection/sources/. Reglas derivadas de EasyList/EasyPrivacy bajo CC BY-SA 3.0 (ver PROVENANCE.md).',
    guaranteedMinimumStaticRules: GUARANTEED_MINIMUM_STATIC_RULES,
    totalDnrRules: totalRules,
    lists,
    cosmetic: { sha256: sha256(cosmeticJson), lists: cosmeticReports },
    popupEvidence: { sha256: sha256(popupJson), report: popupReport },
    partition: {
      coreRuleBudget: CORE_RULE_BUDGET,
      coreRuleCount: partition.coreRuleCount,
      optionalChunkSize: OPTIONAL_CHUNK_SIZE,
      rulesets: index.rulesets.length,
      perList: partition.stats,
    },
  }
  writeFileSync(join(OUT_DIR, 'report.json'), JSON.stringify(output, null, 2) + '\n')

  console.log(`\nTotal: ${totalRules} reglas DNR en ${index.rulesets.length} rulesets`)
  for (const r of index.rulesets) {
    console.log(
      `  ${r.id.padEnd(24)} ${r.tier.padEnd(8)} orden=${String(r.order).padStart(2)} ` +
        `reglas=${String(r.ruleCount).padStart(5)} excepciones=${r.exceptionCount}`,
    )
  }
  for (const { listId, report } of cosmeticReports) {
    console.log(
      `Cosméticos ${listId}: ${report.selectors} selectores en ${report.domains} dominios ` +
        `(ocultar ${report.domainSpecificHide}, excepciones ${report.domainSpecificAllow}, ` +
        `descartados ${JSON.stringify(report.skipped)})`,
    )
  }
  console.log(`Evidencia de popups (easylist): ${JSON.stringify(popupReport)}`)
  console.log(
    `Core: ${partition.coreRuleCount} reglas (presupuesto ${CORE_RULE_BUDGET}, garantizado por Chrome ${GUARANTEED_MINIMUM_STATIC_RULES})`,
  )
}

main()
