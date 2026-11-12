import { describe, expect, it } from 'vitest'
import { decide } from './orchestrator'

describe('decide(): el ML no se aplica en plataformas de hosting ni en dominios con Punycode', () => {
  it('plataforma de hosting: probabilidad 0, motivo "plataforma" y la explicación lo dice', () => {
    const d = decide('https://notion-blog-nextjs-ejemplo.vercel.app/')
    expect(d.mlSkippedReason).toBe('plataforma')
    expect(d.mlProbability).toBe(0)
    expect(d.explanation).toContain('no se aplicó')
  })

  it('dominio internacional legítimo: sin ML y sin subir de nivel (solo aviso informativo)', () => {
    const d = decide('https://xn--mnchen-3ya.de/')
    expect(d.mlSkippedReason).toBe('idn')
    expect(d.activatedRules.map((h) => h.id)).toContain('punycode')
    expect(d.riskLevel).toBe('low')
  })

  it('homoglifo de una marca: ALTO por reglas aunque el ML no se aplique', () => {
    const d = decide('https://xn--pypal-4ve.com/account')
    expect(d.mlSkippedReason).toBe('idn')
    expect(d.riskLevel).toBe('high')
  })

  it('dominio propio (no plataforma ni IDN): el ML sí se aplica', () => {
    const d = decide('https://www.wikipedia.org/wiki/Colombia')
    expect(d.mlSkippedReason).toBeUndefined()
    expect(d.mlProbability).toBeGreaterThan(0)
  })
})
