import { describe, expect, it } from 'vitest'
import { MAX_SNAPSHOT_AGE_DAYS, staleSnapshotWarning } from './snapshotAge'

const NOW = new Date('2026-10-12T12:00:00.000Z')

describe('staleSnapshotWarning', () => {
  it('no avisa con un snapshot reciente', () => {
    expect(
      staleSnapshotWarning({ id: 'easylist', fetchedAt: '2026-10-11T12:00:00.000Z' }, NOW),
    ).toBeNull()
  })

  it('no avisa justo en el límite', () => {
    const fetchedAt = new Date(NOW.getTime() - MAX_SNAPSHOT_AGE_DAYS * 86_400_000).toISOString()
    expect(staleSnapshotWarning({ id: 'easylist', fetchedAt }, NOW)).toBeNull()
  })

  it('avisa con más días que el límite, indicando cómo actualizar', () => {
    const warning = staleSnapshotWarning(
      { id: 'easylist', fetchedAt: '2026-09-29T21:04:38.289Z' },
      NOW,
    )
    expect(warning).toContain('easylist: el snapshot tiene 12 días')
    expect(warning).toContain('npm run wp:fetch')
  })

  it('avisa si la fecha no se puede leer', () => {
    expect(staleSnapshotWarning({ id: 'easyprivacy', fetchedAt: 'no-es-fecha' }, NOW)).toContain(
      'no se pudo leer',
    )
  })
})
