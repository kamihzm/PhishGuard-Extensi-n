import { describe, expect, it, vi } from 'vitest'
import { decide } from './orchestrator'

/**
 * Los valores de abajo se REGENERARON el 2026-10-01 al adoptar el Random
 * Forest v4-propio calibrado como componente ML de `decide()` (ver
 * `docs/rf-adoption.md`). Antes se capturaron con la regresión logística v1
 * (fixture `modelV1-2026-08-28.json`), que `decide()` ya no usa. Este
 * archivo fija el artefacto RF de ese día como fixture, así la prueba sigue
 * verificando lo que le corresponde (que `features/`, `rules/`, la
 * inferencia de `ml/` y `agent/combine.ts` no cambian por tocar Protección
 * web) sin quedar atada al `forestModel.json` vigente.
 */
vi.mock('../ml/forestModel.json', async () => ({
  default: (await import('../test/fixtures/forestV4own-calibrated-2026-10-01.json')).default,
}))

/**
 * Regresión pedida explícitamente al retirar "Protección web" (bloqueo de
 * ads/trackers/popups/redirecciones): `decide()` (el motor de phishing —
 * `features/` + `rules/` + `ml/` + `agent/combine.ts`) NO se tocó en ese
 * cambio, así que debe seguir devolviendo EXACTAMENTE el mismo
 * `ruleScore`/`mlProbability`/`finalScore`/`riskLevel`/reglas activadas
 * para cada URL de esta lista que devolvía antes del retiro.
 *
 * Los valores esperados se capturaron ejecutando `decide()` sobre el
 * motor sin modificar, ANTES de borrar `webProtection/` y sus puntos de
 * integración (`background/index.ts`, `settings/`, `shared/messages.ts`,
 * `ui/popup`, `manifest.config.ts`) — ver el reporte final de la tarea. Si
 * algún valor de acá cambia en el futuro, es una señal real de que algo en
 * `features/`, `rules/`, `ml/` o `agent/combine.ts` cambió — nunca algo
 * esperable de tocar solo Protección web.
 */
