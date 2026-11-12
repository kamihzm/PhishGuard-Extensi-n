import { beforeEach, describe, expect, it } from 'vitest'
import { createHider, HIDDEN_ATTRIBUTE, safeCosmeticSelectors, STYLE_ELEMENT_ID } from './hider'

describe('hider: ocultación reversible', () => {
  beforeEach(() => {
    document.head.innerHTML = ''
    document.body.innerHTML = '<div id="a">A</div><div id="b">B</div><main id="m"></main>'
  })

  it('marca el elemento, crea UNA hoja y restoreAll deja el DOM como estaba', () => {
    const before = document.documentElement.outerHTML
    const hider = createHider(document)
    expect(hider.hide(document.getElementById('a')!, 'x')).toBe(true)
    expect(hider.hide(document.getElementById('b')!, 'x')).toBe(true)
    expect(document.querySelectorAll(`#${STYLE_ELEMENT_ID}`)).toHaveLength(1)
    expect(document.getElementById('a')!.getAttribute(HIDDEN_ATTRIBUTE)).toBe('x')
    hider.restoreAll()
    expect(document.documentElement.outerHTML).toBe(before)
  })

  it('es idempotente: ocultar dos veces el mismo elemento no duplica nada', () => {
    const hider = createHider(document)
    const a = document.getElementById('a')!
    expect(hider.hide(a, 'x')).toBe(true)
    expect(hider.hide(a, 'x')).toBe(false)
    expect(hider.hiddenCount()).toBe(1)
  })

  it('nunca oculta html, head, body ni main', () => {
    const hider = createHider(document)
    for (const el of [
      document.documentElement,
      document.head,
      document.body,
      document.getElementById('m')!,
    ]) {
      expect(hider.hide(el, 'x')).toBe(false)
    }
    expect(document.getElementById(STYLE_ELEMENT_ID)).toBeNull()
  })

  it('restoreOwner deshace solo lo de ese adaptador (aislamiento entre adaptadores)', () => {
    const hider = createHider(document)
    hider.hide(document.getElementById('a')!, 'uno')
    hider.hide(document.getElementById('b')!, 'dos')
    hider.restoreOwner('uno')
    expect(document.getElementById('a')!.hasAttribute(HIDDEN_ATTRIBUTE)).toBe(false)
    expect(document.getElementById('b')!.getAttribute(HIDDEN_ATTRIBUTE)).toBe('dos')
    expect(hider.hiddenCount('dos')).toBe(1)
  })

  it('la hoja cosmética se reemplaza y se elimina al restaurar', () => {
    const hider = createHider(document)
    hider.setCosmeticSelectors(['.ad-1', '#ad-2'])
    const css = document.getElementById(STYLE_ELEMENT_ID)!.textContent!
    expect(css).toContain('.ad-1{display:none!important}')
    hider.setCosmeticSelectors(['.ad-3'])
    expect(document.getElementById(STYLE_ELEMENT_ID)!.textContent).not.toContain('.ad-1')
    hider.restoreAll()
    expect(document.getElementById(STYLE_ELEMENT_ID)).toBeNull()
  })
})

describe('safeCosmeticSelectors', () => {
  beforeEach(() => {
    document.body.innerHTML = '<main class="content"></main><div class="ad"></div>'
  })

  it('descarta CSS inválido y selectores que alcanzan la estructura raíz', () => {
    const out = safeCosmeticSelectors(document, [
      '.ad',
      'div[',
      'body',
      'html > body',
      'main.content',
      '.x{}',
      'div:-abp-has(.y)',
    ])
    expect(out).toEqual(['.ad'])
  })
})
