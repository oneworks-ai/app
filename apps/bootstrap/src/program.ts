/* eslint-disable max-lines -- bootstrap CLI command routing is intentionally centralized. */
import { Command } from 'commander'
import process from 'node:process'

import { launchDesktopApp } from './desktop-app'
import type { DesktopInstallMode, LaunchDesktopAppOptions } from './desktop-app'
import { getBootstrapDescription, getBootstrapVersion } from './package-config'
import { launchInstalledPackage } from './package-launcher'
import { checkRuntimePackage, formatRuntimePackageStatus, installRuntimePackage } from './runtime-package'
import type { RuntimePackageAction, RuntimePackageOptions, RuntimePackageStatus } from './runtime-package'

interface BootstrapCliDeps {
  checkRuntimePackage: (target?: string, options?: RuntimePackageOptions) => Promise<RuntimePackageStatus>
  installRuntimePackage: (target?: string, options?: RuntimePackageOptions) => Promise<RuntimePackageStatus>
  launchDesktopApp: (options: LaunchDesktopAppOptions) => Promise<void>
  launchInstalledPackage: (input: {
    commandName?: string
    forwardedArgs: string[]
    packageName: string
  }) => Promise<number>
}

type BootstrapTarget =
  | {
    forwardedArgs: string[]
    installMode?: DesktopInstallMode
    kind: 'desktop'
    persistInstallMode?: boolean
  }
  | {
    commandName?: string
    forwardedArgs: string[]
    kind: 'package'
    packageName: string
  }
  | {
    action: RuntimePackageAction
    cacheVersion?: string
    json: boolean
    kind: 'runtime-package'
    target?: string
    version?: string
  }

const DEFAULT_DEPS: BootstrapCliDeps = {
  checkRuntimePackage,
  installRuntimePackage,
  launchDesktopApp,
  launchInstalledPackage
}

const parseDesktopTarget = (args: string[]): BootstrapTarget => {
  const forwardedArgs = [...args]
  let installMode: DesktopInstallMode | undefined
  let persistInstallMode = false

  if (forwardedArgs[0] === 'cache') {
    forwardedArgs.shift()
    installMode = 'cache'
    persistInstallMode = true
  }

  const noCacheIndex = forwardedArgs.indexOf('--no-cache')
  if (noCacheIndex >= 0) {
    forwardedArgs.splice(noCacheIndex, 1)
    installMode = 'user'
    persistInstallMode = true
  }

  return {
    forwardedArgs,
    installMode,
    kind: 'desktop',
    persistInstallMode
  }
}

const parseRuntimePackageTarget = (args: string[]): BootstrapTarget => {
  const forwardedArgs = [...args]
  const jsonIndex = forwardedArgs.indexOf('--json')
  const json = jsonIndex >= 0
  if (json) {
    forwardedArgs.splice(jsonIndex, 1)
  }

  const action = forwardedArgs.shift()
  if (action !== 'check' && action !== 'install') {
    throw new Error('Runtime package command must be `check` or `install`.')
  }

  let version: string | undefined
  let cacheVersion: string | undefined
  for (let index = 0; index < forwardedArgs.length; index += 1) {
    const arg = forwardedArgs[index]
    if (arg === '--version') {
      const value = forwardedArgs[index + 1]
      if (value == null || value.trim() === '') {
        throw new Error('Runtime package --version requires a value.')
      }
      version = value
      forwardedArgs.splice(index, 2)
      index -= 1
      continue
    }

    if (arg?.startsWith('--version=')) {
      const value = arg.slice('--version='.length)
      if (value.trim() === '') {
        throw new Error('Runtime package --version requires a value.')
      }
      version = value
      forwardedArgs.splice(index, 1)
      index -= 1
      continue
    }

    if (arg === '--cache-version') {
      const value = forwardedArgs[index + 1]
      if (value == null || value.trim() === '') {
        throw new Error('Runtime package --cache-version requires a value.')
      }
      cacheVersion = value
      forwardedArgs.splice(index, 2)
      index -= 1
      continue
    }

    if (arg?.startsWith('--cache-version=')) {
      const value = arg.slice('--cache-version='.length)
      if (value.trim() === '') {
        throw new Error('Runtime package --cache-version requires a value.')
      }
      cacheVersion = value
      forwardedArgs.splice(index, 1)
      index -= 1
    }
  }

  const targetSelector = forwardedArgs.shift()
  if (forwardedArgs.length > 0) {
    throw new Error(`Unsupported runtime package arguments: ${forwardedArgs.join(' ')}`)
  }

  const selectorAtIndex = targetSelector?.lastIndexOf('@') ?? -1
  const selectorTarget = selectorAtIndex > 0 ? targetSelector?.slice(0, selectorAtIndex) : targetSelector
  const selectorVersion = selectorAtIndex > 0 ? targetSelector?.slice(selectorAtIndex + 1) : undefined
  if (selectorVersion != null && selectorVersion.trim() === '') {
    throw new Error(`Runtime package target selector requires a version: ${targetSelector}.`)
  }
  if (version != null && selectorVersion != null && version !== selectorVersion) {
    throw new Error(`Conflicting runtime package versions: ${selectorVersion} and ${version}.`)
  }
  const resolvedVersion = version ?? selectorVersion

  return {
    action,
    ...(cacheVersion != null ? { cacheVersion } : {}),
    json,
    kind: 'runtime-package',
    target: selectorTarget,
    ...(resolvedVersion != null ? { version: resolvedVersion } : {})
  }
}

