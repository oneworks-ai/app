import { describe, expect, it, vi } from 'vitest'

import bootstrapPackageJson from '../package.json'
import { getBootstrapVersion } from '../src/package-config'
import { createBootstrapCli, routeBootstrapCommand } from '../src/program'

describe('bootstrap cli', () => {
  it('routes reserved web command to the web package', () => {
    expect(routeBootstrapCommand('web', ['--port', '8787'])).toEqual({
      commandName: 'oneworks-web',
      forwardedArgs: ['--port', '8787'],
      kind: 'package',
      packageName: '@oneworks/web'
    })
  })

  it('routes app to the desktop launcher', () => {
    expect(routeBootstrapCommand('app', [])).toEqual({
      forwardedArgs: [],
      kind: 'desktop',
      persistInstallMode: false
    })
  })

  it('routes app cache to the desktop launcher in cache mode', () => {
    expect(routeBootstrapCommand('app', ['cache'])).toEqual({
      forwardedArgs: [],
      installMode: 'cache',
      kind: 'desktop',
      persistInstallMode: true
    })
  })

  it('routes app --no-cache to the desktop launcher in user mode', () => {
    expect(routeBootstrapCommand('app', ['--no-cache'])).toEqual({
      forwardedArgs: [],
      installMode: 'user',
      kind: 'desktop',
      persistInstallMode: true
    })
  })

  it('routes runtime package checks', () => {
    expect(routeBootstrapCommand('runtime', ['check', 'cli', '--json'])).toEqual({
      action: 'check',
      json: true,
      kind: 'runtime-package',
      target: 'cli'
    })
  })

  it('routes runtime package versions from target selectors', () => {
    expect(routeBootstrapCommand('runtime', ['check', 'server@1.2.3', '--json'])).toEqual({
      action: 'check',
      json: true,
      kind: 'runtime-package',
      target: 'server',
      version: '1.2.3'
    })
  })

  it('routes runtime package versions from flags', () => {
    expect(routeBootstrapCommand('runtime', ['install', 'client', '--version=2.3.4'])).toEqual({
      action: 'install',
      json: false,
      kind: 'runtime-package',
      target: 'client',
      version: '2.3.4'
    })
  })

  it('routes unknown commands through the CLI package', () => {
    expect(routeBootstrapCommand('hello', [])).toEqual({
      commandName: 'oneworks',
      forwardedArgs: ['hello'],
      kind: 'package',
      packageName: '@oneworks/cli'
    })
  })

  it('reads the current bootstrap package version', () => {
    expect(getBootstrapVersion()).toBe(bootstrapPackageJson.version)
  })

  it('dispatches the desktop launcher for app', async () => {
    const launchDesktopApp = vi.fn(async () => {})
    const launchInstalledPackage = vi.fn(async () => 0)
    const cli = createBootstrapCli({
      launchDesktopApp,
      launchInstalledPackage
    })

    await cli.parseAsync(['node', 'oneworks', 'app'])

    expect(launchDesktopApp).toHaveBeenCalledWith({
      forwardedArgs: [],
      installMode: undefined,
      persistInstallMode: false
    })
    expect(launchInstalledPackage).not.toHaveBeenCalled()
  })

  it('dispatches cache mode for app cache', async () => {
    const launchDesktopApp = vi.fn(async () => {})
    const launchInstalledPackage = vi.fn(async () => 0)
    const cli = createBootstrapCli({
      launchDesktopApp,
      launchInstalledPackage
    })

    await cli.parseAsync(['node', 'oneworks', 'app', 'cache'])

    expect(launchDesktopApp).toHaveBeenCalledWith({
      forwardedArgs: [],
      installMode: 'cache',
      persistInstallMode: true
    })
    expect(launchInstalledPackage).not.toHaveBeenCalled()
  })

  it('dispatches forwarded commands through the CLI package', async () => {
    const launchDesktopApp = vi.fn(async () => {})
    const launchInstalledPackage = vi.fn(async () => 0)
    const cli = createBootstrapCli({
      launchDesktopApp,
      launchInstalledPackage
    })

    await cli.parseAsync(['node', 'oneworks', 'hello'])

    expect(launchInstalledPackage).toHaveBeenCalledWith({
      packageName: '@oneworks/cli',
      commandName: 'oneworks',
      forwardedArgs: ['hello']
    })
    expect(launchDesktopApp).not.toHaveBeenCalled()
  })

  it('dispatches runtime package installation without launching a runtime', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const checkRuntimePackage = vi.fn(async () => {
      throw new Error('unexpected check')
    })
    const installRuntimePackage = vi.fn(async () => ({
      installed: true,
      installedVersion: '1.2.3',
      latestInstalled: true,
      latestVersion: '1.2.3',
      packageName: '@oneworks/cli',
      target: 'cli' as const,
      updateAvailable: false
    }))
    const launchDesktopApp = vi.fn(async () => {})
    const launchInstalledPackage = vi.fn(async () => 0)
    const cli = createBootstrapCli({
      checkRuntimePackage,
      installRuntimePackage,
      launchDesktopApp,
      launchInstalledPackage
    })

    await cli.parseAsync(['node', 'oneworks', 'runtime', 'install', 'cli', '--json'])

    expect(installRuntimePackage).toHaveBeenCalledWith('cli')
    expect(checkRuntimePackage).not.toHaveBeenCalled()
    expect(launchDesktopApp).not.toHaveBeenCalled()
    expect(launchInstalledPackage).not.toHaveBeenCalled()
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('"packageName":"@oneworks/cli"'))
  })

  it('dispatches runtime package installation with a requested version', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const checkRuntimePackage = vi.fn(async () => {
      throw new Error('unexpected check')
    })
    const installRuntimePackage = vi.fn(async () => ({
      installed: true,
      installedVersion: '1.2.3',
      latestInstalled: true,
      latestVersion: '1.2.3',
      packageName: '@oneworks/cli',
      requestedVersion: '1.2.3',
      target: 'cli' as const,
      updateAvailable: false
    }))
    const cli = createBootstrapCli({
      checkRuntimePackage,
      installRuntimePackage,
      launchDesktopApp: vi.fn(async () => {}),
      launchInstalledPackage: vi.fn(async () => 0)
    })

    await cli.parseAsync(['node', 'oneworks', 'runtime', 'install', 'cli@1.2.3', '--json'])

    expect(installRuntimePackage).toHaveBeenCalledWith('cli', { version: '1.2.3' })
    expect(checkRuntimePackage).not.toHaveBeenCalled()
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('"requestedVersion":"1.2.3"'))
  })

  it('forwards --help after a routed command', async () => {
    const launchDesktopApp = vi.fn(async () => {})
    const launchInstalledPackage = vi.fn(async () => 0)
    const cli = createBootstrapCli({
      launchDesktopApp,
      launchInstalledPackage
    })

    await cli.parseAsync(['node', 'oneworks', 'web', '--help'])

    expect(launchInstalledPackage).toHaveBeenCalledWith({
      packageName: '@oneworks/web',
      commandName: 'oneworks-web',
      forwardedArgs: ['--help']
    })
  })
})
