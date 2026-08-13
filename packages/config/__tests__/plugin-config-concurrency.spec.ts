/* eslint-disable import/first -- Vitest mocks must be installed before importing the config hook module. */
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveConfiguredPluginInstances: vi.fn()
}))

vi.mock('@oneworks/utils/plugin-resolver', () => ({
  flattenPluginInstances: (instances: unknown[]) => instances,
  mergeDefaultOfficialPluginConfigs: () => [{ id: 'first' }, { id: 'second' }],
  mergePluginConfigs: () => [],
  resolveConfiguredPluginInstances: mocks.resolveConfiguredPluginInstances,
  resolvePluginConfigEntryPathForInstance: () => undefined
}))

import { applyPluginConfigHooks } from '#~/plugin-config.js'

describe('plugin config hook resolution', () => {
  it('starts independent plugin resolution concurrently while preserving the later ordered fold', async () => {
    let releaseFirst: (() => void) | undefined
    mocks.resolveConfiguredPluginInstances.mockImplementation(({ plugins }) => {
      const pluginId = plugins[0]?.id
      if (pluginId === 'first') {
        return new Promise(resolve => {
          releaseFirst = () => resolve([])
        })
      }
      return Promise.resolve([])
    })

    const resultPromise = applyPluginConfigHooks({
      cwd: process.cwd(),
      includeDefaultOfficialPlugins: true
    })

    await vi.waitFor(() => {
      expect(mocks.resolveConfiguredPluginInstances).toHaveBeenCalledTimes(2)
    })
    releaseFirst?.()

    await expect(resultPromise).resolves.toEqual([undefined, undefined])
  })
})
