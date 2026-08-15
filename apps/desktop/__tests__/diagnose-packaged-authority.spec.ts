import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

const requireModule = createRequire(import.meta.url)
const {
  PackagedAuthorityDiagnosticError,
  allowedPhases,
  diagnosePackagedAuthority,
  parseChildResult
} = requireModule('../scripts/diagnose-packaged-authority.cjs') as {
  PackagedAuthorityDiagnosticError: new(code: string, phase?: string) => Error & {
    code: string
    phase: string
  }
  allowedPhases: readonly string[]
  diagnosePackagedAuthority: (options: {
    arch: string
    env: NodeJS.ProcessEnv
    outputDir: string
    platform: string
    tempRoot?: string
    timeoutMs?: number
  }) => Promise<{ ok: true; phases: readonly string[] }>
  parseChildResult: (stdout: string) => { ok: true; phases: readonly string[] }
}

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

const createFakePackagedApp = async ({
  executableExitCode,
  executableSignal,
  failAtBrokerStart = false,
  failAtPublish = false,
  hangAtBrokerStart = false
}: {
  executableExitCode?: number
  executableSignal?: NodeJS.Signals
  failAtBrokerStart?: boolean
  failAtPublish?: boolean
  hangAtBrokerStart?: boolean
} = {}) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'oneworks-authority-diagnostic-test-'))
  tempDirs.push(root)
  const packageDir = path.join(root, 'out', 'One Works-darwin-arm64')
  const appBundle = path.join(packageDir, 'One Works.app')
  const executable = path.join(appBundle, 'Contents', 'MacOS', 'One Works')
  const authorityRoot = path.join(
    appBundle,
    'Contents',
    'Resources',
    'app',
    'node_modules',
    '.pnpm',
    'node_modules',
    '@oneworks',
    'fs-authority-native'
  )
  const executableSentinel = path.join(root, 'recovered-executable-launched')
  await mkdir(path.dirname(executable), { recursive: true })
  await mkdir(authorityRoot, { recursive: true })
  await writeFile(
    executable,
    [
      `#!${process.execPath}`,
      `'use strict'`,
      `const fs = require('node:fs')`,
      `const { spawnSync } = require('node:child_process')`,
      `fs.writeFileSync(${JSON.stringify(executableSentinel)}, 'launched')`,
      `const result = spawnSync(process.execPath, process.argv.slice(2), { stdio: 'inherit' })`,
      executableSignal == null
        ? `process.exit(${executableExitCode == null ? 'result.status ?? 1' : executableExitCode})`
        : `process.kill(process.pid, ${JSON.stringify(executableSignal)})`,
      ''
    ].join('\n')
  )
  await chmod(executable, 0o755)
  await writeFile(
    path.join(authorityRoot, 'testing.cjs'),
    hangAtBrokerStart
      ? `'use strict'\nmodule.exports = {\n  prepareFilesystemAuthorityTestControlRoot: override => ({ controlRoot: override, secret: 'fixture' }),\n  startFilesystemAuthorityBroker: async () => await new Promise(() => undefined)\n}\n`
      : failAtBrokerStart
      ? `'use strict'\nmodule.exports = {\n  prepareFilesystemAuthorityTestControlRoot: override => ({ controlRoot: override, secret: 'fixture' }),\n  startFilesystemAuthorityBroker: async () => {\n    process.stderr.write('diagnostic-private-path-sentinel secret-token\\n')\n    throw new Error('private broker failure')\n  }\n}\n`
      : `'use strict'\nconst fs = require('node:fs')\nconst path = require('node:path')\nmodule.exports = {\n  prepareFilesystemAuthorityTestControlRoot: override => ({ controlRoot: override, secret: 'fixture' }),\n  startFilesystemAuthorityBroker: async () => ({ close: async () => undefined }),\n  openFilesystemAuthorityForTest: async workspaceRoot => {\n    let generation = 0\n    return {\n      id: 'fixture-authority',\n      claim: async () => ++generation,\n      publish: async publication => {\n        ${
        failAtPublish ? "throw new Error('private publish failure')\n        " : ''
      }const target = path.join(workspaceRoot, ...publication.parentSegments, publication.basename)\n        fs.mkdirSync(path.dirname(target), { recursive: true })\n        fs.writeFileSync(target, publication.bytes)\n        return { state: 'committed' }\n      },\n      release: async requestedGeneration => requestedGeneration === generation,\n      close: () => undefined\n    }\n  }\n}\n`
  )
  return {
    executableSentinel,
    outputDir: path.join(root, 'out'),
    tempRoot: path.join(root, 'harness')
  }
}