export const routeBootstrapCommand = (command: string | undefined, args: string[]): BootstrapTarget | undefined => {
  if (command == null || command.trim() === '') {
    return undefined
  }

  if (command === 'web') {
    return {
      commandName: 'oneworks-web',
      forwardedArgs: args,
      kind: 'package',
      packageName: '@oneworks/web'
    }
  }

  if (command === 'server') {
    return {
      commandName: 'oneworks-server',
      forwardedArgs: args,
      kind: 'package',
      packageName: '@oneworks/server'
    }
  }

  if (command === 'runtime') {
    return parseRuntimePackageTarget(args)
  }

  if (command === 'app') {
    return parseDesktopTarget(args)
  }

  if (command === 'cli') {
    return {
      commandName: 'oneworks',
      forwardedArgs: args,
      kind: 'package',
      packageName: '@oneworks/cli'
    }
  }

  return {
    commandName: 'oneworks',
    forwardedArgs: [command, ...args],
    kind: 'package',
    packageName: '@oneworks/cli'
  }
}

export const createBootstrapCli = (inputDeps: Partial<BootstrapCliDeps> = {}) => {
  const deps: BootstrapCliDeps = {
    ...DEFAULT_DEPS,
    ...inputDeps
  }
  const program = new Command()

  program
    .name('oneworks')
    .description(getBootstrapDescription())
    .helpOption(false)
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .argument('[command]', 'Reserved commands: web, server, app, cli')
    .argument('[args...]', 'Forwarded arguments for the delegated runtime')
    .showHelpAfterError()
    .addHelpText(
      'after',
      `
Top-level flags:
  --help, -h     Show bootstrap help
  --version, -V  Print bootstrap version

Examples:
  npx oneworks summarize the repo
  npx oneworks web --port 8787
  npx oneworks server --host 0.0.0.0 --allow-cors
  npx oneworks runtime check cli
  npx oneworks runtime check cli@0.1.0-alpha.0
  npx oneworks runtime install server
  npx oneworks runtime install server --version 0.1.0-alpha.0
  npx oneworks runtime install server --version 0.1.0-alpha.0 --cache-version dev-local
  npx oneworks app
  npx oneworks app cache
  npx oneworks app --no-cache
  cd ~/work/project-a && npx oneworks app
  cd ~/work/project-b && npx oneworks app
`
    )
    .action(async (command: string | undefined, args: string[] = []) => {
      const target = routeBootstrapCommand(command, args)
      if (target == null) {
        program.outputHelp()
        return
      }

      if (target.kind === 'desktop') {
        await deps.launchDesktopApp({
          forwardedArgs: target.forwardedArgs,
          installMode: target.installMode,
          persistInstallMode: target.persistInstallMode
        })
        return
      }

      if (target.kind === 'runtime-package') {
        const runtimeOptions: RuntimePackageOptions = {
          ...(target.version == null ? {} : { version: target.version }),
          ...(target.cacheVersion == null ? {} : { cacheVersion: target.cacheVersion })
        }
        const hasRuntimeOptions = Object.keys(runtimeOptions).length > 0
        let status: RuntimePackageStatus
        if (target.action === 'install') {
          status = !hasRuntimeOptions
            ? await deps.installRuntimePackage(target.target)
            : await deps.installRuntimePackage(target.target, runtimeOptions)
        } else {
          status = !hasRuntimeOptions
            ? await deps.checkRuntimePackage(target.target)
            : await deps.checkRuntimePackage(target.target, runtimeOptions)
        }
        const output = target.json ? JSON.stringify(status) : formatRuntimePackageStatus(status)
        process.stdout.write(`${output}\n`)
        return
      }

      const exitCode = await deps.launchInstalledPackage({
        packageName: target.packageName,
        commandName: target.commandName,
        forwardedArgs: target.forwardedArgs
      })

      if (exitCode !== 0) {
        process.exit(exitCode)
      }
    })

  return program
}

export const runBootstrapCli = async (argv = process.argv) => {
  const command = createBootstrapCli()
  const userArgs = argv.slice(2)
  if (userArgs.length === 0 || (userArgs.length === 1 && ['-h', '--help'].includes(userArgs[0] ?? ''))) {
    command.outputHelp()
    return
  }

  if (userArgs.length === 1 && ['-V', '--version'].includes(userArgs[0] ?? '')) {
    process.stdout.write(`${getBootstrapVersion()}\n`)
    return
  }

  await command.parseAsync(argv)
}
