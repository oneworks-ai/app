import { describe, expect, it } from 'vitest'

import { getAdapterImporterConfigFingerprint } from '#~/components/config/adapterImporterCache'

describe('adapter importer cache fingerprint', () => {
  it('changes when adapter instances or the default adapter change', () => {
    const initial = getAdapterImporterConfigFingerprint({
      mergedConfig: {
        adapters: { codex: { packageId: '@oneworks/adapter-codex' } },
        general: { defaultAdapter: 'codex' }
      }
    })
    const changedPackage = getAdapterImporterConfigFingerprint({
      mergedConfig: {
        adapters: { codex: { packageId: '@acme/adapter-codex' } },
        general: { defaultAdapter: 'codex' }
      }
    })
    const changedDefault = getAdapterImporterConfigFingerprint({
      mergedConfig: {
        adapters: { codex: { packageId: '@oneworks/adapter-codex' } },
        general: { defaultAdapter: 'custom-codex' }
      }
    })

    expect(changedPackage).not.toBe(initial)
    expect(changedDefault).not.toBe(initial)
  })

  it('tracks plugin adapter availability without depending on snapshot order', () => {
    const left = getAdapterImporterConfigFingerprint({
      pluginInstances: [
        { requestId: 'b', scope: 'plugin-b', version: '2' },
        { requestId: 'a', scope: 'plugin-a', version: '1' }
      ]
    })
    const right = getAdapterImporterConfigFingerprint({
      pluginInstances: [
        { requestId: 'a', scope: 'plugin-a', version: '1' },
        { requestId: 'b', scope: 'plugin-b', version: '2' }
      ]
    })

    expect(right).toBe(left)
    expect(getAdapterImporterConfigFingerprint({
      pluginInstances: [{ requestId: 'a', scope: 'plugin-a', version: '2' }]
    })).not.toBe(left)
  })
})
