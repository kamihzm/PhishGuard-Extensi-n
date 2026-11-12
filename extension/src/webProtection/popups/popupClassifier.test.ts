import { describe, expect, it } from 'vitest'
import {
  classifyPopup,
  classifyRedirect,
  isAtOpenerEdge,
  isPastOpenerFarEdge,
  isPendingCandidate,
  looksSensitive,
  type PopupWindowInfo,
} from './popupClassifier'
import type { AdEvidence, HopRecord, UserIntent } from './types'

/** Evidencia de prueba: hosts "listados" ficticios (no dominios reales descubiertos a mano). */
const evidence: AdEvidence = {
  isAdUrl: (u) => /(^|\.)adnet\.test$/.test(new URL(u).hostname),
  isException: (u) => new URL(u).hostname === 'safe.adnet.test',
}
const SOURCE = 'https://anime.test/serie/1/'
const T = 10_000
const plainClick = (expectedUrl: string | null = 'https://anime.test/serie/2/'): UserIntent => ({
  kind: 'click',
  at: T - 5,
  newTab: false,
  expectedUrl,
  form: false,
})
const popup = (chain: string[], intents: UserIntent[] | null = [plainClick()], siblings = 0) =>
  classifyPopup({ sourceUrl: SOURCE, chain, createdAt: T, intents, siblings, evidence })

describe('classifyPopup — positivos (CONFIRMED solo con las 3 señales)', () => {
  it('window.open(ad) tras un clic normal → CONFIRMED_POPUP_AD', () => {
    const r = popup(['https://adnet.test/click?id=1'])
    expect(r.verdict).toBe('CONFIRMED_POPUP_AD')
    expect(r.signals).toEqual(
      expect.arrayContaining(['unrequested', 'cross-site', 'list-evidence']),
    )
  })

  it('dominio de salto desconocido que redirige (servidor) a una red listada → CONFIRMED', () => {
    expect(
      popup(['https://rnd123.test/', 'https://pxl.adnet.test/r', 'https://shop.test/']).verdict,
    ).toBe('CONFIRMED_POPUP_AD')
  })

  it('varias ventanas de una misma interacción: cada una con evidencia se confirma', () => {
    expect(popup(['https://a.adnet.test/'], [plainClick()], 2).signals).toContain('multiple-popups')
  })

  it('pestaña publicitaria abierta a la vez que un Ctrl+clic legítimo: solo la publicitaria', () => {
    const ctrl: UserIntent = { ...plainClick('https://anime.test/serie/3/'), newTab: true }
    expect(popup(['https://anime.test/serie/3/'], [ctrl]).verdict).toBe('LEGITIMATE')
    expect(popup(['https://adnet.test/x'], [ctrl]).verdict).toBe('CONFIRMED_POPUP_AD')
  })
})

