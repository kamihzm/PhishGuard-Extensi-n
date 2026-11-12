import { describe, expect, it } from 'vitest'
import { extractFeatures } from '../features/extractFeatures'
import { runRules } from '../rules/engine'
import { decide } from './orchestrator'

/**
 * Regresión del falso positivo de forma "www + nombre de marca largo +
 * ruta raíz/localizada" (diagnóstico en `docs/legitimate-url-ml-calibration.md`).
 *
 * El modelo v1 daba ~0.44 a `https://www.leagueoflegends.com/es-es/` y
 * subía a riesgo MEDIO la misma forma en la raíz (`www.leagueoflegends.com/`,
 * `www.harley-davidson.com/`, `www.nationalgeographic.com/`) porque el lado
 * legítimo del dataset casi no tenía hostnames largos con `www.`.
 *
 * NO es una excepción por dominio: ningún código de producción conoce estos
 * dominios. Se verifica el COMPORTAMIENTO del modelo empaquetado sobre una
 * familia de URLs legítimas con esa estructura (ninguno de estos dominios
 * está en el dataset de entrenamiento — ver `training/data/holdout/`), sin
 * exigir una puntuación exacta: ninguna debe superar el umbral de riesgo
 * bajo ni ser considerada por el ML como más probable phishing que legítima.
 */
const LEGITIMATE_SAME_SHAPE = [
  'https://www.leagueoflegends.com/es-es/',
  'https://www.leagueoflegends.com/',
  'https://www.argentina.gob.ar/',
  'https://www.playstation.com/es-es/',
]

/**
 * Limitación conocida del modelo v2 (documentada, no escondida): hostnames
 * largos CON guion o de muy alta entropía siguen en riesgo MEDIO porque el
 * ML, con 16 features léxicas, no los distingue de dominios de phishing con
 * esa forma; el ML por sí solo ya los ubica en medio. En harley-davidson y
 * nationalgeographic se suma además la regla `high-entropy-domain` (+15),
 * y en mercedes-benz no se activa ninguna. `it.fails` hace que la suite
 * avise (fallando) el día que alguna quede en bajo, para actualizar esta lista.
 */
const KNOWN_LIMITATION_SAME_SHAPE = [
  'https://www.harley-davidson.com/',
  'https://www.nationalgeographic.com/',
]

/**
 * 2026-10-01: con el Random Forest v4-propio calibrado como componente ML,
 * mercedes-benz ya queda en riesgo bajo (sin reglas y con p < 0,5), así que
 * sale de la lista de limitaciones conocidas.
 */
const RESOLVED_BY_RF = ['https://www.mercedes-benz.com/']

function expectLowWithoutRules(url: string): void {
  const decision = decide(url)
  expect(decision.activatedRules).toEqual([])
  expect(decision.riskLevel).toBe('low')
  expect(decision.mlProbability).toBeLessThan(0.5)
}

describe('regresión: URLs legítimas con www + dominio largo + ruta localizada', () => {
  it.each(LEGITIMATE_SAME_SHAPE)(
    '%s queda en riesgo bajo sin reglas activadas',
    expectLowWithoutRules,
  )

  it.each(RESOLVED_BY_RF)(
    '%s queda en riesgo bajo con el Random Forest calibrado',
    expectLowWithoutRules,
  )

  it.fails.each(KNOWN_LIMITATION_SAME_SHAPE)(
    'limitación conocida: %s todavía no queda en riesgo bajo',
    expectLowWithoutRules,
  )
})

describe('regresión: casos de @ que deben mantenerse', () => {
  it('un @ en el pathname (handle de YouTube) no activa at-symbol', () => {
    const url = 'https://www.youtube.com/@nombrecanal'
    expect(extractFeatures(url).hasAtSymbol).toBe(false)
    expect(runRules(extractFeatures(url)).hits.map((h) => h.id)).not.toContain('at-symbol')
    expect(decide(url).riskLevel).toBe('low')
  })

  it('userinfo imitando a Google sigue siendo riesgo alto', () => {
    const decision = decide('http://accounts.google.com@evil-login.top/')
    expect(decision.activatedRules.map((h) => h.id)).toContain('at-symbol')
    expect(decision.riskLevel).toBe('high')
  })
})
