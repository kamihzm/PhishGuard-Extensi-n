import { describe, expect, it } from 'vitest'
import { extractFeatures } from './extractFeatures'
import urlFixtures from '../test/fixtures/urls.json'

describe('extractFeatures (casos de fixtures)', () => {
  for (const fixture of urlFixtures) {
    it(fixture.description, () => {
      expect(extractFeatures(fixture.url)).toMatchObject(fixture.expected)
    })
  }
})

describe('extractFeatures (casos límite adicionales)', () => {
  it('cuenta subdominios encadenados', () => {
    const features = extractFeatures('https://mail.login.banco.example.com/')
    // etiquetas: mail, login, banco, example, com -> 5 - 2 = 3
    expect(features.subdomainCount).toBe(3)
  })

  it('no cuenta subdominios en un dominio de segundo nivel simple', () => {
    const features = extractFeatures('https://example.com/')
    expect(features.subdomainCount).toBe(0)
  })

  it('detecta múltiples palabras sensibles sin distinguir mayúsculas', () => {
    const features = extractFeatures('https://example.com/LOGIN/Verificar/Token')
    expect(features.sensitiveWordCount).toBe(3)
  })

  it('la entropía del dominio es un número finito no negativo', () => {
    const features = extractFeatures('https://kx7fq2z9wq.example.com/')
    expect(features.domainEntropy).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(features.domainEntropy)).toBe(true)
  })
})

describe('extractFeatures (hasAtSymbol = userinfo real, no "@" en cualquier parte)', () => {
  it.each([
    'http://google.com@evil.com/',
    'http://usuario@evil.com/',
    'http://usuario:password@evil.com/',
    'http://accounts.google.com@evil-login.top/',
    'http://paypal.com@evil.example/',
  ])('SÍ activa con userinfo en la autoridad: %s', (url) => {
    expect(extractFeatures(url).hasAtSymbol).toBe(true)
  })

  it.each([
    'https://www.youtube.com/@MegaSawaya',
    'https://www.youtube.com/@GoogleDevelopers/videos',
    'https://www.youtube.com/results?search_query=@usuario',
    'https://example.com/path/@usuario',
    'https://example.com/search?q=@usuario',
    'https://example.com/#@usuario',
  ])('NO activa con "@" fuera de la autoridad (pathname/query/hash): %s', (url) => {
    expect(extractFeatures(url).hasAtSymbol).toBe(false)
  })
})

describe('extractFeatures (sufijos compuestos colombianos, ej. .com.co)', () => {
  it.each(['com.co', 'net.co', 'org.co', 'edu.co', 'gov.co', 'mil.co', 'nom.co'])(
    'no cuenta el sufijo .%s como subdominio',
    (suffix) => {
      const features = extractFeatures(`https://ejemplo.${suffix}/`)
      expect(features.subdomainCount).toBe(0)
    },
  )

  it('cuenta solo "www" como subdominio en un dominio .com.co con www', () => {
    const features = extractFeatures('https://www.banco.com.co/login')
    expect(features.subdomainCount).toBe(1)
  })

  it('cuenta correctamente el "subdomain padding": marca colombiana usada como subdominio de otro dominio', () => {
    // bancolombia.com.co no es el dominio real; el dominio real es evil-site.top.
    const features = extractFeatures('http://bancolombia.com.co.evil-site.top/login')
    expect(features.subdomainCount).toBe(3)
  })
})

describe('extractFeatures (palabras sensibles por contexto — Fase 4/15 del fortalecimiento del núcleo)', () => {
  it('una palabra sensible en el PATH de un sitio legítimo no cuenta como sensibleWordsInHost', () => {
    const features = extractFeatures('https://www.minecraft.net/es-es/login')
    expect(features.sensitiveWordsInHost).toBe(0)
    expect(features.sensitiveWordsInPath).toBe(1)
    expect(features.sensitiveWordsInQuery).toBe(0)
  })

  it('una palabra sensible en el HOSTNAME de un dominio ajeno sí cuenta como sensitiveWordsInHost', () => {
    const features = extractFeatures('https://google-secure-login-example.invalid/')
    expect(features.sensitiveWordsInHost).toBeGreaterThanOrEqual(1)
    expect(features.sensitiveWordsInPath).toBe(0)
  })

  it('una palabra sensible en el QUERY cuenta solo como sensitiveWordsInQuery', () => {
    const features = extractFeatures('https://example.com/search?redirect=login')
    expect(features.sensitiveWordsInHost).toBe(0)
    expect(features.sensitiveWordsInPath).toBe(0)
    expect(features.sensitiveWordsInQuery).toBe(1)
  })

  it('sensitiveWordCount (agregado, usado por la regla) sigue sumando las tres posiciones', () => {
    const features = extractFeatures('https://accounts.google.com/login')
    expect(features.sensitiveWordCount).toBe(
      features.sensitiveWordsInHost +
        features.sensitiveWordsInPath +
        features.sensitiveWordsInQuery,
    )
  })

  it('caso legítimo real: minecraft.net/login no debe distinguirse artificialmente de un caso sospechoso solo por la palabra "login"', () => {
    const legit = extractFeatures('https://www.minecraft.net/es-es/login')
    const suspicious = extractFeatures('https://google-secure-login-example.invalid/')
    // Ambos tienen "login" en algún lado, pero en posiciones distintas: el
    // legítimo la tiene en el path, el sospechoso en el propio hostname.
    expect(legit.sensitiveWordsInHost).toBe(0)
    expect(suspicious.sensitiveWordsInHost).toBeGreaterThan(0)
  })
})

