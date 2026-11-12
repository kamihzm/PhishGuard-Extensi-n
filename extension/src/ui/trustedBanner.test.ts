import { describe, expect, it, vi } from 'vitest'
import { clearTrustedBanner, renderTrustedBanner } from './trustedBanner'

describe('trustedBanner', () => {
  it('muestra "Sitio permitido por el usuario" y el hostname, no un resultado del modelo', () => {
    const container = document.createElement('div')
    renderTrustedBanner(container, 'example.com', { onUntrust: vi.fn() })

    expect(container.querySelector('.trusted-banner-label')?.textContent).toBe(
      'Sitio permitido por el usuario',
    )
    expect(container.querySelector('.trusted-banner-hostname')?.textContent).toBe('example.com')
    expect(container.textContent).not.toContain('riesgo bajo')
  })

  it('el botón "Quitar de sitios confiables" invoca onUntrust', () => {
    const container = document.createElement('div')
    const onUntrust = vi.fn()
    renderTrustedBanner(container, 'example.com', { onUntrust })

    container.querySelector<HTMLButtonElement>('.trusted-banner-untrust')?.click()

    expect(onUntrust).toHaveBeenCalledTimes(1)
  })

  it('reemplaza el contenido anterior en vez de acumularlo', () => {
    const container = document.createElement('div')
    renderTrustedBanner(container, 'a.example', { onUntrust: vi.fn() })
    renderTrustedBanner(container, 'b.example', { onUntrust: vi.fn() })

    expect(container.querySelectorAll('.trusted-banner')).toHaveLength(1)
    expect(container.querySelector('.trusted-banner-hostname')?.textContent).toBe('b.example')
  })

  it('clearTrustedBanner deja el contenedor vacío', () => {
    const container = document.createElement('div')
    renderTrustedBanner(container, 'example.com', { onUntrust: vi.fn() })

    clearTrustedBanner(container)

    expect(container.childElementCount).toBe(0)
  })
})
