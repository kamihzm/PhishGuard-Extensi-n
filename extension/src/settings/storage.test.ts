import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from './defaults'
import { readSettings, SETTINGS_STORAGE_KEY, writeSettings } from './storage'

function installLocalStorageStub(initial?: Record<string, unknown>): void {
  const data = new Map<string, unknown>(Object.entries(initial ?? {}))
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

describe('settings/storage', () => {
  it('sin nada guardado, devuelve los valores por defecto', async () => {
    expect(await readSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('persiste y relee la configuración correctamente', async () => {
    const custom = {
      ...DEFAULT_SETTINGS,
      phishingProtectionEnabled: false,
      showBadgeEnabled: false,
    }
    await writeSettings(custom)

    expect(await readSettings()).toEqual(custom)
  })

  it('datos corruptos (no un objeto) devuelven los defaults en vez de romper', async () => {
    installLocalStorageStub({ 'phishguard:settings': 'no es un objeto' })

    expect(await readSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('un campo con tipo inválido cae a su default individualmente, sin descartar el resto', async () => {
    installLocalStorageStub({
      'phishguard:settings': {
        phishingProtectionEnabled: false,
        highRiskWarningEnabled: 'si', // tipo inválido
        saveHistoryEnabled: true,
        // showBadgeEnabled ausente
      },
    })

    expect(await readSettings()).toEqual({
      ...DEFAULT_SETTINGS,
      phishingProtectionEnabled: false,
      highRiskWarningEnabled: DEFAULT_SETTINGS.highRiskWarningEnabled,
      saveHistoryEnabled: true,
      showBadgeEnabled: DEFAULT_SETTINGS.showBadgeEnabled,
    })
  })

  it('"Modo avanzado" con un valor inválido cae a su default (apagado)', async () => {
    await chrome.storage.local.set({
      [SETTINGS_STORAGE_KEY]: { advancedModeEnabled: 'sí', showBadgeEnabled: false },
    })
    const settings = await readSettings()
    expect(settings.advancedModeEnabled).toBe(false)
    expect(settings.showBadgeEnabled).toBe(false)
  })
})