describe('classifyPopup — negativos y ambiguos (nunca se actúa)', () => {
  it('sin evidencia de lista: SUSPICIOUS aunque sea no solicitada y de otro sitio', () => {
    const r = popup(['https://rotating-domain.test/'])
    expect(r.verdict).toBe('SUSPICIOUS')
    expect(r.signals).not.toContain('list-evidence')
  })

  it('Ctrl+clic / clic central / target=_blank hacia su destino → LEGITIMATE', () => {
    const intent: UserIntent = { ...plainClick('https://externo.test/doc'), newTab: true }
    expect(popup(['https://externo.test/doc'], [intent]).verdict).toBe('LEGITIMATE')
  })

  it('pestaña nueva pedida sin destino conocido (p. ej. clic central en un botón) → LEGITIMATE', () => {
    expect(popup(['https://adnet.test/'], [{ ...plainClick(null), newTab: true }]).verdict).toBe(
      'LEGITIMATE',
    )
  })

  it('mismo sitio que el origen → LEGITIMATE', () => {
    expect(popup(['https://cdn.anime.test/player']).verdict).toBe('LEGITIMATE')
  })

  it('ventana al sitio que el usuario pidió → LEGITIMATE', () => {
    expect(
      popup(['https://www.externo.test/'], [plainClick('https://externo.test/doc')]).verdict,
    ).toBe('LEGITIMATE')
  })

  it('OAuth / login / pago → nunca CONFIRMED, aunque la cadena pase luego por una red listada', () => {
    expect(popup(['https://accounts.google.test/o/oauth2/auth']).verdict).toBe('SUSPICIOUS')
    expect(popup(['https://pay.test/checkout', 'https://adnet.test/']).verdict).toBe('SUSPICIOUS')
    expect(
      popup(['https://rnd.test/', 'https://sso.test/login', 'https://adnet.test/']).verdict,
    ).toBe('SUSPICIOUS')
  })

  it('excepción de lista en la cadena antes de la evidencia → no se confirma', () => {
    expect(popup(['https://safe.adnet.test/']).verdict).toBe('SUSPICIOUS')
  })

  it('intención desconocida (content script no respondió) → SUSPICIOUS', () => {
    expect(popup(['https://adnet.test/'], null).verdict).toBe('SUSPICIOUS')
  })

  it('URLs no http(s) se ignoran', () => {
    expect(popup(['about:blank']).verdict).toBe('LEGITIMATE')
  })

  it('looksSensitive', () => {
    for (const u of [
      'https://accounts.x.test/',
      'https://x.test/oauth/authorize',
      'https://x.test/login',
      'https://x.test/checkout/1',
      'https://pay.x.test/',
    ]) {
      expect(looksSensitive(u)).toBe(true)
    }
    expect(looksSensitive('https://x.test/serie/login-de-lelouch-no')).toBe(false)
  })
})

/**
 * P3: ventana que empieza en el propio sitio. Solo cuenta el tramo de redirección
 * previo al primer commit (p. ej. un redirector propio que responde 302); lo que
 * pasa después dentro del documento (clics del usuario) no se evalúa.
 */
