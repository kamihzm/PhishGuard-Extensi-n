import { describe, expect, it } from 'vitest'
import { renderPrivacySection } from './privacySection'

describe('privacySection', () => {
  it('muestra el título y el texto de privacidad', () => {
    const container = document.createElement('div')
    renderPrivacySection(container)

    expect(container.querySelector('.stats-section-title')?.textContent).toBe('PRIVACIDAD')
    expect(container.querySelector('.settings-privacy-text')?.textContent).toContain(
      'No envía el historial',
    )
  })

  it('reemplaza el contenido anterior en vez de acumularlo', () => {
    const container = document.createElement('div')
    renderPrivacySection(container)
    renderPrivacySection(container)

    expect(container.querySelectorAll('.stats-section-title')).toHaveLength(1)
  })
})
