import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHider, HIDDEN_ATTRIBUTE } from '../../hider'
import type { AdapterContext } from '../../types'
import { jkanimeAdapter } from './adapter'
import { detectJkanimeAds } from './detect'

const UUID = '13f66f3b-27de-46da-8e3a-432dd5146afe'

/** Estructura medida en Chrome real (docs/web-protection-audit.md, "Capa de página → JKanime"). */
const BANNER = `
  <ins class="604c7625" data-key="k" data-cp-host="h" data-cp-domain="d">
    <ins id="ins-${UUID}" style="position:relative">
      <div id="adangle-${UUID}-div"><img id="adangle-${UUID}-click1" src="https://amd-cdn-1.example-ad.com/content/stream/agl/x.gif"></div>
    </ins>
  </ins>`
const OVERLAY = `<div id="adangle-pop-iframe-overlay" style="position:absolute;z-index:99"><iframe src="https://cvt-s2.example-ad.com/x" style="opacity:0"></iframe></div>`
const WIDGET = `
  <div id="widget" dir="ltr" data-shb="" style="position:fixed;z-index:2147483646">
    <div class="D1BnW" style="position:relative"><div class="notranslate">
      <iframe sandbox="allow-scripts allow-same-origin" srcdoc="<p>CONFIRMA QUE NO ERES UN ROBOT</p>"></iframe>
    </div></div>
  </div>`
const LEGIT_PAGE = `
  <header id="top" style="position:fixed;z-index:1000"><form role="search"><input id="q" name="q"></form></header>
  <nav id="menu"><a href="https://jkanime.net/directorio/">Directorio</a></nav>
  <div id="video_box"><iframe id="player" src="https://jkanime.net/jkplayer/um?e=1"></iframe></div>
  <div id="episodes"><a href="https://jkanime.net/serie/2/">Episodio 2</a></div>`

function context(): AdapterContext {
  return { document, window, hider: createHider(document), log: vi.fn() }
}
const hiddenIds = () =>
  [...document.querySelectorAll(`[${HIDDEN_ATTRIBUTE}]`)].map((e) => e.id || e.className)
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('detectJkanimeAds: firmas con evidencia', () => {
  beforeEach(() => {
    document.head.innerHTML = ''
    document.body.innerHTML = ''
  })

  it('banner JUGABET (red AdAngle): oculta el contenedor ins-<uuid> completo', () => {
    document.body.innerHTML = LEGIT_PAGE + BANNER
    const found = detectJkanimeAds(document, window)
    expect(found.map((d) => [d.element.id, d.signature])).toEqual([
      [`ins-${UUID}`, 'adangle-placement'],
    ])
  })

  it('capa invisible sobre el reproductor (click-catcher AdAngle)', () => {
    document.body.innerHTML = LEGIT_PAGE + OVERLAY
    const found = detectJkanimeAds(document, window)
    expect(found.map((d) => d.element.id)).toEqual(['adangle-pop-iframe-overlay'])
  })

  it('widget flotante srcdoc (bola / falso reCAPTCHA)', () => {
    document.body.innerHTML = LEGIT_PAGE + WIDGET
    const found = detectJkanimeAds(document, window)
    expect(found.map((d) => [d.element.id, d.signature])).toEqual([
      ['widget', 'floating-srcdoc-widget'],
    ])
  })

  it('página legítima sin anuncios: no detecta nada', () => {
    document.body.innerHTML = LEGIT_PAGE
    expect(detectJkanimeAds(document, window)).toEqual([])
  })

  describe('falsos positivos: falta alguna condición → no se toca', () => {
    it.each([
      ['data-shb sin position:fixed', WIDGET.replace('position:fixed;', 'position:absolute;')],
      ['data-shb con z-index normal', WIDGET.replace('2147483646', '1000')],
      [
        'iframe con src (no srcdoc)',
        WIDGET.replace('srcdoc=', 'src="https://example.com/" data-x='),
      ],
      ['fijo + z máximo + srcdoc pero SIN data-shb', WIDGET.replace('data-shb=""', '')],
      ['id que solo empieza por adangle- sin uuid', '<div id="adangle-menu">menú</div>'],
    ])('%s', (_name, html) => {
      document.body.innerHTML = LEGIT_PAGE + html
      expect(detectJkanimeAds(document, window)).toEqual([])
    })

    it('candidato que contiene el reproductor del sitio', () => {
      document.body.innerHTML = `<div id="adangle-pop-iframe-overlay"><iframe src="https://jkanime.net/jkplayer/um"></iframe></div>`
      expect(detectJkanimeAds(document, window)).toEqual([])
    })

    it('candidato que contiene búsqueda, formularios o video', () => {
      for (const inner of ['<input>', '<form></form>', '<video></video>', '<nav></nav>']) {
        document.body.innerHTML = WIDGET.replace(
          '<div class="notranslate">',
          `<div class="notranslate">${inner}`,
        )
        expect(detectJkanimeAds(document, window)).toEqual([])
      }
    })

    it('candidato con enlaces del propio sitio', () => {
      document.body.innerHTML = WIDGET.replace(
        '<div class="notranslate">',
        '<div class="notranslate"><a href="https://jkanime.net/buscar/">ir</a>',
      )
      expect(detectJkanimeAds(document, window)).toEqual([])
    })
  })
})