describe('classifyPopup — primer salto del mismo sitio (P3)', () => {
  const REDIRECTOR = 'https://anime.test/out?to=1'
  const hop = (url: string, via: HopRecord['via'], at = T): HopRecord => ({ url, via, at })
  const firstParty = (
    hops: HopRecord[],
    intents: UserIntent[] | null = [plainClick()],
    ev: AdEvidence = evidence,
  ) => {
    const input = {
      sourceUrl: SOURCE,
      // Como `pushToObservation`: solo se omiten repeticiones consecutivas.
      chain: hops.map((h) => h.url).filter((u, i, all) => all[i - 1] !== u),
      createdAt: T,
      intents,
      siblings: 0,
      evidence: ev,
      hops,
    }
    return { input, result: classifyPopup(input) }
  }
  /** window.open(REDIRECTOR) → 302 → `to` → commit en `to`. */
  const redirectTo = (to: string) => [
    hop(REDIRECTOR, 'initial'),
    hop(REDIRECTOR, 'navigation'),
    hop(REDIRECTOR, 'request'),
    hop(to, 'server-redirect'),
    hop(to, 'request'),
    hop(to, 'commit'),
  ]

  it('redirector propio que responde 302 hacia una red listada → CONFIRMED_POPUP_AD', () => {
    const { result } = firstParty(redirectTo('https://adnet.test/landing'))
    expect(result.verdict).toBe('CONFIRMED_POPUP_AD')
    expect(result.signals).toEqual(
      expect.arrayContaining(['first-party-redirect', 'unrequested', 'cross-site', 'list-evidence']),
    )
  })

  it('redirección de servidor que nunca sale del sitio → LEGITIMATE', () => {
    expect(firstParty(redirectTo('https://cdn.anime.test/player')).result.verdict).toBe(
      'LEGITIMATE',
    )
  })

  it('sin saltos registrados (solo la cadena) → LEGITIMATE como antes', () => {
    expect(popup([REDIRECTOR, 'https://adnet.test/landing']).verdict).toBe('LEGITIMATE')
  })

  it('clic del usuario dentro de la ventana ya cargada hacia una red listada → LEGITIMATE', () => {
    const { result } = firstParty([
      hop(REDIRECTOR, 'initial'),
      hop(REDIRECTOR, 'commit'),
      hop('https://adnet.test/deal', 'navigation', T + 3_000),
      hop('https://adnet.test/deal', 'commit', T + 3_100),
    ])
    expect(result.verdict).toBe('LEGITIMATE')
  })

  it('target=_blank / Ctrl+clic hacia el redirector propio → LEGITIMATE aunque acabe en una red listada', () => {
    const intent: UserIntent = { ...plainClick(REDIRECTOR), newTab: true }
    expect(firstParty(redirectTo('https://adnet.test/landing'), [intent]).result.verdict).toBe(
      'LEGITIMATE',
    )
  })

  it('clic normal en un enlace al redirector propio (abierto con window.open) → LEGITIMATE aunque acabe en una red listada', () => {
    const { result } = firstParty(redirectTo('https://adnet.test/landing'), [plainClick(REDIRECTOR)])
    expect(result.verdict).toBe('LEGITIMATE')
    expect(result.signals).toContain('intended-destination')
  })

  it('sin interacción reciente registrada (menú contextual, clic en iframe) → SUSPICIOUS, nunca CONFIRMED', () => {
    const { result } = firstParty(redirectTo('https://adnet.test/landing'), [])
    expect(result.verdict).toBe('SUSPICIOUS')
    expect(result.signals).toContain('no-recent-intent')
  })

  it('redirector propio hacia un sitio no listado (p. ej. compartir) → SUSPICIOUS, nunca CONFIRMED', () => {
    const { result } = firstParty(redirectTo('https://social.test/share'))
    expect(result.verdict).toBe('SUSPICIOUS')
    expect(result.signals).not.toContain('list-evidence')
  })

  it('OAuth iniciado en el propio sitio → nunca CONFIRMED, aunque la cadena pase por una red listada', () => {
    expect(firstParty(redirectTo('https://accounts.google.test/o/oauth2/auth')).result.verdict).toBe(
      'SUSPICIOUS',
    )
    const start = 'https://anime.test/login?next=1'
    const { result } = firstParty([
      hop(start, 'initial'),
      hop('https://adnet.test/landing', 'server-redirect'),
      hop('https://adnet.test/landing', 'commit'),
    ])
    expect(result.verdict).toBe('SUSPICIOUS')
    expect(result.signals).toContain('sensitive-destination')
  })

  it('excepción de lista en el redirector propio → no se confirma', () => {
    const ev: AdEvidence = { ...evidence, isException: (u) => u === REDIRECTOR }
    expect(
      firstParty(redirectTo('https://adnet.test/landing'), [plainClick()], ev).result.verdict,
    ).toBe('SUSPICIOUS')
  })

  it('intención desconocida → SUSPICIOUS', () => {
    expect(firstParty(redirectTo('https://adnet.test/landing'), null).result.verdict).toBe(
      'SUSPICIOUS',
    )
  })

  it('no entra en POPUP_PENDING: se sigue liberando al registrarse, como antes', () => {
    const { input, result } = firstParty(redirectTo('https://social.test/share'))
    expect(isPendingCandidate(result, input)).toBe(false)
  })
})

/**
 * T6: popunder de animeyt.cc (2026-10-15). Ventana `type: popup` diminuta que
 * nace en about:blank y luego el script la manda a OTRO sitio no listado. Solo
 * se confirma con TODAS las condiciones; falta una → nunca se cierra.
 */