describe('packaged authority recovery diagnostic', () => {
  it('uses the recovered executable and packaged implementation for the complete authority lifecycle', async () => {
    const fixture = await createFakePackagedApp()

    await expect(diagnosePackagedAuthority({
      arch: 'arm64',
      env: { ONEWORKS_DESKTOP_RELEASE_BUILD: 'true' },
      outputDir: fixture.outputDir,
      platform: 'darwin',
      tempRoot: fixture.tempRoot
    })).resolves.toEqual({ ok: true, phases: allowedPhases })

    await expect(readFile(fixture.executableSentinel, 'utf8')).resolves.toBe('launched')
    await expect(stat(fixture.tempRoot)).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('converts captured child stderr into an allowlisted phase code', async () => {
    const fixture = await createFakePackagedApp({ failAtBrokerStart: true })

    const error = await diagnosePackagedAuthority({
      arch: 'arm64',
      env: { ONEWORKS_DESKTOP_RELEASE_BUILD: 'true' },
      outputDir: fixture.outputDir,
      platform: 'darwin',
      tempRoot: fixture.tempRoot
    }).catch(reason => reason)

    expect(error).toBeInstanceOf(PackagedAuthorityDiagnosticError)
    expect(error).toMatchObject({ code: 'diagnostic_broker_start_failed', phase: 'broker_start' })
    expect(String(error)).not.toContain('diagnostic-private-path-sentinel')
    expect(String(error)).not.toContain('secret-token')
  })

  it('preserves an allowlisted later-phase failure reported with exit code 1', async () => {
    const fixture = await createFakePackagedApp({ failAtPublish: true })

    await expect(diagnosePackagedAuthority({
      arch: 'arm64',
      env: { ONEWORKS_DESKTOP_RELEASE_BUILD: 'true' },
      outputDir: fixture.outputDir,
      platform: 'darwin',
      tempRoot: fixture.tempRoot
    })).rejects.toMatchObject({ code: 'diagnostic_publish_failed', phase: 'publish' })
  })

  it('rejects valid success output when the recovered executable exits nonzero', async () => {
    const fixture = await createFakePackagedApp({ executableExitCode: 17 })

    await expect(diagnosePackagedAuthority({
      arch: 'arm64',
      env: { ONEWORKS_DESKTOP_RELEASE_BUILD: 'true' },
      outputDir: fixture.outputDir,
      platform: 'darwin',
      tempRoot: fixture.tempRoot
    })).rejects.toMatchObject({ code: 'diagnostic_launch_failed', phase: 'broker_start' })
  })

  it('rejects valid success output when the recovered executable terminates by signal', async () => {
    const fixture = await createFakePackagedApp({ executableSignal: 'SIGTERM' })

    await expect(diagnosePackagedAuthority({
      arch: 'arm64',
      env: { ONEWORKS_DESKTOP_RELEASE_BUILD: 'true' },
      outputDir: fixture.outputDir,
      platform: 'darwin',
      tempRoot: fixture.tempRoot
    })).rejects.toMatchObject({ code: 'diagnostic_launch_failed', phase: 'broker_start' })
  })

  it('kills and rejects a diagnostic that exceeds its bounded execution time', async () => {
    const fixture = await createFakePackagedApp({ hangAtBrokerStart: true })

    await expect(diagnosePackagedAuthority({
      arch: 'arm64',
      env: { ONEWORKS_DESKTOP_RELEASE_BUILD: 'true' },
      outputDir: fixture.outputDir,
      platform: 'darwin',
      tempRoot: fixture.tempRoot,
      timeoutMs: 50
    })).rejects.toMatchObject({ code: 'diagnostic_timeout', phase: 'broker_start' })
  })

  it('rejects child output containing non-allowlisted phases or errors', () => {
    expect(() => parseChildResult(JSON.stringify({ ok: true, phases: ['private-path'] })))
      .toThrow('diagnostic_output_invalid')
    expect(() =>
      parseChildResult(JSON.stringify({
        errorCode: 'diagnostic-private-path-sentinel',
        ok: false,
        phase: 'broker_start'
      }))
    ).toThrow('diagnostic_output_invalid')
  })
})
