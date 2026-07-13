import { describe, expect, it, vi } from 'vitest'

import { createPluginSettingsOptionsSaveController } from '#~/components/plugins/plugin-settings-options-save'

describe('plugin settings options save controller', () => {
  it('flushes the latest pending options when the settings page unmounts', async () => {
    vi.useFakeTimers()
    const persist = vi.fn(async options => options)
    const controller = createPluginSettingsOptionsSaveController({
      initialOptions: {},
      onError: vi.fn(),
      onSaved: vi.fn(),
      persist
    })

    controller.schedule({ enabled: true })
    await controller.dispose()

    expect(persist).toHaveBeenCalledOnce()
    expect(persist).toHaveBeenCalledWith({ enabled: true })
    vi.useRealTimers()
  })

  it('does not let a plugin refresh overwrite a dirty draft', async () => {
    vi.useFakeTimers()
    const onSaved = vi.fn()
    const controller = createPluginSettingsOptionsSaveController({
      initialOptions: { value: 'old' },
      onError: vi.fn(),
      onSaved,
      persist: async options => options
    })

    controller.schedule({ value: 'draft' })
    expect(controller.syncRemote({ value: 'old' })).toBe(false)
    await vi.advanceTimersByTimeAsync(700)
    expect(onSaved).toHaveBeenCalledWith({ value: 'draft' })
    expect(controller.syncRemote({ value: 'draft' })).toBe(true)
    vi.useRealTimers()
  })

  it('serializes saves so an older request cannot overwrite the latest edit', async () => {
    vi.useFakeTimers()
    const releases: Array<() => void> = []
    const persisted: string[] = []
    const controller = createPluginSettingsOptionsSaveController({
      delayMs: 1,
      initialOptions: {},
      onError: vi.fn(),
      onSaved: vi.fn(),
      persist: async (options) => {
        persisted.push(String(options.value))
        await new Promise<void>(resolve => releases.push(resolve))
        return options
      }
    })

    controller.schedule({ value: 'first' })
    await vi.advanceTimersByTimeAsync(1)
    controller.schedule({ value: 'second' })
    await vi.advanceTimersByTimeAsync(1)
    expect(persisted).toEqual(['first'])
    releases.shift()?.()
    await vi.waitFor(() => expect(persisted).toEqual(['first', 'second']))
    releases.shift()?.()
    await controller.flush()
    vi.useRealTimers()
  })
})