describe('classifyPopup — ventana popunder (T6, técnica y no dominios)', () => {
  const ROTATING = 'https://brkbaawvypikso.test/?rv=1'
  // Área de contenido que Chrome reportó para `width=5,height=5` (lo agranda a su mínimo).
  const TINY: PopupWindowInfo = { type: 'popup', width: 131, height: 110, bornBlank: true }
  // Medido en animeyt: el script navega la ventana ~1,1 s después de abrirla.
  const popunder = (
    chain: string[] = [ROTATING],
    window: Partial<PopupWindowInfo> | null = {},
    intents: UserIntent[] | null = [plainClick(null)],
    firstHopAt = T + 1100,
  ) =>
    classifyPopup({
      sourceUrl: SOURCE,
      chain,
      createdAt: T,
      intents,
      siblings: 0,
      evidence,
      hops: chain.map((url, i) => ({ url, via: 'navigation' as const, at: firstHopAt + i * 300 })),
      ...(window ? { window: { ...TINY, ...window } } : {}),
    })

  it('popup diminuta nacida en about:blank → otro sitio sin lista, tras un clic en la página: CONFIRMED', () => {
    const r = popunder()
    expect(r.verdict).toBe('CONFIRMED_POPUP_AD')
    expect(r.signals).toEqual(
      expect.arrayContaining(['unrequested', 'cross-site', 'popunder-window']),
    )
    expect(r.signals).not.toContain('list-evidence')
  })

  it('justo en el límite de tamaño (200×150): CONFIRMED', () => {
    expect(popunder(undefined, { width: 200, height: 150 }).verdict).toBe('CONFIRMED_POPUP_AD')
  })

  it('el clic real del usuario en la página no la salva (el script usa ese clic)', () => {
    const atPlayer: UserIntent = { ...plainClick(null), at: T - 30 }
    expect(popunder(undefined, {}, [atPlayer]).verdict).toBe('CONFIRMED_POPUP_AD')
  })

  describe('falta UNA condición: nunca se confirma', () => {
    it('abierta directamente con su URL (no nació en about:blank)', () => {
      expect(popunder(undefined, { bornBlank: false }).verdict).toBe('SUSPICIOUS')
    })
    it('ventana normal (pestaña), no popup', () => {
      expect(popunder(undefined, { type: 'normal' }).verdict).toBe('SUSPICIOUS')
    })
    it('popup de OAuth/pago de tamaño real (516×735)', () => {
      expect(popunder(undefined, { width: 516, height: 735 }).verdict).toBe('SUSPICIOUS')
    })
    it('solo una dimensión pequeña (201×150 o 180×600)', () => {
      expect(popunder(undefined, { width: 201 }).verdict).toBe('SUSPICIOUS')
      expect(popunder(undefined, { width: 180, height: 600 }).verdict).toBe('SUSPICIOUS')
    })
    it('sin datos de la ventana (no se pudo leer): misma política que siempre', () => {
      expect(popunder(undefined, null).verdict).toBe('SUSPICIOUS')
    })
    it('aún en about:blank (sin navegación posterior): no hay destino que juzgar', () => {
      expect(popunder([]).verdict).toBe('LEGITIMATE')
    })
    it('navega al mismo sitio', () => {
      expect(popunder(['https://anime.test/widget']).verdict).toBe('LEGITIMATE')
    })
    it('el usuario pidió pestaña/ventana nueva', () => {
      const ctrl: UserIntent = { ...plainClick(null), newTab: true }
      expect(popunder(undefined, {}, [ctrl]).verdict).toBe('LEGITIMATE')
    })
    it('va al sitio que el usuario pidió con su clic', () => {
      const link = plainClick('https://brkbaawvypikso.test/oferta')
      expect(popunder(undefined, {}, [link]).verdict).toBe('LEGITIMATE')
    })
    it('intención desconocida (fail-open)', () => {
      expect(popunder(undefined, {}, null).verdict).toBe('SUSPICIOUS')
    })
    it('destino de login/OAuth/pago', () => {
      const r = popunder(['https://accounts.idp.test/o/oauth2/authorize'])
      expect(r.verdict).toBe('SUSPICIOUS')
      expect(r.signals).toContain('sensitive-destination')
    })
    it('salto cubierto por una excepción de la lista', () => {
      expect(popunder(['https://safe.adnet.test/x']).verdict).toBe('SUSPICIOUS')
    })
    it('el usuario apretó un control que puede abrir ventanas (botón de chat, enlace "#")', () => {
      const button: UserIntent = { ...plainClick(null), control: true }
      expect(popunder(undefined, {}, [button]).verdict).toBe('SUSPICIOUS')
    })
    it('la navegación a otro sitio llega tarde (> 3 s: p. ej. un clic del usuario dentro de la ventana)', () => {
      expect(popunder(undefined, {}, undefined, T + 3001).verdict).toBe('SUSPICIOUS')
      expect(popunder(undefined, {}, undefined, T + 3000).verdict).toBe('CONFIRMED_POPUP_AD')
    })
    it('sin saltos registrados (no se sabe cuándo navegó)', () => {
      const r = classifyPopup({
        sourceUrl: SOURCE,
        chain: [ROTATING],
        createdAt: T,
        intents: [plainClick(null)],
        siblings: 0,
        evidence,
        window: TINY,
      })
      expect(r.verdict).toBe('SUSPICIOUS')
    })
    it('tamaño 0 o aún sin calcular (por debajo del mínimo de Chrome)', () => {
      expect(popunder(undefined, { width: 0, height: 0 }).verdict).toBe('SUSPICIOUS')
      expect(popunder(undefined, { width: 131, height: 49 }).verdict).toBe('SUSPICIOUS')
    })
  })

  /**
   * T7 (Chrome real del usuario, 2026-10-16): el popunder se dispara con el clic
   * en un botón de la página (play, episodio), que registra `control: true`. El
   * veto del control solo se levanta si la ventana nació en o más allá del
   * borde DERECHO o INFERIOR de la ventana que la abrió (`atFarEdge === true`);
   * los bordes izquierdo y superior (`atEdge` sin `atFarEdge`) no lo levantan.
   */
  describe('clic en un control (T7)', () => {
    const button: UserIntent = { ...plainClick(null), control: true }

    it('(a) control + nacida en el borde derecho o inferior + diminuta en about:blank → otro sitio en < 3 s: CONFIRMED', () => {
      const r = popunder(undefined, { atEdge: true, atFarEdge: true }, [button])
      expect(r.verdict).toBe('CONFIRMED_POPUP_AD')
      expect(r.signals).toContain('popunder-window')
    })
    it('nacida en el borde izquierdo o superior (atEdge sin atFarEdge): el veto se mantiene', () => {
      const r = popunder(undefined, { atEdge: true, atFarEdge: false }, [button])
      expect(r.verdict).toBe('SUSPICIOUS')
      expect(r.signals).not.toContain('popunder-window')
    })
    it('(b) chat pequeño abierto por un botón en el centro de la ventana: no se confirma', () => {
      const chat = popunder(undefined, { width: 180, height: 140, atEdge: false, atFarEdge: false }, [
        button,
      ])
      expect(chat.verdict).toBe('SUSPICIOUS')
      expect(chat.signals).not.toContain('popunder-window')
    })
    it('(d) borde sin medir (atFarEdge undefined): el veto del control se mantiene (fail-open)', () => {
      const r = popunder(undefined, { atEdge: true, atFarEdge: undefined }, [button])
      expect(r.verdict).toBe('SUSPICIOUS')
      expect(r.signals).not.toContain('popunder-window')
    })
    it('nacida en el borde derecho pero sin el resto de la técnica (abierta con su URL): no se confirma', () => {
      expect(
        popunder(undefined, { atEdge: true, atFarEdge: true, bornBlank: false }, [button]).verdict,
      ).toBe('SUSPICIOUS')
    })
    it('sin clic en un control, atFarEdge no cambia nada de T6', () => {
      expect(popunder(undefined, { atFarEdge: false }).verdict).toBe('CONFIRMED_POPUP_AD')
    })
  })

  describe('diagnóstico: qué condición de popunder-window falló (T7)', () => {
    const button: UserIntent = { ...plainClick(null), control: true }

    it('control sin borde derecho/inferior: nombra el control y el valor de atFarEdge', () => {
      expect(popunder(undefined, { atEdge: true, atFarEdge: false }, [button]).popunderMiss).toEqual(
        ['control(atFarEdge=false)'],
      )
      expect(popunder(undefined, {}, [button]).popunderMiss).toEqual([
        'control(atFarEdge=unmeasured)',
      ])
    })
    it('tamaño, bornBlank y ventana de 3 s', () => {
      expect(popunder(undefined, { width: 516, height: 735 }).popunderMiss).toEqual([
        'size=516x735',
      ])
      expect(popunder(undefined, { bornBlank: false }).popunderMiss).toEqual(['bornBlank=false'])
      expect(popunder(undefined, {}, undefined, T + 3001).popunderMiss).toEqual(['nav>3s'])
    })
    it('destino sensible o con excepción de la lista', () => {
      expect(
        popunder(['https://accounts.idp.test/o/oauth2/authorize']).popunderMiss,
      ).toEqual(['sensitive-or-exception'])
      expect(popunder(['https://safe.adnet.test/x']).popunderMiss).toEqual([
        'sensitive-or-exception',
      ])
    })
    it('varias a la vez, en orden fijo', () => {
      expect(
        popunder(undefined, { width: 516, height: 735, bornBlank: false }, [button]).popunderMiss,
      ).toEqual(['bornBlank=false', 'size=516x735', 'control(atFarEdge=unmeasured)'])
    })
    it('confirmada o sin datos de ventana: sin diagnóstico', () => {
      expect(popunder().popunderMiss).toBeUndefined()
      expect(popunder(undefined, null).popunderMiss).toBeUndefined()
    })
  })
})

