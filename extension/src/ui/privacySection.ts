function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** Sección estática "PRIVACIDAD" de Configuración — sin estado ni acciones, solo texto. */
export function renderPrivacySection(container: HTMLElement): void {
  container.replaceChildren()

  container.appendChild(el('p', 'stats-section-title', 'PRIVACIDAD'))
  container.appendChild(
    el(
      'p',
      'privacy-note settings-privacy-text',
      'PhishGuard procesa las URLs y guarda sus datos localmente en este navegador. No envía el historial a servidores externos.',
    ),
  )
}
