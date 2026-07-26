import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  resolveDesktopPackageVersion,
  stampDesktopPackageVersion
} = require('../scripts/desktop-package-version.cjs') as typeof import('../scripts/desktop-package-version.cjs')

describe('desktop package version', () => {
  it('uses the requested release version instead of the workspace fallback', () => {
    expect(resolveDesktopPackageVersion({
      env: { ONEWORKS_DESKTOP_VERSION: '9.8.7-beta.1' },
      fallbackVersion: '9.8.7-beta.0'
    })).toBe('9.8.7-beta.1')
  })

  it('rejects invalid release versions', () => {
    expect(() =>
      resolveDesktopPackageVersion({
        env: { ONEWORKS_DESKTOP_VERSION: 'latest' },
        fallbackVersion: '9.8.7-beta.0'
      })
    ).toThrow('Invalid desktop app version: latest')
  })

  it('stamps the final release version into the packaged app manifest', async () => {
    const stagingDir = await mkdtemp(path.join(tmpdir(), 'oneworks-desktop-package-version-'))
    const manifestPath = path.join(stagingDir, 'package.json')
    await writeFile(
      manifestPath,
      JSON.stringify({
        name: '@oneworks/desktop',
        version: '9.8.7-beta.0'
      })
    )

    stampDesktopPackageVersion(stagingDir, '9.8.7-beta.1')

    await expect(readFile(manifestPath, 'utf8').then(JSON.parse)).resolves.toMatchObject({
      name: '@oneworks/desktop',
      version: '9.8.7-beta.1'
    })
  })
})
