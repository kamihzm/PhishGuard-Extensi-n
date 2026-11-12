import { beforeEach, describe, expect, it } from 'vitest'
import {
  INTENT_QUERY_TYPE,
  INTENT_TTL_MS,
  intentFromEvent,
  isIntentQuery,
  MAX_INTENTS,
  parseIntentResponse,
  sameDestination,
  siteOf,
  startIntentRecorder,
} from './navigationIntent'

const BASE = 'https://jkanime.test/serie/'
const click = (el: Element, init: MouseEventInit = {}) => {
  const e = new MouseEvent('click', { bubbles: true, cancelable: true, ...init })
  Object.defineProperty(e, 'target', { value: el })
  return e
}

describe('intentFromEvent: distingue navegación en la misma pestaña y pestaña nueva pedida', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <a id="plain" href="/serie/2/"><span id="inner">ep 2</span></a>
      <a id="blank" href="https://externo.test/x" target="_blank">ext</a>
      <a id="self" href="/a" target="_self">self</a>
      <a id="js" href="javascript:void(0)">js</a>
      <button id="btn">play</button>
      <a id="hash" href="#">chat</a>
      <span id="role" role="button"><i id="role-icon">chat</i></span>
      <input id="submit-input" type="submit" value="go">
      <div id="player">player</div>
      <form id="f" action="/buscar" target="_blank"><input name="q"></form>`
  })

  it('clic normal en un enlace: misma pestaña, destino esperado', () => {
    expect(intentFromEvent(click(document.getElementById('inner')!), BASE, 1)).toEqual({
      kind: 'click',
      at: 1,
      newTab: false,
      expectedUrl: 'https://jkanime.test/serie/2/',
      form: false,
    })
  })

  it.each([
    ['Ctrl+clic', { ctrlKey: true }],
    ['Cmd+clic', { metaKey: true }],
    ['Shift+clic (ventana nueva)', { shiftKey: true }],
  ])('%s: pestaña nueva pedida', (_n, init) => {
    expect(intentFromEvent(click(document.getElementById('plain')!, init), BASE, 1)?.newTab).toBe(
      true,
    )
  })

  it('clic central (auxclick botón 1): pestaña nueva pedida; otros botones se ignoran', () => {
    const middle = new MouseEvent('auxclick', { button: 1 })
    Object.defineProperty(middle, 'target', { value: document.getElementById('plain') })
    expect(intentFromEvent(middle, BASE, 1)?.newTab).toBe(true)
    const right = new MouseEvent('auxclick', { button: 2 })
    Object.defineProperty(right, 'target', { value: document.getElementById('plain') })
    expect(intentFromEvent(right, BASE, 1)).toBeNull()
  })

  it('target=_blank: pestaña nueva pedida; target=_self no', () => {
    expect(intentFromEvent(click(document.getElementById('blank')!), BASE, 1)?.newTab).toBe(true)
    expect(intentFromEvent(click(document.getElementById('self')!), BASE, 1)?.newTab).toBe(false)
  })

  it('javascript: y clics fuera de enlaces no tienen destino esperado', () => {
    expect(intentFromEvent(click(document.getElementById('js')!), BASE, 1)?.expectedUrl).toBeNull()
    expect(intentFromEvent(click(document.getElementById('btn')!), BASE, 1)).toMatchObject({
      expectedUrl: null,
      newTab: false,
    })
  })

  it('T6: clic en un control que puede abrir una ventana (botón, role=button, enlace que no navega): control', () => {
    for (const id of ['btn', 'role-icon', 'submit-input', 'hash', 'js']) {
      expect(intentFromEvent(click(document.getElementById(id)!), BASE, 1)?.control, id).toBe(true)
    }
  })

  it('T6: clic en un enlace que navega o fuera de controles: sin marca de control', () => {
    for (const id of ['inner', 'blank', 'player']) {
      expect(intentFromEvent(click(document.getElementById(id)!), BASE, 1), id).not.toHaveProperty(
        'control',
      )
    }
  })

  it('Enter sobre un enlace y envío de formulario', () => {
    const key = new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true })
    Object.defineProperty(key, 'target', { value: document.getElementById('plain') })
    expect(intentFromEvent(key, BASE, 1)).toMatchObject({ kind: 'key', newTab: true })
    const submit = new Event('submit')
    Object.defineProperty(submit, 'target', { value: document.getElementById('f') })
    expect(intentFromEvent(submit, BASE, 1)).toMatchObject({
      kind: 'submit',
      form: true,
      newTab: true,
      expectedUrl: 'https://jkanime.test/buscar',
    })
  })
})

describe('startIntentRecorder', () => {
  beforeEach(() => {
    document.body.innerHTML = '<a id="a" href="/x/">x</a>'
  })

  it('ignora eventos sintéticos de la página (no confiables)', () => {
    const rec = startIntentRecorder(window, document, () => 1000)
    document.getElementById('a')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(rec.recent(1000)).toEqual([])
    rec.stop()
  })

  it('registra interacciones reales, con caducidad y límite de memoria', () => {
    let now = 1000
    const rec = startIntentRecorder(
      window,
      document,
      () => now,
      () => true,
    )
    for (let i = 0; i < MAX_INTENTS + 3; i++) {
      now += 10
      document
        .getElementById('a')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    }
    expect(rec.recent(now)).toHaveLength(MAX_INTENTS)
    expect(rec.recent(now + INTENT_TTL_MS + 1)).toEqual([])
    rec.stop()
    document.getElementById('a')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(rec.recent(now)).toEqual([])
  })

  it('no altera el evento (no cancela ni detiene la propagación)', () => {
    const rec = startIntentRecorder(
      window,
      document,
      () => 1,
      () => true,
    )
    const e = new MouseEvent('click', { bubbles: true, cancelable: true })
    let reached = false
    document.getElementById('a')!.addEventListener('click', (ev) => {
      reached = true
      ev.preventDefault()
    })
    document.getElementById('a')!.dispatchEvent(e)
    expect(reached).toBe(true)
    rec.stop()
  })

  it('onIntent recibe cada intención real; si lanza, la interacción sigue intacta', () => {
    const seen: string[] = []
    const rec = startIntentRecorder(
      window,
      document,
      () => 5,
      (event) => event.type !== 'auxclick',
      (intent) => {
        seen.push(`${intent.kind}:${intent.expectedUrl}`)
        throw new Error('storage unavailable')
      },
    )
    let reached = false
    document.getElementById('a')!.addEventListener('click', () => (reached = true))
    document.getElementById('a')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(seen).toEqual([`click:${new URL('/x/', document.baseURI).href}`])
    expect(reached).toBe(true)
    expect(rec.recent(5)).toHaveLength(1)
    rec.stop()
  })
})

describe('protocolo de consulta de intención', () => {
  it('la consulta tiene forma exacta', () => {
    expect(isIntentQuery({ type: INTENT_QUERY_TYPE, v: 1 })).toBe(true)
    expect(isIntentQuery({ type: INTENT_QUERY_TYPE, v: 1, tabId: 3 })).toBe(false)
    expect(isIntentQuery({ type: 'otro', v: 1 })).toBe(false)
  })

  it('la respuesta se valida campo por campo', () => {
    const ok = { kind: 'click', at: 5, newTab: false, expectedUrl: 'https://a.test/x', form: false }
    expect(parseIntentResponse({ v: 1, intents: [ok] })).toEqual([ok])
    expect(parseIntentResponse({ v: 1, intents: [{ ...ok, control: true }] })).toEqual([
      { ...ok, control: true },
    ])
    for (const bad of [
      { ...ok, control: 'si' },
      { ...ok, kind: 'scroll' },
      { ...ok, at: 'ayer' },
      { ...ok, newTab: 'si' },
      { ...ok, expectedUrl: 'javascript:alert(1)' },
      { ...ok, expectedUrl: 5 },
    ]) {
      expect(parseIntentResponse({ v: 1, intents: [bad] })).toBeNull()
    }
    expect(parseIntentResponse({ v: 1, intents: Array(MAX_INTENTS + 1).fill(ok) })).toBeNull()
    expect(parseIntentResponse({ v: 2, intents: [] })).toBeNull()
    expect(parseIntentResponse(undefined)).toBeNull()
  })
})

describe('siteOf / sameDestination', () => {
  it('dominio registrable aproximado', () => {
    expect(siteOf('https://www.jkanime.net/a')).toBe('jkanime.net')
    expect(siteOf('https://cdn.x.example.com.co/')).toBe('example.com.co')
    expect(siteOf('https://a.b.co.uk/')).toBe('b.co.uk')
    expect(siteOf('chrome-extension://x/')).toBeNull()
  })

  it('mismo destino ignora consulta y fragmento', () => {
    expect(sameDestination('https://a.test/x/?q=1#h', 'https://a.test/x')).toBe(true)
    expect(sameDestination('https://a.test/x', 'https://a.test/y')).toBe(false)
    expect(sameDestination('https://a.test/x', 'http://a.test/x')).toBe(false)
  })
})