describe('extractFeatures (hostnameDigitCount)', () => {
  it('un hostname sin dígitos da 0', () => {
    expect(extractFeatures('https://www.bancolombia.com/personas').hostnameDigitCount).toBe(0)
  })

  it('cuenta los dígitos del hostname, no del resto de la URL', () => {
    const features = extractFeatures('https://paypal123-secure.invalid/login/2024/verify')
    expect(features.hostnameDigitCount).toBe(3) // "123" en el host; los dígitos del path NO cuentan
  })

  it('un host puramente numérico (IP) no se cuenta acá (isIpHost ya lo cubre por separado)', () => {
    // No hay aserción especial: el conteo de dígitos de una IP simplemente
    // es alto, y `isIpHost` es la señal dedicada — se documenta el
    // comportamiento con un caso concreto.
    const features = extractFeatures('http://192.168.1.50/login')
    expect(features.hostnameDigitCount).toBeGreaterThan(0)
    expect(features.isIpHost).toBe(true)
  })
})

describe('extractFeatures (puerto explícito, vía urlParts — no afecta ninguna feature todavía)', () => {
  it('una URL con puerto explícito se sigue analizando sin romper', () => {
    expect(() => extractFeatures('https://example.com:8443/path')).not.toThrow()
  })
})

describe('extractFeatures (specialCharRatioInHostname — FeatureSet v2)', () => {
  it('un hostname sin caracteres especiales (solo letras) da 0', () => {
    expect(extractFeatures('https://example/').specialCharRatioInHostname).toBe(0)
  })

  it('más puntos (más subdominios) relativo a la longitud sube la proporción', () => {
    const few = extractFeatures(
      'https://verylongsubdomainname.example.com/',
    ).specialCharRatioInHostname
    const many = extractFeatures('https://a.b.c.d.example.com/').specialCharRatioInHostname
    expect(many).toBeGreaterThan(few)
  })

  it('un guion NO cuenta como carácter especial (ya lo mide hyphenCount por separado)', () => {
    const withHyphen = extractFeatures('https://banco-agrario.com.co/')
    const withoutHyphen = extractFeatures('https://bancoagrario.com.co/')
    // Mismo largo aproximado, el guion no debería inflar la proporción como lo haría un punto.
    expect(withHyphen.specialCharRatioInHostname).toBeLessThan(
      withoutHyphen.specialCharRatioInHostname + 0.05,
    )
  })
})

describe('extractFeatures (pathDepth — FeatureSet v2)', () => {
  it('sin path (o solo "/"), pathDepth es 0', () => {
    expect(extractFeatures('https://example.com/').pathDepth).toBe(0)
    expect(extractFeatures('https://example.com').pathDepth).toBe(0)
  })

  it('cuenta los segmentos no vacíos del path', () => {
    expect(extractFeatures('https://example.com/a/b/c').pathDepth).toBe(3)
  })

  it('una barra final no cuenta como un segmento extra', () => {
    expect(extractFeatures('https://example.com/a/b/').pathDepth).toBe(2)
  })

  it('un checkout anidado real (ecommerce) tiene pathDepth mayor que la home', () => {
    const home = extractFeatures('https://www.mercadolibre.com.co/').pathDepth
    const checkout = extractFeatures('https://www.mercadolibre.com.co/gz/checkout/start').pathDepth
    expect(checkout).toBeGreaterThan(home)
  })
})

