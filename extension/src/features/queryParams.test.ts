import { describe, expect, it } from 'vitest'
import { analyzeQueryParams } from './queryParams'

describe('analyzeQueryParams', () => {
  it('una query vacía da todo en cero', () => {
    expect(analyzeQueryParams('')).toEqual({
      queryParamCount: 0,
      trackingParamCount: 0,
      hasClickTrackingId: false,
      trackingParamRatio: 0,
    })
  })

  it('cuenta params normales que no son tracking', () => {
    const result = analyzeQueryParams('q=hola&page=2')
    expect(result.queryParamCount).toBe(2)
    expect(result.trackingParamCount).toBe(0)
    expect(result.hasClickTrackingId).toBe(false)
    expect(result.trackingParamRatio).toBe(0)
  })

  it('detecta params UTM estándar (caso legítimo típico: campaña de Google Ads)', () => {
    const result = analyzeQueryParams('utm_source=google&utm_medium=cpc')
    expect(result.queryParamCount).toBe(2)
    expect(result.trackingParamCount).toBe(2)
    expect(result.trackingParamRatio).toBe(1)
    expect(result.hasClickTrackingId).toBe(false) // UTM es atribución de campaña, no un id de click específico
  })

  it('detecta gclid como click tracking id', () => {
    const result = analyzeQueryParams('gclid=abc123')
    expect(result.trackingParamCount).toBe(1)
    expect(result.hasClickTrackingId).toBe(true)
  })

  it('normaliza el nombre del parámetro a minúsculas antes de comparar', () => {
    const result = analyzeQueryParams('UTM_SOURCE=google&GCLID=abc123')
    expect(result.trackingParamCount).toBe(2)
    expect(result.hasClickTrackingId).toBe(true)
  })

  it('un param largo que NO está en la lista conocida no cuenta como tracking (nada de heurística por longitud)', () => {
    const result = analyzeQueryParams('some_very_long_parameter_name_here=value')
    expect(result.trackingParamCount).toBe(0)
    expect(result.hasClickTrackingId).toBe(false)
  })

  it('caso real: voluum + UTM mezclados (win.juga-bet.co) — detecta los 5 conocidos, ratio de 1', () => {
    const query =
      'voluum_clickid=test&voluum_campaignid=test&voluum_offerid=test&utm_campaign=&utm_source=mrbooster&utm_medium=mrbooster'
    const result = analyzeQueryParams(query)
    expect(result.queryParamCount).toBe(6)
    expect(result.trackingParamCount).toBe(6)
    expect(result.trackingParamRatio).toBe(1)
    expect(result.hasClickTrackingId).toBe(true) // voluum_clickid
  })

  it('mezcla de tracking y no-tracking calcula el ratio correctamente', () => {
    const result = analyzeQueryParams('id=42&utm_source=test')
    expect(result.queryParamCount).toBe(2)
    expect(result.trackingParamCount).toBe(1)
    expect(result.trackingParamRatio).toBe(0.5)
  })
})
