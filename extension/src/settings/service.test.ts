import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from './defaults'
import { getSettings, resetSettings, updateSetting } from './service'

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

describe('settings/service', () => {
  it('getSettings sin nada guardado devuelve los defaults', async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('updateSetting cambia solo la clave indicada y conserva el resto', async () => {
    const result = await updateSetting('phishingProtectionEnabled', false)

    expect(result).toEqual({ ...DEFAULT_SETTINGS, phishingProtectionEnabled: false })
    expect(await getSettings()).toEqual({ ...DEFAULT_SETTINGS, phishingProtectionEnabled: false })
  })

  it('varios updateSetting sucesivos se acumulan', async () => {
    await updateSetting('phishingProtectionEnabled', false)
    await updateSetting('showBadgeEnabled', false)

    expect(await getSettings()).toEqual({
      ...DEFAULT_SETTINGS,
      phishingProtectionEnabled: false,
      showBadgeEnabled: false,
    })
  })

  it('resetSettings restaura los defaults', async () => {
    await updateSetting('phishingProtectionEnabled', false)
    await updateSetting('highRiskWarningEnabled', false)

    const result = await resetSettings()

    expect(result).toEqual(DEFAULT_SETTINGS)
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('"Modo avanzado" está apagado por defecto y se guarda como los demás ajustes', async () => {
    expect((await getSettings()).advancedModeEnabled).toBe(false)
    await updateSetting('advancedModeEnabled', true)
    expect((await getSettings()).advancedModeEnabled).toBe(true)
    expect((await getSettings()).phishingProtectionEnabled).toBe(true)
  })
})