describe('extractFeatures (query params de tracking — Objetivo 1, ver docs/tracking-parameter-analysis.md)', () => {
  it('URL legítima con UTM (Google Ads) — detecta 2 params de tracking, sin click id', () => {
    const features = extractFeatures('https://example.com/product?utm_source=google&utm_medium=cpc')
    expect(features.queryParamCount).toBe(2)
    expect(features.trackingParamCount).toBe(2)
    expect(features.hasClickTrackingId).toBe(false)
    expect(features.trackingParamRatio).toBe(1)
  })

  it('URL legítima con gclid (click id de Google Ads)', () => {
    const features = extractFeatures('https://example.com/?gclid=abc123')
    expect(features.trackingParamCount).toBe(1)
    expect(features.hasClickTrackingId).toBe(true)
  })

  it('YouTube con parámetro de video + UTM: el tracking se detecta sin afectar el resto del FeatureSet', () => {
    const features = extractFeatures('https://youtube.com/watch?v=test&utm_source=test')
    expect(features.queryParamCount).toBe(2)
    expect(features.trackingParamCount).toBe(1) // solo utm_source; "v" no es un param de tracking conocido
    expect(features.sensitiveWordCount).toBe(0)
    expect(features.hasSuspiciousTld).toBe(false)
  })

  it('caso real (win.juga-bet.co, destino de una redirección publicitaria desde jkanime.net): detecta voluum+UTM sin marcar phishing por sí solo', () => {
    const features = extractFeatures(
      'https://win.juga-bet.co/casino/jokers-jewels/?voluum_clickid=test&voluum_campaignid=test&voluum_offerid=test&utm_campaign=&utm_source=mrbooster&utm_medium=mrbooster',
    )
    expect(features.trackingParamCount).toBe(6)
    expect(features.hasClickTrackingId).toBe(true)
    // El tracking se detecta como CONTEXTO, pero ninguna regla ni el vector de
    // ML (FEATURE_ORDER) leen estos campos todavía — ver types.ts.
    expect(features.hasSuspiciousTld).toBe(false)
    expect(features.hasPunycode).toBe(false)
    expect(features.isIpHost).toBe(false)
  })

  it('una URL sin query string da queryParamCount 0, no undefined/NaN', () => {
    const features = extractFeatures('https://example.com/')
    expect(features.queryParamCount).toBe(0)
    expect(features.trackingParamCount).toBe(0)
    expect(features.trackingParamRatio).toBe(0)
  })
})

describe('extractFeatures (sensitiveWordCategories — audit Seguridad-master, Fase 3/4)', () => {
  it('"login" categoriza como auth', () => {
    expect(extractFeatures('https://example.com/login').sensitiveWordCategories).toEqual(['auth'])
  })

  it('"banco" categoriza como banking', () => {
    expect(extractFeatures('https://example.com/banco').sensitiveWordCategories).toEqual([
      'banking',
    ])
  })

  it('login + banco da ambas categorías, sin duplicados', () => {
    const categories = extractFeatures('https://banco-verificar-login.top/').sensitiveWordCategories
    expect(categories).toContain('auth')
    expect(categories).toContain('banking')
    expect(categories).toHaveLength(2)
  })

  it('sin palabras sensibles, categorías vacías', () => {
    expect(extractFeatures('https://example.com/').sensitiveWordCategories).toEqual([])
  })
})

describe('extractFeatures (domainSimilarityTechnique — explica CÓMO se parece, Fase 10)', () => {
  it('null cuando no hay impersonation', () => {
    expect(extractFeatures('https://example.com/').domainSimilarityTechnique).toBeNull()
  })

  it('"visual-substitution" para un lookalike por caracteres visuales (rn->m)', () => {
    expect(extractFeatures('https://rnicrosoft.com/').domainSimilarityTechnique).toBe(
      'visual-substitution',
    )
  })

  it('"edit-distance" para un lookalike por diferencia de caracteres tal cual escrita', () => {
    expect(extractFeatures('https://microsfot.com/').domainSimilarityTechnique).toBe(
      'edit-distance',
    )
  })
})

describe('extractFeatures (URLs financieras/ecommerce legítimas reales — regresión)', () => {
  it.each([
    'https://www.nequi.com.co/',
    'https://www.pse.com.co/persona',
    'https://checkout.wompi.co/l/VPOS_hZ4X29pQwT',
    'https://www.mercadolibre.com.co/gz/checkout/start?pref_id=123456789',
    'https://accounts.google.com/signin/v2/identifier',
  ])('%s se extrae sin errores y con isHttps=true', (url) => {
    const features = extractFeatures(url)
    expect(features.isHttps).toBe(true)
    expect(Number.isFinite(features.domainEntropy)).toBe(true)
  })
})
