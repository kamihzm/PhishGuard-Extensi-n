import { describe, expect, it } from 'vitest'
import {
  acceptIntentRecord,
  INTENT_RECORD_PREFIX,
  intentRecordKey,
  isExpiredRecord,
  isIntentSessionQuery,
  parseIntentRecord,
  parseIntentSession,
  recordFromIntent,
  stripUrl,
  type IntentRecord,
} from './intentRecord'
import type { UserIntent } from './types'

const NOW = 1_000_000
const click = (over: Partial<UserIntent> = {}): UserIntent => ({
  kind: 'click',
  at: NOW,
  newTab: false,
  expectedUrl: 'https://legit.test/article?utm=1#top',
  form: false,
  ...over,
})
const record = (over: Partial<IntentRecord> = {}): IntentRecord => ({
  v: 1,
  token: 'tok-7',
  at: NOW,
  kind: 'click',
  form: false,
  expectedUrl: 'https://legit.test/article',
  documentUrl: 'https://publisher.test/',
  ...over,
})

describe('intentRecord: minimización de datos', () => {
  it('stripUrl conserva solo origen y ruta (sin consulta ni fragmento) y solo http(s)', () => {
    expect(stripUrl('https://a.test/p/q?token=secret#frag')).toBe('https://a.test/p/q')
    expect(stripUrl('http://a.test:8080/')).toBe('http://a.test:8080/')
    expect(stripUrl('javascript:alert(1)')).toBeNull()
    expect(stripUrl('chrome://settings')).toBeNull()
    expect(stripUrl('not a url')).toBeNull()
    expect(stripUrl(`https://a.test/${'x'.repeat(3000)}`)).toBeNull()
  })

  it('solo se registran las intenciones que pueden legitimar una navegación de ESTA pestaña', () => {
    const doc = 'https://publisher.test/page?session=abc'
    expect(recordFromIntent(click(), doc, 'tok')).toEqual({
      v: 1,
      token: 'tok',
      at: NOW,
      kind: 'click',
      form: false,
      expectedUrl: 'https://legit.test/article',
      documentUrl: 'https://publisher.test/page',
    })
    // Formulario sin destino explícito: cuenta por `form`.
    expect(recordFromIntent(click({ kind: 'submit', form: true, expectedUrl: null }), doc, 't'))
      .not.toBeNull()
    // Clic sin destino (no es enlace): no aporta al clasificador.
    expect(recordFromIntent(click({ expectedUrl: null }), doc, 't')).toBeNull()
    // Pestaña nueva (Ctrl+clic, _blank): no es una navegación de esta pestaña.
    expect(recordFromIntent(click({ newTab: true }), doc, 't')).toBeNull()
    // Documento no http(s): nada que correlacionar.
    expect(recordFromIntent(click(), 'about:blank', 't')).toBeNull()
  })
})

describe('intentRecord: validación', () => {
  it('parseIntentRecord acepta solo la forma exacta', () => {
    expect(parseIntentRecord(record())).toEqual(record())
    expect(parseIntentRecord(null)).toBeNull()
    expect(parseIntentRecord({ ...record(), v: 2 })).toBeNull()
    expect(parseIntentRecord({ ...record(), extra: 1 })).toBeNull()
    expect(parseIntentRecord({ ...record(), token: '' })).toBeNull()
    expect(parseIntentRecord({ ...record(), kind: 'hover' })).toBeNull()
    expect(parseIntentRecord({ ...record(), at: Number.NaN })).toBeNull()
    expect(parseIntentRecord({ ...record(), documentUrl: 'https://p.test/?q=1' })).toBeNull()
    expect(parseIntentRecord({ ...record(), expectedUrl: 'javascript:x' })).toBeNull()
  })

  it('la clave es por pestaña y con prefijo de Web Protection', () => {
    expect(intentRecordKey(7)).toBe(`${INTENT_RECORD_PREFIX}7`)
    expect(INTENT_RECORD_PREFIX.startsWith('phishguard:wp:')).toBe(true)
  })

  it('protocolo de sesión: consulta y respuesta exactas', () => {
    expect(isIntentSessionQuery({ type: 'phishguard:wp:intent-session', v: 1 })).toBe(true)
    expect(isIntentSessionQuery({ type: 'phishguard:wp:intent-session', v: 1, x: 1 })).toBe(false)
    expect(parseIntentSession({ v: 1, tabId: 3, token: 'abc' })).toEqual({ tabId: 3, token: 'abc' })
    expect(parseIntentSession({ v: 1, tabId: -1, token: 'abc' })).toBeNull()
    expect(parseIntentSession({ v: 1, tabId: 3, token: '' })).toBeNull()
  })
})

describe('intentRecord: correlación con una navegación', () => {
  const ctx = { token: 'tok-7', navigationStartedAt: NOW + 20 }

  it('acepta el registro de la misma pestaña, dentro de la ventana', () => {
    expect(acceptIntentRecord(record(), ctx)).toEqual({
      documentUrl: 'https://publisher.test/',
      intent: {
        kind: 'click',
        at: NOW,
        newTab: false,
        expectedUrl: 'https://legit.test/article',
        form: false,
      },
    })
  })

  it('token distinto (otra pestaña o registro falsificado): se rechaza', () => {
    expect(acceptIntentRecord(record({ token: 'tok-8' }), ctx)).toBeNull()
    expect(acceptIntentRecord(record(), { ...ctx, token: null })).toBeNull()
  })

  it('fuera de la ventana temporal (viejo o posterior a la navegación): se rechaza', () => {
    expect(acceptIntentRecord(record({ at: NOW - 6000 }), ctx)).toBeNull()
    expect(acceptIntentRecord(record({ at: NOW + 200 }), ctx)).toBeNull()
  })

  it('isExpiredRecord: vencido según la caducidad', () => {
    expect(isExpiredRecord(record(), NOW + 1000)).toBe(false)
    expect(isExpiredRecord(record(), NOW + 60_000)).toBe(true)
  })
})
