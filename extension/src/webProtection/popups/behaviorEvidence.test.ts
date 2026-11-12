import { describe, expect, it } from 'vitest'
import {
  BEHAVIOR_THRESHOLD,
  countRedirects,
  evaluateBehaviorEvidence,
  MAX_CREATION_DELAY_MS,
  siteSequence,
} from './behaviorEvidence'
import { classifyPopup } from './popupClassifier'
import type { AdEvidence, HopRecord, UserIntent } from './types'

/**
 * Dominios SINTÉTICOS (.test): la función no conoce ningún dominio real. Las
 * formas de las cadenas replican las medidas en Chrome real (diagnóstico H3):
 * salto rotativo → red intermedia (navegación de cliente o 302) → 302 → anunciante.
 */
const noEvidence: AdEvidence = { isAdUrl: () => false, isException: () => false }
const SOURCE = 'https://anime.test/serie/1/'
const T = 1_000_000
const click = (over: Partial<UserIntent> = {}): UserIntent => ({
  kind: 'click',
  at: T - 20,
  newTab: false,
  expectedUrl: 'https://anime.test/serie/2/',
  form: false,
  ...over,
})
const hop = (url: string, via: HopRecord['via'], dt: number, status?: number): HopRecord => ({
  url,
  via,
  at: T + dt,
  ...(status ? { status } : {}),
})

/** Forma real 1: salto → red (navegación de cliente) → 302 → 302 anunciante. */
const AD_CHAIN_CLIENT: HopRecord[] = [
  hop('https://xx.jump-rotating.test/cx', 'initial', 0),
  hop('https://xx.jump-rotating.test/cx', 'navigation', 20),
  hop('https://xx.jump-rotating.test/cx', 'commit', 1800),
  hop('https://linknet.test/link2', 'navigation', 1805),
  hop('https://unrelated-search.test/search', 'request', 1811), // petición suelta: no cuenta
  hop('https://linknet.test/rhd', 'navigation', 2594),
  hop('https://betting-advertiser.test/', 'server-redirect', 2893, 302),
  hop('https://betting-advertiser.test/bienvenida', 'server-redirect', 3247, 302),
]
/** Forma real 2: salto → 302 → 302 (todo por servidor). */
const AD_CHAIN_SERVER: HopRecord[] = [
  hop('https://op.jump-rotating2.test/cx', 'initial', 0),
  hop('https://op.jump-rotating2.test/cx', 'navigation', 58),
  hop('https://rtbnet.test/event', 'server-redirect', 568, 302),
  hop('https://live-advertiser.test/', 'server-redirect', 921, 302),
]
const run = (hops: HopRecord[], intents: UserIntent[] | null = [click()], evidence = noEvidence) =>
  evaluateBehaviorEvidence({ sourceUrl: SOURCE, createdAt: T, intents, hops, evidence })

describe('evaluateBehaviorEvidence — cadenas publicitarias reales (sin evidencia de lista)', () => {
  it('salto → red (cliente) → 302 → 302: CONFIRMADO 3/3', () => {
    const r = run(AD_CHAIN_CLIENT)
    expect(r.confirmed).toBe(true)
    expect(r.score).toBe(BEHAVIOR_THRESHOLD)
    expect(r.signals).toEqual([
      'fast-redirects',
      'registrable-domain-changes',
      'final-site-differs',
    ])
    expect(r.distinctSites).toBe(3)
    expect(r.redirects).toBe(4)
  })

  it('salto → 302 → 302: CONFIRMADO 3/3', () => {
    const r = run(AD_CHAIN_SERVER)
    expect(r.confirmed).toBe(true)
    expect(r.redirects).toBe(2)
  })

  it('las peticiones sueltas (sin navegación) no cuentan como dominio', () => {
    expect(siteSequence(AD_CHAIN_CLIENT)).toEqual([
      'jump-rotating.test',
      'linknet.test',
      'betting-advertiser.test',
    ])
  })
})