describe('jkanimeAdapter: aplicación, observación y teardown', () => {
  beforeEach(() => {
    document.head.innerHTML = ''
    document.body.innerHTML = LEGIT_PAGE
  })
  afterEach(() => vi.restoreAllMocks())

  it('solo aplica a jkanime.net y sus subdominios', () => {
    expect(jkanimeAdapter.appliesTo('jkanime.net')).toBe(true)
    expect(jkanimeAdapter.appliesTo('www.jkanime.net')).toBe(true)
    expect(jkanimeAdapter.appliesTo('notjkanime.net')).toBe(false)
    expect(jkanimeAdapter.appliesTo('www.youtube.com')).toBe(false)
  })

  it('oculta lo presente al iniciar y lo que se inyecta después (anuncios que rotan)', async () => {
    document.body.insertAdjacentHTML('beforeend', BANNER)
    const handle = jkanimeAdapter.start(context())
    expect(hiddenIds()).toEqual([`ins-${UUID}`])
    document.body.insertAdjacentHTML('beforeend', WIDGET)
    await wait(250)
    expect(hiddenIds()).toEqual([`ins-${UUID}`, 'widget'])
    handle.stop()
  })

  it('nunca oculta el reproductor, la búsqueda, el menú ni los enlaces', async () => {
    document.body.insertAdjacentHTML('beforeend', BANNER + OVERLAY + WIDGET)
    const handle = jkanimeAdapter.start(context())
    await wait(200)
    for (const id of ['top', 'q', 'menu', 'video_box', 'player', 'episodes']) {
      expect(document.getElementById(id)!.hasAttribute(HIDDEN_ATTRIBUTE)).toBe(false)
    }
    expect(document.body.hasAttribute(HIDDEN_ATTRIBUTE)).toBe(false)
    expect(document.documentElement.hasAttribute(HIDDEN_ATTRIBUTE)).toBe(false)
    // Sin pointer-events globales ni estilos sobre html/body.
    expect(document.documentElement.outerHTML).not.toContain('pointer-events')
    handle.stop()
  })

  it('re-ejecutar el escaneo es idempotente', async () => {
    document.body.insertAdjacentHTML('beforeend', BANNER + WIDGET)
    const ctx = context()
    const handle = jkanimeAdapter.start(ctx)
    for (let i = 0; i < 3; i++) {
      document.body.appendChild(document.createElement('span'))
      await wait(200)
    }
    expect(ctx.hider.hiddenCount()).toBe(2)
    expect(document.querySelectorAll('style')).toHaveLength(1)
    handle.stop()
  })

  it('stop() restaura el DOM exacto y desconecta el observer', async () => {
    document.body.insertAdjacentHTML('beforeend', BANNER + WIDGET)
    const before = document.documentElement.outerHTML
    const handle = jkanimeAdapter.start(context())
    expect(document.documentElement.outerHTML).not.toBe(before)
    handle.stop()
    expect(document.documentElement.outerHTML).toBe(before)
    // Tras stop, un anuncio nuevo ya no se oculta (observer desconectado).
    document.body.insertAdjacentHTML('beforeend', OVERLAY)
    await wait(250)
    expect(hiddenIds()).toEqual([])
  })

  it('fail-open: si la detección lanza, deshace lo suyo y deja de observar', async () => {
    document.body.insertAdjacentHTML('beforeend', BANNER)
    const ctx = context()
    const handle = jkanimeAdapter.start(ctx)
    expect(ctx.hider.hiddenCount()).toBe(1)
    vi.spyOn(document, 'querySelectorAll').mockImplementation(() => {
      throw new Error('DOM inesperado')
    })
    document.body.appendChild(document.createElement('div'))
    await wait(250)
    vi.restoreAllMocks()
    expect(ctx.hider.hiddenCount()).toBe(0)
    expect(ctx.log).toHaveBeenCalledWith('jkanime:scan-error')
    handle.stop()
  })
})
