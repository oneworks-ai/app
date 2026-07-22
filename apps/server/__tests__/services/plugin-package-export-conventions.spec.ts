import { describe, expect, it } from 'vitest'

import { applyPackageExportConventions } from '#~/services/plugins/package-export-conventions.js'

describe('plugin package export conventions', () => {
  it('uses package.json as the authoritative published package version', () => {
    expect(
      applyPackageExportConventions(
        {
          name: '@oneworks/plugin-theme',
          version: '0.1.0'
        },
        {
          name: '@oneworks/plugin-theme',
          version: '0.1.0-beta.7'
        }
      )?.version
    ).toBe('0.1.0-beta.7')
  })
})
