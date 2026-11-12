import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearAuthorization,
  createAuthorization,
  hasTemporaryAuthorization,
} from './navigationAuthorization'

function installSessionStorageStub(): void {
  const data = new Map<string, unknown>()
  ;(globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      session: {
        get: async (key: string) => ({ [key]: data.get(key) }),
        set: async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) data.set(k, v)
        },
        remove: async (key: string) => {
          data.delete(key)
        },
      },
    },
  }
}

beforeEach(() => {
  installSessionStorageStub()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('navigationAuthorization', () => {
  it('sin autorización creada, no hay autorización para esa pestaña', async () => {
    expect(await hasTemporaryAuthorization(1, 'https://ejemplo.com/')).toBe(false)
  })

  it('tras crear la autorización, la misma pestaña queda autorizada para la URL aprobada', async () => {
    await createAuthorization(7, 'http://example.com/')

    expect(await hasTemporaryAuthorization(7, 'http://example.com/')).toBe(true)
  })

  it('no se consume en el primer uso: sigue activa para navegaciones posteriores dentro de la ventana', async () => {
    await createAuthorization(7, 'http://example.com/')

    expect(await hasTemporaryAuthorization(7, 'http://example.com/')).toBe(true)
    expect(await hasTemporaryAuthorization(7, 'http://example.com/')).toBe(true) // sigue vigente, no se borró
  })

  it('mientras está activa, tolera un redirect inmediato http→https en la misma pestaña', async () => {
    await createAuthorization(7, 'http://example.com/')

    expect(await hasTemporaryAuthorization(7, 'http://example.com/')).toBe(true)
    expect(await hasTemporaryAuthorization(7, 'https://example.com/')).toBe(true)
  })

  it('otra pestaña no hereda la autorización', async () => {
    await createAuthorization(1, 'http://example.com/')

    expect(await hasTemporaryAuthorization(2, 'http://example.com/')).toBe(false)
  })

  it('la autorización expira pasados ~15 segundos', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))

    await createAuthorization(7, 'http://example.com/')

    vi.setSystemTime(new Date('2026-01-01T00:00:16Z')) // +16s, por encima del TTL de 15s

    expect(await hasTemporaryAuthorization(7, 'http://example.com/')).toBe(false)
  })

  it('dentro del TTL sigue funcionando', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))

    await createAuthorization(7, 'http://example.com/')

    vi.setSystemTime(new Date('2026-01-01T00:00:10Z')) // +10s, dentro del TTL de 15s

    expect(await hasTemporaryAuthorization(7, 'http://example.com/')).toBe(true)
  })

  it('clearAuthorization desactiva la autorización de inmediato (simula onCompleted)', async () => {
    await createAuthorization(7, 'http://example.com/')
    expect(await hasTemporaryAuthorization(7, 'http://example.com/')).toBe(true)

    await clearAuthorization(7)

    expect(await hasTemporaryAuthorization(7, 'http://example.com/')).toBe(false)
  })

  it('una URL inválida no rompe la consulta', async () => {
    expect(await hasTemporaryAuthorization(7, 'no-es-una-url')).toBe(false)
  })
})
