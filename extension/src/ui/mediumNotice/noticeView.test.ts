import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MediumNoticeContent } from '../../shared/messages'
import { mountMediumNotice, NOTICE_TAG } from './noticeView'

const CONTENT: MediumNoticeContent = {
  verdict: 'Ten cuidado con este sitio',
  headline: 'Encontramos 2 señales que suelen aparecer en sitios falsos.',
  signalsHeading: 'Por qué te avisamos',
  signals: [
    'Usa el nombre paypal delante de un dominio que no es de esa marca.',
    'La dirección incluye palabras relacionadas con el acceso a cuentas o con bancos.',
  ],
  noSignalsText: '',
  tip: 'Si vas a iniciar sesión o pagar, escribe tú mismo la dirección oficial.',
  realDomain: 'login.example',
  apparent: 'paypal.com',
  trustHostname: 'paypal.com.login.example',
}

function mount(options = { requireTrustedEvents: false, announceDelayMs: 0 }) {
  const actions = { onDismiss: vi.fn(), onTrust: vi.fn() }
  const mounted = mountMediumNotice(document, CONTENT, actions, options)
  const $ = <T extends Element = HTMLElement>(selector: string) =>
    mounted.root.querySelector<T & Element>(selector)!
  return { ...mounted, actions, $ }
}

function press(target: Element, key: string) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, composed: true }))
}

afterEach(() => {
  document.documentElement.querySelectorAll(NOTICE_TAG).forEach((n) => n.remove())
  document.body.replaceChildren()
  vi.useRealTimers()
})

describe('aviso de nivel medio — aislamiento', () => {
  it('vive en un Shadow DOM CERRADO: la página no ve sus nodos', () => {
    const { host } = mount()
    expect(host.tagName.toLowerCase()).toBe(NOTICE_TAG)
    expect(host.shadowRoot).toBeNull() // cerrado: no hay acceso desde la página
    expect(document.querySelector('.pill')).toBeNull()
    expect(document.body.textContent).not.toContain('Precaución')
  })

  it('usa la capa superior (popover manual) y estilos en línea con !important frente al CSS de la página', () => {
    const { host } = mount()
    expect(host.getAttribute('popover')).toBe('manual')
    for (const property of ['display', 'position', 'z-index', 'visibility', 'opacity']) {
      expect(host.style.getPropertyPriority(property)).toBe('important')
    }
    expect(host.style.getPropertyValue('position')).toBe('fixed')
    expect(host.style.getPropertyValue('left')).toBe('16px')
    expect(host.style.getPropertyValue('bottom')).toBe('16px')
  })

  it('no roba el foco al aparecer', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    mount()
    expect(document.activeElement).toBe(input)
  })

  it('anuncia el aviso en una región aria-live (role=status) sin mover el foco', () => {
    vi.useFakeTimers()
    const { $ } = mount({ requireTrustedEvents: false, announceDelayMs: 300 })
    const live = $('[role="status"]')
    expect(live.textContent).toBe('')
    vi.advanceTimersByTime(300)
    expect(live.textContent).toContain('ten cuidado con este sitio')
  })
})

