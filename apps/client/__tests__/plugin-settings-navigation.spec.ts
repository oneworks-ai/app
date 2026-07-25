import { describe, expect, it } from 'vitest'

import { partitionPluginSettingsPages } from '#~/components/config/pluginSettingsNavigation'

describe('plugin settings navigation', () => {
  it('places external control contributions in the host-owned group without reordering them', () => {
    const pages = [
      { id: 'account' },
      { group: 'external-control', id: 'browser' },
      { group: 'external-control', id: 'device' }
    ]

    expect(partitionPluginSettingsPages(pages)).toEqual({
      defaultPages: [{ id: 'account' }],
      externalControlPages: [
        { group: 'external-control', id: 'browser' },
        { group: 'external-control', id: 'device' }
      ]
    })
  })

  it('keeps unrecognized groups in the default Settings location', () => {
    expect(partitionPluginSettingsPages([{ group: 'future-group', id: 'future' }])).toEqual({
      defaultPages: [{ group: 'future-group', id: 'future' }],
      externalControlPages: []
    })
  })
})
