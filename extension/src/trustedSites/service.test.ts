import { beforeEach, describe, expect, it } from 'vitest'
import {
  addTrustedSite,
  clearTrustedSites,
  getTrustedSites,
  isTrustedHostname,
  isTrustedUrl,
  removeTrustedSite,
} from './service'

function installLocalStorageStub(): void {
  const data = new Map<string, unknown>()
  ;(globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: data.get(key) }),
        set: async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) data.set(k, v)
        },
      },
    },
  }
}

beforeEach(() => {
  installLocalStorageStub()
})

describe('trustedSites/service', () => {
  it('1) agregar un hostname lo deja disponible en la lista', async () => {
    await addTrustedSite('https://example.com/')

    const sites = await getTrustedSites()
    expect(sites).toHaveLength(1)
    expect(sites[0]!.hostname).toBe('example.com')
    expect(sites[0]!.addedAt).toBeTruthy()
  })

  it('2) agregar el mismo hostname dos veces no crea un duplicado', async () => {
    await addTrustedSite('https://example.com/login')
    await addTrustedSite('https://example.com/otra-pagina')

    expect(await getTrustedSites()).toHaveLength(1)
  })

  it('agregar la misma URL con mayúsculas distintas tampoco duplica (normalización)', async () => {
    await addTrustedSite('https://Example.com/')
    await addTrustedSite('https://EXAMPLE.COM/')

    expect(await getTrustedSites()).toHaveLength(1)
  })

  it('3) eliminar un hostname lo saca de la lista', async () => {
    await addTrustedSite('https://a.com/')
    await addTrustedSite('https://b.com/')

    await removeTrustedSite('a.com')

    const sites = await getTrustedSites()
    expect(sites).toHaveLength(1)
    expect(sites[0]!.hostname).toBe('b.com')
  })

  it('4) eliminar todos deja la lista vacía', async () => {
    await addTrustedSite('https://a.com/')
    await addTrustedSite('https://b.com/')

    await clearTrustedSites()

    expect(await getTrustedSites()).toEqual([])
  })

  it('8) coincidencia exacta: el hostname agregado se reconoce como confiable', async () => {
    await addTrustedSite('https://example.com/')

    expect(await isTrustedHostname('example.com')).toBe(true)
  })

  it('9) confiar en un subdominio NO habilita el dominio padre ni otro subdominio distinto', async () => {
    await addTrustedSite('https://accounts.example.com/')

    expect(await isTrustedHostname('accounts.example.com')).toBe(true)
    expect(await isTrustedHostname('example.com')).toBe(false)
    expect(await isTrustedHostname('evil.example.com')).toBe(false)
  })

  it('confiar en el dominio padre tampoco habilita un subdominio', async () => {
    await addTrustedSite('https://example.com/')

    expect(await isTrustedHostname('example.com')).toBe(true)
    expect(await isTrustedHostname('accounts.example.com')).toBe(false)
  })

  it('isTrustedUrl acepta una URL completa y consulta por su hostname', async () => {
    await addTrustedSite('https://example.com/')

    expect(await isTrustedUrl('https://example.com/cualquier/ruta?x=1')).toBe(true)
    expect(await isTrustedUrl('https://otro-sitio.com/')).toBe(false)
  })

  it('isTrustedUrl con una URL inválida no rompe, simplemente no es confiable', async () => {
    expect(await isTrustedUrl('no-es-una-url')).toBe(false)
  })

  it('addTrustedSite rechaza esquemas no permitidos (chrome://, etc.)', async () => {
    await expect(addTrustedSite('chrome://settings')).rejects.toThrow()
    expect(await getTrustedSites()).toEqual([])
  })
})