describe('isAtOpenerEdge — popup que nace pegada o fuera del borde de la ventana que la abrió (T6)', () => {
  // Medido en animeyt.cc (Chrome con ventana, pantalla de 1366 px): la que abre
  // es normal 1383×882 en (10,10); el popunder nace 178×100 en (1366,0).
  const OPENER = { left: 10, top: 10, width: 1383, height: 882 }

  it('popunder real de animeyt (left=1366, a 27 px del borde derecho): en el borde', () => {
    expect(isAtOpenerEdge({ left: 1366, top: 0, width: 178, height: 100 }, OPENER)).toBe(true)
  })
  it('más allá del borde derecho o inferior: en el borde', () => {
    expect(isAtOpenerEdge({ left: 1500, top: 300, width: 178, height: 100 }, OPENER)).toBe(true)
    expect(isAtOpenerEdge({ left: 400, top: 880, width: 178, height: 100 }, OPENER)).toBe(true)
  })
  it('a la izquierda o arriba, fuera de la ventana: en el borde', () => {
    expect(isAtOpenerEdge({ left: -170, top: 300, width: 178, height: 100 }, OPENER)).toBe(true)
    expect(isAtOpenerEdge({ left: 400, top: -95, width: 178, height: 100 }, OPENER)).toBe(true)
  })
  it('centrada sobre la ventana (OAuth, chat, ventana que crece): no', () => {
    expect(isAtOpenerEdge({ left: 433, top: 76, width: 535, height: 816 }, OPENER)).toBe(false)
    expect(isAtOpenerEdge({ left: 600, top: 400, width: 178, height: 100 }, OPENER)).toBe(false)
  })
  it('dentro, pero a más de 50 px del borde: no', () => {
    expect(isAtOpenerEdge({ left: 1330, top: 0, width: 178, height: 100 }, OPENER)).toBe(false)
  })
})

