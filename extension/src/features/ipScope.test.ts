import { describe, expect, it } from 'vitest'
import { isPublicIpAddress } from './ipScope'

describe('isPublicIpAddress', () => {
  it.each(['45.33.32.156', '8.8.8.8', '1.1.1.1', '[2606:4700:4700::1111]'])(
    '%s es pública',
    (ip) => {
      expect(isPublicIpAddress(ip)).toBe(true)
    },
  )

  it.each([
    '10.0.0.1',
    '10.64.0.10',
    '172.16.5.4',
    '172.31.255.255',
    '192.168.1.50',
    '127.0.0.1',
    '169.254.1.1',
    '100.64.0.1',
    '0.0.0.0',
    '192.0.2.10',
    '198.51.100.7',
    '203.0.113.9',
    '224.0.0.1',
    '255.255.255.255',
    '[::1]',
    '[fd00::1]',
    '[fe80::1]',
    '[::ffff:10.0.0.1]',
    '[::ffff:a00:1]',
  ])('%s NO es pública', (ip) => {
    expect(isPublicIpAddress(ip)).toBe(false)
  })

  it('172.32.x (fuera de 172.16/12) sí es pública', () => {
    expect(isPublicIpAddress('172.32.0.1')).toBe(true)
  })

  it('un nombre de dominio no es una IP', () => {
    expect(isPublicIpAddress('example.com')).toBe(false)
  })

  it('formas hex/octal normalizadas por new URL()', () => {
    expect(isPublicIpAddress(new URL('http://0x7f.1/').hostname)).toBe(false)
    expect(isPublicIpAddress(new URL('http://0x2d.33.32.156/').hostname)).toBe(true)
  })
})
