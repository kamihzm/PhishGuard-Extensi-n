import { describe, expect, it } from 'vitest'
import {
  CONTINUE_MESSAGE_TYPE,
  isContinueMessage,
  isTrustMessage,
  TRUST_MESSAGE_TYPE,
  type ContinueMessage,
  type TrustMessage,
} from './messages'

describe('isContinueMessage', () => {
  it('acepta un mensaje válido', () => {
    const message: ContinueMessage = { type: CONTINUE_MESSAGE_TYPE, url: 'https://example.com/' }
    expect(isContinueMessage(message)).toBe(true)
  })

  it('rechaza un mensaje de otro tipo', () => {
    expect(isContinueMessage({ type: 'phishguard:trust', url: 'https://example.com/' })).toBe(false)
  })

  it('rechaza sin url string', () => {
    expect(isContinueMessage({ type: CONTINUE_MESSAGE_TYPE })).toBe(false)
    expect(isContinueMessage({ type: CONTINUE_MESSAGE_TYPE, url: 123 })).toBe(false)
  })

  it('rechaza null/undefined/no-objeto', () => {
    expect(isContinueMessage(null)).toBe(false)
    expect(isContinueMessage(undefined)).toBe(false)
    expect(isContinueMessage('not an object')).toBe(false)
  })
})

describe('isTrustMessage', () => {
  it('acepta un mensaje válido', () => {
    const message: TrustMessage = { type: TRUST_MESSAGE_TYPE, url: 'https://example.com/' }
    expect(isTrustMessage(message)).toBe(true)
  })

  it('rechaza un mensaje de otro tipo', () => {
    expect(isTrustMessage({ type: 'phishguard:continue', url: 'https://example.com/' })).toBe(false)
  })

  it('rechaza sin url string', () => {
    expect(isTrustMessage({ type: TRUST_MESSAGE_TYPE })).toBe(false)
    expect(isTrustMessage({ type: TRUST_MESSAGE_TYPE, url: 123 })).toBe(false)
  })

  it('rechaza null/undefined/no-objeto', () => {
    expect(isTrustMessage(null)).toBe(false)
    expect(isTrustMessage(undefined)).toBe(false)
    expect(isTrustMessage('not an object')).toBe(false)
  })
})