describe('isPastOpenerFarEdge — nacida en o más allá del borde derecho o inferior (T7, solo levanta el veto del control)', () => {
  const OPENER = { left: 10, top: 10, width: 1383, height: 882 }
  const POPUP = { width: 178, height: 100 }

  it('popunder real de animeyt (opener 1383×882 en (10,10), popup en left=1366): sí', () => {
    expect(isPastOpenerFarEdge({ ...POPUP, left: 1366, top: 0 }, OPENER)).toBe(true)
  })
  it('borde derecho (T8): su borde DERECHO pegado o más allá (margen de 50 px)', () => {
    // Borde derecho del opener: 10 + 1383 = 1393; margen: 1343.
    expect(isPastOpenerFarEdge({ ...POPUP, left: 1165, top: 300 }, OPENER)).toBe(true)
    expect(isPastOpenerFarEdge({ ...POPUP, left: 1600, top: 300 }, OPENER)).toBe(true)
    expect(isPastOpenerFarEdge({ ...POPUP, left: 1164, top: 300 }, OPENER)).toBe(false)
  })
  it('borde inferior (T8): su borde INFERIOR pegado o más allá', () => {
    // Borde inferior del opener: 10 + 882 = 892; margen: 842.
    expect(isPastOpenerFarEdge({ ...POPUP, left: 400, top: 742 }, OPENER)).toBe(true)
    expect(isPastOpenerFarEdge({ ...POPUP, left: 400, top: 741 }, OPENER)).toBe(false)
  })
  it('borde izquierdo o superior (aunque isAtOpenerEdge diga que sí): no', () => {
    const left = { ...POPUP, left: -170, top: 300 }
    const top = { ...POPUP, left: 400, top: -95 }
    expect(isAtOpenerEdge(left, OPENER) && isAtOpenerEdge(top, OPENER)).toBe(true)
    expect(isPastOpenerFarEdge(left, OPENER)).toBe(false)
    expect(isPastOpenerFarEdge(top, OPENER)).toBe(false)
  })
  it('popup en left=0, top=0 con la ventana de origen no maximizada (flotante en (300,120)): no', () => {
    const floating = { left: 300, top: 120, width: 1000, height: 700 }
    const corner = { ...POPUP, left: 0, top: 0 }
    expect(isAtOpenerEdge(corner, floating)).toBe(true)
    expect(isPastOpenerFarEdge(corner, floating)).toBe(false)
  })
  it('centrada sobre la ventana: no', () => {
    expect(isPastOpenerFarEdge({ ...POPUP, left: 600, top: 400 }, OPENER)).toBe(false)
  })

  describe('Chrome real del usuario (T8): pantalla 1536×864, ventana maximizada en (-7,-7) 1552×832', () => {
    const MAXIMIZED = { left: -7, top: -7, width: 1552, height: 832 }
    // Chrome mete la ventana dentro de la pantalla: pegada a la derecha, no más allá.
    const HUGGING_RIGHT = { left: 1358, top: 0, width: 178, height: 182 }

    it('popup nacida pegada a la derecha DENTRO de la pantalla (1358 + 178 = 1536): sí', () => {
      expect(isPastOpenerFarEdge(HUGGING_RIGHT, MAXIMIZED)).toBe(true)
    })
    it('pegada abajo dentro del área de trabajo (borde inferior 816): sí', () => {
      expect(isPastOpenerFarEdge({ left: 600, top: 634, width: 178, height: 182 }, MAXIMIZED)).toBe(
        true,
      )
    })
    it('medido en el Chrome del usuario: left=1418, ancho 146 (borde derecho 1564, 19 px más allá): sí', () => {
      expect(isPastOpenerFarEdge({ left: 1418, top: 0, width: 146, height: 182 }, MAXIMIZED)).toBe(
        true,
      )
    })
    it('opener anclado a la mitad izquierda (0,0,768×816), popup centrada en la pantalla con borde derecho 841 (73 px): no', () => {
      const leftHalf = { left: 0, top: 0, width: 768, height: 816 }
      expect(isPastOpenerFarEdge({ left: 695, top: 341, width: 146, height: 182 }, leftHalf)).toBe(
        false,
      )
    })
    it('opener anclado a la mitad superior (0,0,1536×432), popup centrada con borde inferior 505 (73 px): no', () => {
      const topHalf = { left: 0, top: 0, width: 1536, height: 432 }
      expect(isPastOpenerFarEdge({ left: 695, top: 323, width: 146, height: 182 }, topHalf)).toBe(
        false,
      )
    })
    it('popup entera más allá del borde derecho o inferior: sí', () => {
      expect(isPastOpenerFarEdge({ left: 1600, top: 0, width: 146, height: 182 }, MAXIMIZED)).toBe(
        true,
      )
      expect(isPastOpenerFarEdge({ left: 600, top: 900, width: 146, height: 182 }, MAXIMIZED)).toBe(
        true,
      )
    })
    it('popup en left=0, top=0: no', () => {
      expect(isPastOpenerFarEdge({ left: 0, top: 0, width: 178, height: 182 }, MAXIMIZED)).toBe(false)
    })
    it('popup centrada en la pantalla: no', () => {
      expect(isPastOpenerFarEdge({ left: 679, top: 341, width: 178, height: 182 }, MAXIMIZED)).toBe(
        false,
      )
    })
  })
})