describe('aviso de nivel medio — píldora y panel', () => {
  it('empieza como píldora "Precaución · Ver motivo · ×" y el panel cerrado', () => {
    const { $ } = mount()
    expect($('.pill-label').textContent).toBe('Precaución')
    expect($('.more').textContent).toBe('Ver motivo')
    expect($('.more').getAttribute('aria-expanded')).toBe('false')
    expect($('.pill .close').getAttribute('aria-label')).toBe('Cerrar aviso de PhishGuard')
    expect($<HTMLElement>('.panel').hidden).toBe(true)
  })

  it('"Ver motivo" abre el panel con el veredicto, el destino real y los motivos numerados', () => {
    const { $, root } = mount()
    $<HTMLButtonElement>('.more').click()

    expect($<HTMLElement>('.panel').hidden).toBe(false)
    expect($<HTMLElement>('.pill').hidden).toBe(true)
    expect($('.more').getAttribute('aria-expanded')).toBe('true')
    expect($('h2.title').textContent).toBe('Ten cuidado con este sitio')
    expect($('.destination-label').textContent).toBe(
      'Parece paypal.com, pero en realidad te lleva a',
    )
    expect($('.domain').textContent).toBe('login.example')
    expect([...root.querySelectorAll('ol li')].map((li) => li.textContent)).toEqual(CONTENT.signals)
    expect(root.textContent).not.toMatch(/segur[oa]|\d+\s*\/\s*100/i)
  })

  it('Esc con el panel abierto vuelve a la píldora; Esc en la píldora cierra el aviso', () => {
    const { $, host, actions } = mount()
    $<HTMLButtonElement>('.more').click()
    press($('.title'), 'Escape')
    expect($<HTMLElement>('.panel').hidden).toBe(true)
    expect($<HTMLElement>('.pill').hidden).toBe(false)
    expect(actions.onDismiss).not.toHaveBeenCalled()

    press($('.more'), 'Escape')
    expect(actions.onDismiss).toHaveBeenCalledTimes(1)
    expect(host.isConnected).toBe(false)
  })

  it('× cierra el aviso y avisa al background para no repetirlo', () => {
    const { $, host, actions } = mount()
    $<HTMLButtonElement>('.pill .close').click()
    expect(actions.onDismiss).toHaveBeenCalledTimes(1)
    expect(host.isConnected).toBe(false)
  })

  it('"Confiar en este sitio" pide confirmación en línea con el dominio antes de actuar', () => {
    const { $, host, actions } = mount()
    $<HTMLButtonElement>('.more').click()
    $<HTMLButtonElement>('.trust').click()
    expect($('.confirm p').textContent).toContain('paypal.com.login.example')
    expect(actions.onTrust).not.toHaveBeenCalled()

    $<HTMLButtonElement>('.confirm-no').click()
    expect($<HTMLElement>('.confirm').hidden).toBe(true)

    $<HTMLButtonElement>('.trust').click()
    $<HTMLButtonElement>('.confirm-yes').click()
    expect(actions.onTrust).toHaveBeenCalledTimes(1)
    expect(host.isConnected).toBe(false)
  })

  it('por defecto ignora clics y teclas sintéticos (un script de la página no puede confiar ni cerrar)', () => {
    const actions = { onDismiss: vi.fn(), onTrust: vi.fn() }
    const { root, host } = mountMediumNotice(document, CONTENT, actions)
    root.querySelector<HTMLButtonElement>('.more')!.click()
    expect(root.querySelector<HTMLElement>('.panel')!.hidden).toBe(true)
    root.querySelector<HTMLButtonElement>('.confirm-yes')!.click()
    root.querySelector<HTMLButtonElement>('.pill .close')!.click()
    press(root.querySelector('.more')!, 'Escape')
    expect(actions.onTrust).not.toHaveBeenCalled()
    expect(actions.onDismiss).not.toHaveBeenCalled()
    expect(host.isConnected).toBe(true)
  })

  it('sin señales concretas muestra la explicación en lugar de una lista vacía', () => {
    const actions = { onDismiss: vi.fn(), onTrust: vi.fn() }
    const { root } = mountMediumNotice(
      document,
      {
        ...CONTENT,
        signals: [],
        apparent: null,
        noSignalsText: 'No hay una señal concreta: la precaución viene del análisis automático.',
      },
      actions,
      { requireTrustedEvents: false },
    )
    expect(root.querySelector('ol')).toBeNull()
    expect(root.textContent).toContain('análisis automático')
    expect(root.querySelector('.destination-label')!.textContent).toBe('Estás en')
  })

  it('los estilos respetan prefers-reduced-motion y no hay textos de menos de 13 px', () => {
    const { root } = mount()
    const css = root.querySelector('style')!.textContent!
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    const sizes = [...css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]))
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(13)
  })
})
