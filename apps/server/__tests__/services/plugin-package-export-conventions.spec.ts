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

  it('preserves whitespace-bearing filesystem export targets', () => {
    expect(
      applyPackageExportConventions(
        { name: '@oneworks/plugin-paths', plugin: {} },
        {
          exports: {
            './client': { default: './client/index.js ' },
            './server': { default: './server/index.mjs ' }
          }
        }
      )?.plugin
    ).toMatchObject({
      client: { entry: './client/index.js ', root: 'client' },
      server: { entry: './server/index.mjs ', roles: [] }
    })
  })

  it.runIf(process.platform !== 'win32')('does not infer POSIX path segments through literal backslashes', () => {
    expect(
      applyPackageExportConventions(
        { name: '@oneworks/plugin-paths', plugin: {} },
        { exports: { './client': { default: String.raw`./client\entry.js` } } }
      )?.plugin?.client
    ).toEqual({ entry: String.raw`./client\entry.js` })
  })
})