describe('classifyRedirect', () => {
  const redirect = (over: Partial<Parameters<typeof classifyRedirect>[0]> = {}) =>
    classifyRedirect({
      previousUrl: SOURCE,
      chain: ['https://adnet.test/r'],
      transitionType: 'link',
      transitionQualifiers: ['client_redirect'],
      intents: [plainClick()],
      startedAt: T,
      evidence,
      ...over,
    })

  it('página → publicidad sin intención, con evidencia → CONFIRMED_REDIRECT_AD', () => {
    expect(redirect().verdict).toBe('CONFIRMED_REDIRECT_AD')
  })

  it('redirección → sitio legítimo (sin evidencia) → SUSPICIOUS (se permite)', () => {
    expect(redirect({ chain: ['https://otro.test/'] }).verdict).toBe('SUSPICIOUS')
  })

  it.each([
    ['typed', []],
    ['reload', []],
    ['auto_bookmark', []],
    ['form_submit', []],
    ['link', ['forward_back']],
    ['link', ['from_address_bar']],
  ])('navegación del usuario (%s %j) → LEGITIMATE', (transitionType, transitionQualifiers) => {
    expect(redirect({ transitionType, transitionQualifiers }).verdict).toBe('LEGITIMATE')
  })

  it('mismo sitio → LEGITIMATE', () => {
    expect(redirect({ chain: ['https://anime.test/serie/2/'] }).verdict).toBe('LEGITIMATE')
  })

  it('el usuario pidió ese destino (clic en un anuncio a propósito) → LEGITIMATE', () => {
    expect(redirect({ intents: [plainClick('https://adnet.test/r')] }).verdict).toBe('LEGITIMATE')
  })

  it('formulario enviado → LEGITIMATE', () => {
    expect(redirect({ intents: [{ ...plainClick(), form: true }] }).verdict).toBe('LEGITIMATE')
  })

  it('intención desconocida o destino sensible → SUSPICIOUS', () => {
    expect(redirect({ intents: null }).verdict).toBe('SUSPICIOUS')
    expect(
      redirect({ chain: ['https://adnet.test/r', 'https://accounts.x.test/login'] }).verdict,
    ).toBe('SUSPICIOUS')
  })
})
