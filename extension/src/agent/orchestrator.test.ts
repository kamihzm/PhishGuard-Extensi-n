import { describe, expect, it } from 'vitest'
import { MEDIUM_FLOOR_SCORE, RULE_OVERRIDE_SCORE } from './combine'
import { decide } from './orchestrator'

describe('decide', () => {
  it('arma un Decision completo, con reglas y ML visibles por separado', () => {
    const result = decide('https://www.google.com/search?q=hola')

    expect(result.url).toBe('https://www.google.com/search?q=hola')
    expect(typeof result.ruleScore).toBe('number')
    expect(result.mlProbability).toBeGreaterThanOrEqual(0)
    expect(result.mlProbability).toBeLessThanOrEqual(1)
    expect(Number.isInteger(result.finalScore)).toBe(true)
    expect(['low', 'medium', 'high']).toContain(result.riskLevel)
    expect(Array.isArray(result.activatedRules)).toBe(true)
    expect(result.explanation).toContain('Sistema experto')
    expect(result.explanation).toContain('Machine Learning')
  })

  it('una URL con una regla FUERTE (punycode) garantiza al menos RULE_OVERRIDE_SCORE vía el override', () => {
    // "xn--pypal-4ve.com" dispara "punycode" (y de paso "many-hyphens") — ambas
    // están en STRONG_RULE_IDS, así que el override debe aplicar sin importar el ML.
    const result = decide('https://xn--pypal-4ve.com/account')

    expect(result.activatedRules.some((hit) => hit.id === 'punycode')).toBe(true)
    expect(result.finalScore).toBeGreaterThanOrEqual(RULE_OVERRIDE_SCORE)
    expect(result.riskLevel).toBe('high')
  })

  it('"IP como host" activa la regla pero YA NO garantiza "alto" por sí sola (ip-as-host no es una regla fuerte)', () => {
    // Se removió de STRONG_RULE_IDS tras encontrar un falso positivo real
    // (portal cautivo de wifi con IP privada) — ver agent/combine.ts.
    const result = decide('http://192.168.1.50/login?verificar=1')

    expect(result.activatedRules.some((hit) => hit.id === 'ip-as-host')).toBe(true)
    expect(result.riskLevel).not.toBe('high')
  })

  it('caso real que motivó el piso de corroboración: IP privada + HTTP + "verificar" (3 reglas no fuertes) → al menos "medio", ya no "bajo"', () => {
    // Antes de agregar MEDIUM_FLOOR_MIN_RULES, esta URL daba finalScore=17 ("bajo") porque
    // el ML le asignaba una probabilidad muy baja y ninguna regla activada era "fuerte".
    // Con 3 reglas no fuertes corroborándose (ip-as-host, sensitive-words, no-https), ahora
    // el piso de 35 la saca de "bajo" sin necesidad de tratar ip-as-host como regla fuerte.
    const result = decide('http://192.168.1.50/login?verificar=1')

    expect(result.activatedRules.length).toBeGreaterThanOrEqual(3)
    expect(result.finalScore).toBeGreaterThanOrEqual(MEDIUM_FLOOR_SCORE)
    expect(result.riskLevel).not.toBe('low')
  })

  it('una URL sin ninguna señal de reglas deja eso explícito en la explicación', () => {
    const result = decide('https://ejemplo.com.co/')
    expect(result.activatedRules).toHaveLength(0)
    expect(result.ruleScore).toBe(0)
    expect(result.explanation).toContain('no se activó ninguna regla')
  })

  it('propaga el error de extractFeatures si la URL no es parseable (igual que hoy en background/popup)', () => {
    expect(() => decide('no-es-una-url')).toThrow()
  })

  it('es determinista: la misma URL produce siempre el mismo Decision', () => {
    const first = decide('http://banco-colombia-verificar-cuenta.top/login')
    const second = decide('http://banco-colombia-verificar-cuenta.top/login')
    expect(second).toEqual(first)
  })

  describe('regresión: at-symbol ya NO activa por un "@" en el pathname (falso positivo de YouTube)', () => {
    it.each([
      'https://www.youtube.com/@MegaSawaya',
      'https://www.youtube.com/@GoogleDevelopers/videos',
      'https://www.youtube.com/results?search_query=@usuario',
    ])('%s no activa at-symbol y no queda en HIGH por esta regla', (url) => {
      const result = decide(url)
      expect(result.activatedRules.some((hit) => hit.id === 'at-symbol')).toBe(false)
      expect(result.riskLevel).not.toBe('high')
    })
  })

  describe('at-symbol sigue detectando userinfo real (phishing con credenciales antes del dominio)', () => {
    it.each([
      'http://accounts.google.com@evil-login.top/',
      'http://usuario:password@evil-login.top/',
      'http://paypal.com@evil.example/',
    ])('%s SÍ activa at-symbol y sigue en HIGH vía el override', (url) => {
      const result = decide(url)
      expect(result.activatedRules.some((hit) => hit.id === 'at-symbol')).toBe(true)
      expect(result.riskLevel).toBe('high')
    })
  })

  describe('domain-impersonation (typosquatting/lookalike) — src/domainSimilarity/', () => {
    it('rnicrosoft.com activa la nueva regla domain-impersonation (antes no representaba ninguna señal, ver docs/domain-impersonation-detection.md)', () => {
      const result = decide('https://rnicrosoft.com/')
      expect(result.activatedRules.some((hit) => hit.id === 'domain-impersonation')).toBe(true)
    })

    it('microsoft.com (el dominio real) nunca activa domain-impersonation contra sí mismo', () => {
      const result = decide('https://www.microsoft.com/')
      expect(result.activatedRules.some((hit) => hit.id === 'domain-impersonation')).toBe(false)
    })

    it('un subdominio real de un dominio de referencia (accounts.google.com) tampoco activa la regla', () => {
      const result = decide('https://accounts.google.com/')
      expect(result.activatedRules.some((hit) => hit.id === 'domain-impersonation')).toBe(false)
    })

    it('domain-impersonation NO es una regla fuerte: activarla sola no garantiza HIGH (STRONG_RULE_IDS sin modificar)', () => {
      const result = decide('https://rnicrosoft.com/')
      expect(result.riskLevel).not.toBe('high')
    })

    it('youtube.com/@handle sigue sin activar at-symbol ni domain-impersonation (no rompe la corrección anterior)', () => {
      const result = decide('https://www.youtube.com/@GoogleDevelopers')
      expect(result.activatedRules.some((hit) => hit.id === 'at-symbol')).toBe(false)
      expect(result.activatedRules.some((hit) => hit.id === 'domain-impersonation')).toBe(false)
    })

    it.each([
      'https://microsfot.com/',
      'https://g00gle.com/',
      'https://paypa1.com/',
      'https://bancolornbia.com/',
    ])('%s activa domain-impersonation', (url) => {
      const result = decide(url)
      expect(result.activatedRules.some((hit) => hit.id === 'domain-impersonation')).toBe(true)
    })
  })

  describe('audit Seguridad-master — casos de prueba mínimos (Fase 9, docs/reference-audit-seguridad-master.md)', () => {
    it.each([
      'https://www.microsoft.com/',
      'https://www.google.com/',
      'https://www.youtube.com/',
      'https://www.bancolombia.com/',
      'https://github.com/',
      'https://www.wikipedia.org/',
      'https://www.unal.edu.co/', // Fase 11: regresión explícita pedida (universidad colombiana real)
    ])('legítima %s: riesgo bajo', (url) => {
      const result = decide(url)
      expect(result.riskLevel).toBe('low')
    })

    it.each([
      'http://accounts.google.com@evil-login.top/',
      'https://xn--pypal-4ve.com/account',
      'http://secure-login-verificar-cuenta-banco.top/',
    ])('phishing sintético %s: riesgo alto', (url) => {
      const result = decide(url)
      expect(result.riskLevel).toBe('high')
    })

    it('"secure-login-verificar-cuenta-banco.top" activa auth y banking en la misma URL (explicación categorizada, Fase 4/10)', () => {
      const result = decide('http://secure-login-verificar-cuenta-banco.top/')
      const hit = result.activatedRules.find((h) => h.id === 'sensitive-words')
      expect(hit?.explanation).toContain('autenticación')
      expect(hit?.explanation).toContain('servicios financieros')
    })
  })

  describe('tracking de campañas/ads en query params — Objetivo 1-3 (ver docs/tracking-parameter-analysis.md)', () => {
    // Ninguna de estas URLs tiene otra señal de phishing propia; si el
    // riskLevel subiera a "medium"/"high" acá, sería porque alguna regla
    // (o el vector de ML) empezó a leer los campos de tracking sin
    // respaldo empírico — exactamente lo que este bloque protege.
    it.each([
      'https://example.com/product?utm_source=google&utm_medium=cpc',
      'https://example.com/?gclid=abc123',
      'https://youtube.com/watch?v=test&utm_source=test',
    ])('%s: tracking no sube el riesgo por sí solo', (url) => {
      const result = decide(url)
      expect(result.riskLevel).toBe('low')
    })

    it('caso real: win.juga-bet.co (destino de redirección publicitaria desde jkanime.net) con 6 params de tracking no se clasifica como phishing solo por eso', () => {
      const url =
        'https://win.juga-bet.co/casino/jokers-jewels/?voluum_clickid=test&voluum_campaignid=test&voluum_offerid=test&utm_campaign=&utm_source=mrbooster&utm_medium=mrbooster'
      const result = decide(url)
      // No hay ninguna regla "tracking-heavy-url" activa (Objetivo 3: los
      // datos no la justificaron, ver docs/tracking-parameter-analysis.md)
      // así que el veredicto depende solo de las señales estructurales
      // reales de esta URL — no de la cantidad de parámetros de campaña.
      // `RuleId` (rules/weights.ts) ni siquiera incluye "tracking-heavy-url"
      // como valor posible — TypeScript ya lo garantiza en tiempo de
      // compilación; el `as string` es a propósito para dejar la intención
      // explícita en el test sin pelear con ese tipo cerrado.
      expect(result.activatedRules.some((hit) => (hit.id as string) === 'tracking-heavy-url')).toBe(
        false,
      )
      expect(result.riskLevel).not.toBe('high')
    })
  })
})
