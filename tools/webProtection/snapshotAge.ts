import type { SnapshotMeta } from './sourceRegistry'

/**
 * Antigüedad máxima de un snapshot antes de avisar en el build. EasyList y
 * EasyPrivacy declaran `! Expires: 4 days`; se deja margen hasta 7 días para
 * no avisar en cada build, pero sí antes de que la copia quede claramente
 * vieja (2026-10-05: en animeyt.cc un snapshot de 6 días no tenía los
 * dominios de respaldo de un popunder que la lista vigente ya bloqueaba).
 */
export const MAX_SNAPSHOT_AGE_DAYS = 7

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Texto de aviso si el snapshot se descargó hace más de
 * `MAX_SNAPSHOT_AGE_DAYS` (o si su fecha no se puede leer); `null` si está
 * al día. Es solo un aviso: el build no falla.
 */
export function staleSnapshotWarning(
  meta: Pick<SnapshotMeta, 'id' | 'fetchedAt'>,
  now: Date,
): string | null {
  const fetched = Date.parse(meta.fetchedAt)
  if (Number.isNaN(fetched)) {
    return `${meta.id}: no se pudo leer la fecha de descarga del snapshot ("${meta.fetchedAt}"); actualízalo con npm run wp:fetch`
  }
  const days = Math.floor((now.getTime() - fetched) / DAY_MS)
  if (days <= MAX_SNAPSHOT_AGE_DAYS) return null
  return `${meta.id}: el snapshot tiene ${days} días (descargado ${meta.fetchedAt.slice(0, 10)}, máximo recomendado ${MAX_SNAPSHOT_AGE_DAYS}); actualízalo con npm run wp:fetch y recompila`
}
