import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  findProductAppBundle,
  verifyExtractedAppBundle
} = require('../scripts/verify-macos-adhoc-artifacts.cjs') as {
  findProductAppBundle: (root: string) => string
  verifyExtractedAppBundle: (input: {
    appPath: string
    architecture: string
    runCommand: (command: string, args: string[]) => string
  }) => void
}

describe('macOS ad-hoc artifact verification', () => {
  it('finds one product app without confusing nested helper apps', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'oneworks-artifact-app-'))
    const appPath = path.join(root, 'Payload', 'Applications', 'One Works Dev.app')
    await mkdir(path.join(appPath, 'Contents', 'Frameworks', 'Helper.app'), { recursive: true })

    expect(findProductAppBundle(root)).toBe(appPath)
  })

  it('requires the requested single executable architecture after strict seal verification', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'oneworks-artifact-arch-'))
    const appPath = path.join(root, 'One Works Dev.app')
    await mkdir(path.join(appPath, 'Contents', 'MacOS'), { recursive: true })
    await writeFile(path.join(appPath, 'Contents', 'MacOS', 'One Works Dev'), 'fixture')
    const runCommand = (command: string, args: string[]) => {
      if (command === 'codesign' && args.includes('-d')) {
        return 'Signature=adhoc\nTeamIdentifier=not set\nSealed Resources=sealed\n'
      }
      if (command === 'lipo') return 'x86_64\n'
      return ''
    }

    expect(() =>
      verifyExtractedAppBundle({
        appPath,
        architecture: 'x64',
        runCommand
      })
    ).not.toThrow()
    expect(() =>
      verifyExtractedAppBundle({
        appPath,
        architecture: 'arm64',
        runCommand
      })
    ).toThrow('Expected arm64 executable')
  })
})