const BASELINE = [
  {
    url: 'https://www.google.com/search?q=hola',
    ruleScore: 0,
    mlProbability: 0.044713,
    finalScore: 3,
    riskLevel: 'low',
    activatedRuleIds: [],
  },
  {
    url: 'https://www.microsoft.com/',
    ruleScore: 0,
    mlProbability: 0.057178,
    finalScore: 4,
    riskLevel: 'low',
    activatedRuleIds: [],
  },
  {
    url: 'https://www.youtube.com/',
    ruleScore: 0,
    mlProbability: 0.045489,
    finalScore: 3,
    riskLevel: 'low',
    activatedRuleIds: [],
  },
  {
    url: 'https://www.bancolombia.com/',
    ruleScore: 10,
    mlProbability: 0.055985,
    finalScore: 7,
    riskLevel: 'low',
    activatedRuleIds: ['sensitive-words'],
  },
  {
    url: 'https://github.com/',
    ruleScore: 0,
    mlProbability: 0.066057,
    finalScore: 5,
    riskLevel: 'low',
    activatedRuleIds: [],
  },
  {
    url: 'https://www.wikipedia.org/',
    ruleScore: 0,
    mlProbability: 0.057178,
    finalScore: 4,
    riskLevel: 'low',
    activatedRuleIds: [],
  },
  {
    url: 'https://www.unal.edu.co/',
    ruleScore: 0,
    mlProbability: 0.040598,
    finalScore: 3,
    riskLevel: 'low',
    activatedRuleIds: [],
  },
  {
    url: 'https://ejemplo.com.co/',
    ruleScore: 0,
    mlProbability: 0.080733,
    finalScore: 6,
    riskLevel: 'low',
    activatedRuleIds: [],
  },
  {
    url: 'https://banco.com.co/login',
    ruleScore: 10,
    mlProbability: 0.12176,
    finalScore: 12,
    riskLevel: 'low',
    activatedRuleIds: ['sensitive-words'],
  },
  {
    url: 'https://entidad.gov.co/tramites',
    ruleScore: 0,
    mlProbability: 0.132436,
    finalScore: 9,
    riskLevel: 'low',
    activatedRuleIds: [],
  },
  {
    url: 'http://accounts.google.com@evil-login.top/',
    ruleScore: 75,
    mlProbability: 0.622265,
    finalScore: 66,
    riskLevel: 'high',
    activatedRuleIds: ['at-symbol', 'suspicious-tld', 'sensitive-words', 'no-https'],
  },
  {
    url: 'https://xn--pypal-4ve.com/account',
    ruleScore: 75,
    mlProbability: 0,
    finalScore: 65,
    riskLevel: 'high',
    activatedRuleIds: [
      'punycode',
      'punycode-deceptive',
      'sensitive-words',
      'high-entropy-domain',
      'domain-impersonation',
    ],
  },
  {
    url: 'http://secure-login-verificar-cuenta-banco.top/',
    ruleScore: 70,
    mlProbability: 0.937521,
    finalScore: 87,
    riskLevel: 'high',
    activatedRuleIds: [
      'suspicious-tld',
      'many-hyphens',
      'sensitive-words',
      'no-https',
      'high-entropy-domain',
    ],
  },
  {
    url: 'http://banco-colombia-verificar-cuenta.top/login',
    ruleScore: 70,
    mlProbability: 0.951502,
    finalScore: 88,
    riskLevel: 'high',
    activatedRuleIds: [
      'suspicious-tld',
      'many-hyphens',
      'sensitive-words',
      'no-https',
      'high-entropy-domain',
    ],
  },
  {
    url: 'http://192.168.1.50/login?verificar=1',
    ruleScore: 55,
    mlProbability: 0.431218,
    finalScore: 47,
    riskLevel: 'medium',
    activatedRuleIds: ['ip-as-host', 'sensitive-words', 'no-https'],
  },
  {
    url: 'https://rnicrosoft.com/',
    ruleScore: 20,
    mlProbability: 0.20815,
    finalScore: 21,
    riskLevel: 'low',
    activatedRuleIds: ['domain-impersonation'],
  },
  {
    url: 'https://g00gle.com/',
    ruleScore: 20,
    mlProbability: 0.167694,
    finalScore: 18,
    riskLevel: 'low',
    activatedRuleIds: ['domain-impersonation'],
  },
  {
    url: 'https://paypa1.com/',
    ruleScore: 20,
    mlProbability: 0.11881,
    finalScore: 14,
    riskLevel: 'low',
    activatedRuleIds: ['domain-impersonation'],
  },
  {
    url: 'https://bancolornbia.com/',
    ruleScore: 30,
    mlProbability: 0.219072,
    finalScore: 24,
    riskLevel: 'low',
    activatedRuleIds: ['sensitive-words', 'domain-impersonation'],
  },
  {
    url: 'https://example.com/product?utm_source=google&utm_medium=cpc',
    ruleScore: 0,
    mlProbability: 0.154813,
    finalScore: 11,
    riskLevel: 'low',
    activatedRuleIds: [],
  },
  {
    url: 'https://www.youtube.com/@MegaSawaya',
    ruleScore: 0,
    mlProbability: 0.046191,
    finalScore: 3,
    riskLevel: 'low',
    activatedRuleIds: [],
  },
  {
    url: 'http://bancolombia.com.co.evil-site.top/login',
    ruleScore: 95,
    mlProbability: 0.755955,
    finalScore: 81,
    riskLevel: 'high',
    activatedRuleIds: [
      'suspicious-tld',
      'many-subdomains',
      'brand-in-subdomain',
      'sensitive-words',
      'no-https',
      'high-entropy-domain',
    ],
  },
] as const

describe('regresión: retirar Protección web no cambia ni un solo veredicto del motor de phishing', () => {
  it.each(BASELINE)(
    '$url → mismo ruleScore/mlProbability/finalScore/riskLevel/reglas que antes del retiro',
    (expected) => {
      const result = decide(expected.url)

      expect(result.ruleScore).toBe(expected.ruleScore)
      expect(Number(result.mlProbability.toFixed(6))).toBe(expected.mlProbability)
      expect(result.finalScore).toBe(expected.finalScore)
      expect(result.riskLevel).toBe(expected.riskLevel)
      expect(result.activatedRules.map((hit) => hit.id)).toEqual([...expected.activatedRuleIds])
    },
  )

  it('es determinista entre corridas (mismo Decision para la misma URL, sin depender de estado de Protección web)', () => {
    for (const { url } of BASELINE) {
      expect(decide(url)).toEqual(decide(url))
    }
  })
})
