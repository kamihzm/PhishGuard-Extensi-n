import { describe, expect, it } from 'vitest'
import {
  COSMETIC_REQUEST_TYPE,
  isCosmeticRequest,
  MAX_RESPONSE_SELECTORS,
  parseCosmeticResponse,
  trustedSenderHostname,
} from './protocol'

describe('protocolo content script → background', () => {
  it('acepta solo la forma exacta de la petición cosmética', () => {
    expect(isCosmeticRequest({ type: COSMETIC_REQUEST_TYPE, v: 1 })).toBe(true)
    expect(isCosmeticRequest({ type: COSMETIC_REQUEST_TYPE, v: 2 })).toBe(false)
    expect(isCosmeticRequest({ type: 'otro', v: 1 })).toBe(false)
    // Campo extra: p. ej. un hostname inyectado para pedir selectores de otro sitio.
    expect(isCosmeticRequest({ type: COSMETIC_REQUEST_TYPE, v: 1, hostname: 'x.com' })).toBe(false)
    expect(isCosmeticRequest(null)).toBe(false)
    expect(isCosmeticRequest('phishguard:wp:cosmetic-request')).toBe(false)
  })

  it('valida la respuesta del background antes de usarla', () => {
    expect(parseCosmeticResponse({ ok: true, selectors: ['.a', '#b'] })).toEqual(['.a', '#b'])
    expect(parseCosmeticResponse({ ok: false, selectors: ['.a'] })).toBeNull()
    expect(parseCosmeticResponse({ ok: true, selectors: ['.a', 3] })).toBeNull()
    expect(parseCosmeticResponse({ ok: true, selectors: [''] })).toBeNull()
    expect(parseCosmeticResponse({ ok: true, selectors: ['x'.repeat(501)] })).toBeNull()
    expect(
      parseCosmeticResponse({ ok: true, selectors: Array(MAX_RESPONSE_SELECTORS + 1).fill('.a') }),
    ).toBeNull()
    expect(parseCosmeticResponse(undefined)).toBeNull()
  })

  it('el hostname sale de sender.url y exige: esta extensión, marco principal, pestaña, http(s)', () => {
    const ok = { id: 'ext', frameId: 0, tab: { id: 3 }, url: 'https://www.youtube.com/watch?v=x' }
    expect(trustedSenderHostname(ok, 'ext')).toBe('www.youtube.com')
    expect(trustedSenderHostname({ ...ok, id: 'otra' }, 'ext')).toBeNull()
    expect(trustedSenderHostname({ ...ok, frameId: 2 }, 'ext')).toBeNull()
    expect(trustedSenderHostname({ ...ok, tab: undefined }, 'ext')).toBeNull()
    expect(
      trustedSenderHostname({ ...ok, url: 'chrome-extension://ext/popup.html' }, 'ext'),
    ).toBeNull()
    expect(trustedSenderHostname({ ...ok, url: 'file:///C:/a.html' }, 'ext')).toBeNull()
    expect(trustedSenderHostname({ ...ok, url: 'no es url' }, 'ext')).toBeNull()
  })
})
