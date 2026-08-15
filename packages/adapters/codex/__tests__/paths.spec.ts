import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  resolveCodexBinaryPath,
  resolveCodexSystemBinaryPaths,
  resolveOfficialCodexNativeBinaryPath
} from '#~/paths.js'

const tempDirs: string[] = []

const createOfficialCodexInstall = async (params: {
  arch: 'arm64' | 'x64'
  createNative?: boolean
  platform: 'darwin' | 'linux' | 'win32'
  symlinkLauncher?: boolean
}) => {
  const target = {
    'darwin-arm64': ['@openai/codex-darwin-arm64', 'aarch64-apple-darwin'],
    'darwin-x64': ['@openai/codex-darwin-x64', 'x86_64-apple-darwin'],
    'linux-arm64': ['@openai/codex-linux-arm64', 'aarch64-unknown-linux-musl'],
    'linux-x64': ['@openai/codex-linux-x64', 'x86_64-unknown-linux-musl'],
    'win32-arm64': ['@openai/codex-win32-arm64', 'aarch64-pc-windows-msvc'],
    'win32-x64': ['@openai/codex-win32-x64', 'x86_64-pc-windows-msvc']
  }[`${params.platform}-${params.arch}`] as [string, string]
  const [packageName, targetTriple] = target
  const installDir = await mkdtemp(join(tmpdir(), 'oneworks-codex-native-cli-'))
  const launcherPath = join(installDir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js')
  const exposedBinaryPath = join(
    installDir,
    'node_modules',
    '.bin',
    params.platform === 'win32' ? 'codex.cmd' : 'codex'
  )
  const platformPackageDir = join(installDir, 'node_modules', ...packageName.split('/'))
  const nativeBinaryPath = join(
    platformPackageDir,
    'vendor',
    targetTriple,
    'bin',
    params.platform === 'win32' ? 'codex.exe' : 'codex'
  )
  tempDirs.push(installDir)
  await mkdir(dirname(launcherPath), { recursive: true })
  await mkdir(dirname(exposedBinaryPath), { recursive: true })
  await mkdir(dirname(nativeBinaryPath), { recursive: true })
  await writeFile(
    join(installDir, 'node_modules', '@openai', 'codex', 'package.json'),
    '{"name":"@openai/codex","version":"1.0.0","type":"module"}'
  )
  await writeFile(launcherPath, '#!/usr/bin/env node\n')
  await writeFile(
    join(platformPackageDir, 'package.json'),
    JSON.stringify({ name: packageName, version: '1.0.0' })
  )
  if (params.createNative !== false) {
    await writeFile(nativeBinaryPath, '')
    await chmod(nativeBinaryPath, 0o755)
  }
  if (params.symlinkLauncher === true) {
    await symlink(relative(dirname(exposedBinaryPath), launcherPath), exposedBinaryPath)
  } else {
    await writeFile(exposedBinaryPath, params.platform === 'win32' ? '@echo off\r\n' : '#!/bin/sh\n')
  }

  return {
    exposedBinaryPath,
    nativeBinaryPath
  }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('resolveCodexBinaryPath', () => {
  it('uses the official npm package native executable without requiring node on PATH', async () => {
    const install = await createOfficialCodexInstall({
      arch: 'arm64',
      platform: 'darwin',
      symlinkLauncher: true
    })

    expect(resolveOfficialCodexNativeBinaryPath(install.exposedBinaryPath, {
      arch: 'arm64',
      platform: 'darwin'
    })).toBe(await realpath(install.nativeBinaryPath))
  })

  it('resolves a Windows command shim through the official lexical package layout', async () => {
    const install = await createOfficialCodexInstall({
      arch: 'x64',
      platform: 'win32'
    })

    expect(resolveOfficialCodexNativeBinaryPath(install.exposedBinaryPath, {
      arch: 'x64',
      platform: 'win32'
    })).toBe(await realpath(install.nativeBinaryPath))
  })

  it('keeps the official launcher when its platform native executable is missing', async () => {
    const install = await createOfficialCodexInstall({
      arch: 'arm64',
      createNative: false,
      platform: 'darwin',
      symlinkLauncher: true
    })

    expect(resolveOfficialCodexNativeBinaryPath(install.exposedBinaryPath, {
      arch: 'arm64',
      platform: 'darwin'
    })).toBe(install.exposedBinaryPath)
  })

  it('does not rewrite a non-official explicit binary', async () => {
    const installDir = await mkdtemp(join(tmpdir(), 'oneworks-custom-codex-cli-'))
    const binaryPath = join(installDir, 'codex')
    tempDirs.push(installDir)
    await writeFile(binaryPath, '#!/bin/sh\n')

    expect(resolveCodexBinaryPath({
      PATH: '/usr/bin:/bin',
      __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: binaryPath
    })).toBe(binaryPath)
  })
})

describe('resolveCodexSystemBinaryPaths', () => {
  it('uses the real HOME for login-shell discovery and macOS candidates', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'oneworks-codex-system-paths-'))
    const realHome = join(workspace, 'real-home')
    const mockHome = join(workspace, 'mock-home')
    const shellPath = join(workspace, 'login-shell')
    const loginShellBinaryPath = join(realHome, 'bin', 'codex')
    const mockShellBinaryPath = join(mockHome, 'bin', 'codex')
    const previousHome = process.env.HOME
    const previousShell = process.env.SHELL
    tempDirs.push(workspace)

    await mkdir(dirname(loginShellBinaryPath), { recursive: true })
    await mkdir(dirname(mockShellBinaryPath), { recursive: true })
    await writeFile(
      shellPath,
      `#!${process.execPath}
console.log(process.env.HOME === ${JSON.stringify(realHome)}
  ? ${JSON.stringify(loginShellBinaryPath)}
  : ${JSON.stringify(mockShellBinaryPath)})
`
    )
    await chmod(shellPath, 0o755)

    process.env.HOME = realHome
    process.env.SHELL = shellPath
    try {
      const paths = await resolveCodexSystemBinaryPaths({ HOME: mockHome }, { platform: 'darwin' })

      expect(paths[0]).toBe(loginShellBinaryPath)
      expect(paths).toContain(resolve(realHome, 'Library/pnpm/bin/codex'))
      expect(paths).toContain('/Applications/Codex.app/Contents/Resources/codex')
      expect(paths).toContain('/Applications/ChatGPT.app/Contents/Resources/codex')
      expect(paths).toContain(resolve(realHome, 'Applications/Codex.app/Contents/Resources/codex'))
      expect(paths).toContain(resolve(realHome, 'Applications/ChatGPT.app/Contents/Resources/codex'))
      expect(paths).not.toContain(mockShellBinaryPath)
      expect(paths).not.toContain(resolve(mockHome, 'Library/pnpm/bin/codex'))
    } finally {
      if (previousHome == null) delete process.env.HOME
      else process.env.HOME = previousHome
      if (previousShell == null) delete process.env.SHELL
      else process.env.SHELL = previousShell
    }
  })
})
