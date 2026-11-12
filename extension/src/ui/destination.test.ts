import { describe, expect, it } from 'vitest'
import type { Decision } from '../agent/types'
import { describeDestination, registrableDomain } from './destination'

function decision(url: string, activatedRules: Decision['activatedRules'] = []): Decision {
  return {
    url,
    ruleScore: 0,
    mlProbability: 0,
    finalScore: 0,
    riskLevel: 'low',
    activatedRules,
    explanation: '',
  }
}

describe('registrableDomain', () => {
  it.each([
    ['www.bancolombia.com.co', 'bancolombia.com.co'],
    ['paypal.com.login.example', 'login.example'],
    ['a.b.example.co.uk', 'example.co.uk'],
    ['localhost', 'localhost'],
    ['192.168.1.50', '192.168.1.50'],
    ['[::1]', '[::1]'],
  ])('%s → %s', (host, expected) => {
    expect(registrableDomain(host)).toBe(expected)
  })
})

describe('describeDestination', () => {
  it('sin reglas de disfraz no inventa un sitio aparente', () => {
    expect(describeDestination(decision('https://www.biblioteca.example/x'))).toEqual({
      realDomain: 'biblioteca.example',
      fullUrl: 'https://www.biblioteca.example/x',
      apparent: null,
    })
  })

  it('at-symbol: lo aparente es lo que va antes de la @', () => {
    const d = decision('https://www.bancolombia.com@login.example/', [
      { id: 'at-symbol', weight: 30, explanation: '' },
    ])
    expect(describeDestination(d)?.apparent).toBe('www.bancolombia.com')
    expect(describeDestination(d)?.realDomain).toBe('login.example')
  })

  it('una @ sin la regla activada no se presenta como disfraz', () => {
    expect(describeDestination(decision('https://user@login.example/'))?.apparent).toBeNull()
  })

  it('brand-in-subdomain: lo aparente es lo que va delante del dominio real', () => {
    const d = decision('https://www.paypal.com.login.example/', [
      { id: 'brand-in-subdomain', weight: 25, explanation: 'La marca "paypal" aparece…' },
    ])
    expect(describeDestination(d)?.apparent).toBe('paypal.com')
  })

  it('una dirección que no se puede leer no rompe la vista', () => {
    expect(describeDestination(decision('no es una url'))).toBeNull()
  })
})