describe('evaluateBehaviorEvidence — casos legítimos y ambiguos (nunca se confirman)', () => {
  it('window.open legítimo desde un botón (sin destino pedido): compuerta de navegación explícita', () => {
    const r = run(AD_CHAIN_SERVER, [click({ expectedUrl: null })])
    expect(r.confirmed).toBe(false)
    expect(r.failedGate).toBe('explicit-same-site-navigation')
  })

  it('window.open → 302 → sitio legítimo (2 dominios, 1 redirección): 1/3', () => {
    const r = run([
      hop('https://hop.test/r', 'initial', 0),
      hop('https://hop.test/r', 'navigation', 10),
      hop('https://legit.test/landing', 'server-redirect', 200, 302),
    ])
    expect(r.confirmed).toBe(false)
    expect(r.score).toBe(1)
    expect(r.signals).toEqual(['final-site-differs'])
  })

  it.each([
    ['Ctrl/Cmd/Shift+clic o target=_blank', [click({ newTab: true })]],
    ['clic central', [click({ kind: 'auxclick', newTab: true })]],
    ['intención desconocida', null],
  ])('%s: compuerta "no solicitada"', (_n, intents) => {
    const r = run(AD_CHAIN_SERVER, intents as UserIntent[] | null)
    expect(r.confirmed).toBe(false)
    expect(r.failedGate).toBe('unrequested')
  })

  it('formulario enviado: nunca por comportamiento', () => {
    const r = run(AD_CHAIN_SERVER, [click({ kind: 'submit', form: true })])
    expect(r.failedGate).toBe('no-form')
  })

  it('OAuth / login / pago en cualquier salto de navegación', () => {
    for (const url of [
      'https://accounts.idp.test/o/oauth2/auth',
      'https://shop.test/checkout',
      'https://x.test/login',
    ]) {
      const r = run([...AD_CHAIN_SERVER, hop(url, 'server-redirect', 1000, 302)])
      expect(r.failedGate).toBe('no-sensitive-hop')
    }
  })

  it('excepción de lista en la cadena', () => {
    const exc: AdEvidence = { isAdUrl: () => false, isException: (u) => u.includes('rtbnet') }
    expect(run(AD_CHAIN_SERVER, [click()], exc).failedGate).toBe('no-list-exception')
  })

  it('ventana creada más tarde que la interacción (> MAX_CREATION_DELAY_MS)', () => {
    const late = click({ at: T - MAX_CREATION_DELAY_MS - 1 })
    expect(run(AD_CHAIN_SERVER, [late]).failedGate).toBe('explicit-same-site-navigation')
  })

  it('el usuario pidió un enlace EXTERNO (no del mismo sitio)', () => {
    const r = run(AD_CHAIN_SERVER, [click({ expectedUrl: 'https://externo.test/doc' })])
    expect(r.failedGate).toBe('explicit-same-site-navigation')
  })

  it('la ventana lleva al destino que el usuario pidió', () => {
    const r = run([hop('https://anime.test/serie/2/', 'initial', 0)])
    expect(r.failedGate).toBe('cross-site-destination')
    const cross = run([
      hop('https://cdn.other.test/x', 'initial', 0),
      hop('https://anime.test/serie/2/', 'server-redirect', 50, 302),
    ])
    expect(cross.failedGate).toBe('destination-differs-from-requested')
  })

  it('destino inicial del mismo sitio', () => {
    expect(run([hop('https://cdn.anime.test/p', 'initial', 0)]).failedGate).toBe(
      'cross-site-destination',
    )
  })

  it('redirecciones fuera de la ventana de 5 s no cuentan', () => {
    const slow: HopRecord[] = [
      hop('https://a.test/', 'initial', 0),
      hop('https://a.test/', 'navigation', 10),
      hop('https://b.test/', 'server-redirect', 6000, 302),
      hop('https://c.test/', 'server-redirect', 7000, 302),
    ]
    expect(countRedirects(slow, T)).toBe(0)
    expect(run(slow).confirmed).toBe(false)
  })

  it('3 dominios pero una sola redirección: no se confirma', () => {
    const r = run([
      hop('https://a.test/', 'initial', 0),
      hop('https://b.test/', 'server-redirect', 100, 302),
      hop('https://c.test/', 'commit', 200),
    ])
    expect(r.distinctSites).toBe(3)
    expect(r.redirects).toBe(1)
    expect(r.confirmed).toBe(false)
  })
})

describe('orden de decisión en classifyPopup', () => {
  const input = (hops: HopRecord[], evidence = noEvidence) => ({
    sourceUrl: SOURCE,
    chain: hops.map((h) => h.url),
    createdAt: T,
    intents: [click()],
    siblings: 0,
    evidence,
    hops,
  })

  it('1) con evidencia de lista: CONFIRMED por lista (la ruta original no cambia)', () => {
    const list: AdEvidence = { isAdUrl: (u) => u.includes('rtbnet'), isException: () => false }
    const r = classifyPopup(input(AD_CHAIN_SERVER, list))
    expect(r.verdict).toBe('CONFIRMED_POPUP_AD')
    expect(r.signals).toContain('list-evidence')
  })

  it('2) sin evidencia de lista, aunque el comportamiento sea 3/3: SUSPICIOUS (solo diagnóstico)', () => {
    const r = classifyPopup(input(AD_CHAIN_CLIENT))
    expect(r.verdict).toBe('SUSPICIOUS')
    expect(r.behavior?.score).toBe(3)
  })

  // Controles legítimos medidos en Chrome real que dan 3/3 con la función: el
  // clasificador nunca los confirma (motivo por el que el comportamiento no actúa).
  it.each([
    [
      'OAuth con rutas neutras que vuelve al sitio',
      ['https://idp.test/o/start', 'https://federated.test/s', 'https://anime.test/done'],
    ],
    [
      'OAuth en curso (3 dominios, esperando al usuario)',
      ['https://idp.test/p/start', 'https://corp-federation.test/f', 'https://workforce.test/wait'],
    ],
    [
      'pago en curso (3 dominios, esperando al usuario)',
      ['https://gateway.test/p/1', 'https://threeds-server.test/t', 'https://issuerbank.test/wait'],
    ],
  ])('%s: SUSPICIOUS, nunca CONFIRMED', (_n, [a, b, c]) => {
    const hops = [
      hop(a!, 'initial', 0),
      hop(a!, 'navigation', 7),
      hop(b!, 'server-redirect', 10, 302),
      hop(c!, 'server-redirect', 16, 302),
      hop(c!, 'commit', 29),
    ]
    const r = classifyPopup(input(hops))
    expect(r.behavior?.score).toBe(3)
    expect(r.verdict).toBe('SUSPICIOUS')
  })

  it('3) sin evidencia suficiente: SUSPICIOUS (con el detalle del comportamiento)', () => {
    const r = classifyPopup(input(AD_CHAIN_SERVER.slice(0, 3)))
    expect(r.verdict).toBe('SUSPICIOUS')
    expect(r.behavior?.confirmed).toBe(false)
  })

  it('sin saltos con procedencia (llamadas antiguas): comportamiento no evaluado', () => {
    const { hops: _hops, ...legacy } = input(AD_CHAIN_CLIENT)
    expect(classifyPopup(legacy).verdict).toBe('SUSPICIOUS')
  })
})
