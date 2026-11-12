export interface TrustedBannerActions {
  onUntrust: () => void
}

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

/**
 * Se muestra en la pestaña Análisis cuando el hostname de la pestaña activa
 * está en la allowlist. Deliberadamente separado de `renderDecision`: esto
 * es una decisión del usuario, no un resultado del modelo — nunca dice
 * "riesgo bajo" ni nada parecido.
 */
export function renderTrustedBanner(
  container: HTMLElement,
  hostname: string,
  actions: TrustedBannerActions,
): void {
  container.replaceChildren()

  const card = el('div', 'card trusted-banner')
  card.appendChild(el('p', 'trusted-banner-label', 'Sitio permitido por el usuario'))
  card.appendChild(el('p', 'trusted-banner-hostname', hostname))
  card.appendChild(
    el(
      'p',
      'trusted-banner-note',
      'PhishGuard no evalúa este dominio porque tú decidiste confiar en él, no porque el modelo lo haya calificado como seguro.',
    ),
  )

  const untrustButton = el('button', 'trusted-banner-untrust', 'Quitar de sitios confiables')
  untrustButton.type = 'button'
  untrustButton.addEventListener('click', actions.onUntrust)
  card.appendChild(untrustButton)

  container.appendChild(card)
}

export function clearTrustedBanner(container: HTMLElement): void {
  container.replaceChildren()
}
