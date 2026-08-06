import { chmod, copyFile, mkdir, mkdtemp, readlink, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  findPrepackagedAppBundles,
  normalizeAppBundleSymlinks,
  resolveInstalledAppPath,
  sealAdHocAppBundle,
  verifyAdHocAppBundle,
  verifyQuarantinedAdHocBoundary
} = require('../scripts/mac-adhoc-seal.cjs') as {
  findPrepackagedAppBundles: (outputDir: string) => string[]
  normalizeAppBundleSymlinks: (appPath: string) => string[]
  sealAdHocAppBundle: (input: { appPath: string }) => string
  verifyAdHocAppBundle: (input: {
    appPath: string
    runCommand?: (command: string, args: string[]) => string
  }) => string
  verifyQuarantinedAdHocBoundary: (input: {
    assessCommand?: (command: string, args: string[]) => {
      error?: Error
      status: number | null
      stderr?: string
      stdout?: string
    }
    appPath: string
    runCommand?: (command: string, args: string[]) => string
    verifyBundle?: (input: {
      appPath: string
      runCommand: (command: string, args: string[]) => string
    }) => string
  }) => { assessmentStatus: number | null; assessmentText: string }
}

const createFixtureApp = async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'oneworks-adhoc-seal-'))
  const appPath = path.join(root, 'One Works.app')
  const executablePath = path.join(appPath, 'Contents', 'MacOS', 'One Works')
  await mkdir(path.dirname(executablePath), { recursive: true })
  await mkdir(path.join(appPath, 'Contents', 'Resources'), { recursive: true })
  await copyFile('/usr/bin/true', executablePath)
  await chmod(executablePath, 0o755)
  await writeFile(
    path.join(appPath, 'Contents', 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>One Works</string>
<key>CFBundleIdentifier</key><string>ai.oneworks.adhoc-fixture</string>
<key>CFBundleName</key><string>One Works</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>
`
  )
  await writeFile(path.join(appPath, 'Contents', 'Resources', 'fixture.txt'), 'sealed resource\n')
  return { appPath, root }
}

describe('macOS ad-hoc sealing', () => {
  it('resolves the installed app path from the active desktop identity', () => {
    expect(resolveInstalledAppPath({
      applicationsRoot: '/tmp/Applications',
      metadataResolver: () => ({ productName: 'One Works Dev' })
    })).toBe('/tmp/Applications/One Works Dev.app')
  })

  it.runIf(process.platform === 'darwin')(
    'creates a complete bundle seal accepted by strict codesign verification',
    async () => {
      const { appPath } = await createFixtureApp()

      const details = sealAdHocAppBundle({ appPath })

      expect(details).toContain('Signature=adhoc')
      expect(details).not.toContain('Info.plist=not bound')
      expect(details).not.toContain('Sealed Resources=none')
      expect(() => verifyAdHocAppBundle({ appPath })).not.toThrow()
    }
  )

  it('rejects the incomplete linker-only signature shipped in the original stable bundle', async () => {
    const { appPath } = await createFixtureApp()
    const runCommand = (_command: string, args: string[]) =>
      args.includes('--verify')
        ? ''
        : 'Signature=adhoc\nTeamIdentifier=not set\nInfo.plist=not bound\nSealed Resources=none\n'

    expect(() => verifyAdHocAppBundle({ appPath, runCommand })).toThrow(
      'only linker-signed'
    )
  })

  it('keeps quarantine verification behind the strict resource-seal check', () => {
    const commands: string[] = []
    const runCommand = (command: string, args: string[]) => {
      commands.push(`${command} ${args.join(' ')}`)
      if (command === 'xattr' && args[0] === '-p') return '0081;fixture;OneWorks CI;'
      if (command === 'codesign' && args.includes('-d')) {
        return 'Signature=adhoc\nTeamIdentifier=not set\nInfo.plist=not bound\nSealed Resources=none\n'
      }
      return ''
    }

    expect(() =>
      verifyQuarantinedAdHocBoundary({
        appPath: '/Applications/One Works.app',
        runCommand,
        verifyBundle: () => {
          throw new Error('only linker-signed')
        }
      })
    ).toThrow('only linker-signed')
    expect(commands.some(command => command.startsWith('xattr -p'))).toBe(true)
  })

  it.each([
    { assessment: { status: 0, stderr: '', stdout: '' }, expectedError: undefined },
    {
      assessment: { status: 3, stderr: '/tmp/One Works.app: rejected\n', stdout: '' },
      expectedError: undefined
    },
    {
      assessment: {
        status: 3,
        stderr: 'code has no resources but signature indicates they must be present\n',
        stdout: ''
      },
      expectedError: 'classified the ad-hoc app as malformed'
    },
    {
      assessment: { status: 2, stderr: 'assessment service unavailable\n', stdout: '' },
      expectedError: 'failed unexpectedly'
    },
    {
      assessment: { status: null, stderr: '', stdout: '' },
      expectedError: 'failed unexpectedly'
    }
  ])('classifies Gatekeeper result $assessment.status fail-closed', ({ assessment, expectedError }) => {
    const runCommand = (command: string, args: string[]) =>
      command === 'xattr' && args[0] === '-p' ? '0081;fixture;OneWorks CI;' : ''
    const invoke = () =>
      verifyQuarantinedAdHocBoundary({
        appPath: '/Applications/One Works.app',
        assessCommand: () => assessment,
        runCommand,
        verifyBundle: () => 'Signature=adhoc\n'
      })

    if (expectedError == null) {
      expect(invoke).not.toThrow()
    } else {
      expect(invoke).toThrow(expectedError)
    }
  })

  it('discovers only top-level app bundles in packaged architecture directories', async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), 'oneworks-adhoc-output-'))
    const appPath = path.join(outputDir, 'One Works-darwin-arm64', 'One Works.app')
    await mkdir(appPath, { recursive: true })
    await mkdir(path.join(outputDir, 'unrelated', 'nested', 'Ignored.app'), { recursive: true })

    expect(findPrepackagedAppBundles(outputDir)).toEqual([appPath])
  })

  it('rebases workspace-absolute documentation links onto their packaged sibling', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'oneworks-adhoc-links-'))
    const packageDir = path.join(root, 'One Works.app', 'Contents', 'Resources', 'app', 'src')
    const agentsPath = path.join(packageDir, 'AGENTS.md')
    const claudePath = path.join(packageDir, 'CLAUDE.md')
    await mkdir(packageDir, { recursive: true })
    await writeFile(agentsPath, 'packaged instructions\n')
    await symlink('/Users/runner/work/app/app/apps/server/src/AGENTS.md', claudePath)

    expect(normalizeAppBundleSymlinks(path.join(root, 'One Works.app'))).toEqual([claudePath])
    expect(await readlink(claudePath)).toBe('AGENTS.md')
  })
})
