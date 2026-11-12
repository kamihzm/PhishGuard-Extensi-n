import { describe, expect, it } from 'vitest'
import {
  detectDomainImpersonation,
  IMPERSONATION_SIMILARITY_THRESHOLD,
} from './detectImpersonation'
import { REFERENCE_DOMAINS } from './referenceDomains'

describe('detectDomainImpersonation — coincidencia exacta', () => {
  it.each([...REFERENCE_DOMAINS])(
    'el dominio de referencia "%s" nunca es impersonation de sí mismo',
    (domain) => {
      const result = detectDomainImpersonation(domain)
      expect(result.isImpersonation).toBe(false)
      expect(result.similarityScore).toBe(1)
    },
  )

  it('una coincidencia exacta con mayúsculas/punto final tampoco se marca', () => {
    const result = detectDomainImpersonation('Microsoft.COM.')
    expect(result.isImpersonation).toBe(false)
  })
})

describe('detectDomainImpersonation — lookalikes conocidos', () => {
  it.each([
    ['rnicrosoft.com', 'microsoft.com'],
    ['microsfot.com', 'microsoft.com'],
    ['g00gle.com', 'google.com'],
    ['gooogle.com', 'google.com'],
    ['paypa1.com', 'paypal.com'],
    ['faceboook.com', 'facebook.com'],
    ['bancolornbia.com', 'bancolombia.com'],
    ['davivenda.com', 'davivienda.com'],
    // Marcas agregadas tras auditar Seguridad-master (ver
    // docs/reference-audit-seguridad-master.md) — mismo mecanismo, sin
    // técnica nueva, solo lista de referencia ampliada.
    ['d1an.gov.co', 'dian.gov.co'],
    ['servlentrega.com', 'servientrega.com'],
    ['bancoagrari0.com.co', 'bancoagrario.com.co'],
    ['lul0bank.com', 'lulobank.com'],
  ])('"%s" se detecta como impersonation de "%s"', (lookalike, expectedReference) => {
    const result = detectDomainImpersonation(lookalike)
    expect(result.isImpersonation).toBe(true)
    expect(result.referenceDomain).toBe(expectedReference)
    expect(result.similarityScore).toBeGreaterThanOrEqual(IMPERSONATION_SIMILARITY_THRESHOLD)
  })

  it('"rnicrosoft.com" se detecta específicamente por sustitución visual (rn→m)', () => {
    const result = detectDomainImpersonation('rnicrosoft.com')
    expect(result.technique).toBe('visual-substitution')
  })

  it.each(['p4yp4l.com', 'g009le.com', 'bbv4.com.co', 'n3tflix.com'])(
    '"%s" (leetspeak — Fase 2 del audit de Seguridad-master) solo se detecta con el fold visual ampliado',
    (lookalike) => {
      const result = detectDomainImpersonation(lookalike)
      expect(result.isImpersonation).toBe(true)
      expect(result.technique).toBe('visual-substitution')
    },
  )
})

describe('detectDomainImpersonation — dominios no relacionados (sin falsos positivos)', () => {
  it.each(['example.com', 'wikipedia.org', 'github.com', 'stackoverflow.com', 'mozilla.org'])(
    '"%s" no se marca como impersonation',
    (domain) => {
      const result = detectDomainImpersonation(domain)
      expect(result.isImpersonation).toBe(false)
      expect(result.referenceDomain).toBeNull()
    },
  )
})

describe('detectDomainImpersonation — subdominio distinto no cuenta como coincidencia exacta', () => {
  it('"accounts.microsoft.com" (si llegara como dominio registrable completo) no es igual a "microsoft.com"', () => {
    // Nota: en producción, quien llama pasa el DOMINIO REGISTRABLE
    // (`urlParts.ts`), nunca el hostname completo — este caso documenta
    // qué pasaría si alguien pasara el hostname completo por error: no
    // debe explotar, y no coincide exactamente.
    const result = detectDomainImpersonation('accounts.microsoft.com')
    expect(result.isImpersonation).toBe(false) // ni siquiera se parece lo suficiente como string completo
  })
})
