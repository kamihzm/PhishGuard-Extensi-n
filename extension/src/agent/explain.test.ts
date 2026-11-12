import { describe, expect, it } from 'vitest'
import type { RuleHit } from '../rules/types'
import { explain } from './explain'

describe('explain', () => {
  it('separa claramente qué vino de reglas y qué de ML', () => {
    const hits: RuleHit[] = [
      { id: 'suspicious-tld', weight: 20, explanation: 'El dominio usa un TLD sospechoso.' },
      { id: 'no-https', weight: 15, explanation: 'El sitio no usa HTTPS.' },
    ]

    const text = explain(hits, 0.82, 78, 'high')

    expect(text).toContain('Sistema experto')
    expect(text).toContain('El dominio usa un TLD sospechoso.')
    expect(text).toContain('El sitio no usa HTTPS.')
    expect(text).toContain('Machine Learning')
    expect(text).toContain('82%')
    expect(text).toContain('riesgo alto')
    expect(text).toContain('78/100')
  })

  it('cuando no hay reglas activadas lo dice explícitamente en vez de omitir la sección', () => {
    const text = explain([], 0.12, 8, 'low')
    expect(text).toContain('no se activó ninguna regla')
    expect(text).toContain('12%')
    expect(text).toContain('riesgo bajo')
  })

  it('traduce cada nivel de riesgo a su etiqueta en español', () => {
    expect(explain([], 0, 0, 'low')).toContain('riesgo bajo')
    expect(explain([], 0.5, 50, 'medium')).toContain('riesgo medio')
    expect(explain([], 1, 100, 'high')).toContain('riesgo alto')
  })
})
