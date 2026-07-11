/* eslint-disable max-lines -- target preparation, resource groups, and linked docs/homepage orchestration are one flow. */
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

import { getTargetConfig } from './config'
import { withDevServiceOperation } from './coordination'
import { getDocsUrl } from './docs-process'
import { buildRuntimeEnv } from './env'
import { resolveElectronLaunchIdentity, startAndroidEmulator, startElectron } from './external-targets'
import { ensureGitUpdated, ensureWorkspaceInstall } from './git-workspace'
import { resolvePorts } from './network'
import { log, logDir, repoRoot } from './paths'
import { withDevStartPortLock, withDevStartPreparationLock } from './port-lock'
import { readState, runSync } from './process'
import {
  assertTargetStartable,
  printReady,
  reuseIfReady,
  stateHasLiveProcesses,
  stateReady,
  waitForReady
} from './readiness'
import { startServiceChild } from './service-manager'
import type { DevServiceOperation, DevStartOptions, DevStartTarget, TargetConfig } from './types'

const buildStaticClient = async (target: DevStartTarget, config: TargetConfig) => {
  if (config.buildClient !== true) return

  log(`building ${target} client`)
  runSync('pnpm', ['--filter', '@oneworks/client', 'exec', 'vite', 'build'], {
    env: await buildRuntimeEnv({
      base: config.base,
      clientMode: config.clientMode,
      extra: config.extraEnv
    })
  })
}

export { resolveDesktopWorkspaceLaunchFolder } from './external-targets'

interface RunMainLinks {
  linkedDocsUrl?: string
}

const resourceSibling = (target: DevStartTarget): DevStartTarget | undefined => {
  if (target === 'electron') return 'electron-workspace'
  if (target === 'electron-workspace') return 'electron'
  if (target === 'web') return 'daemon'
  if (target === 'daemon') return 'web'
  return undefined
}

const assertResourceGroupStartable = (target: DevStartTarget) => {
  assertTargetStartable(target)
  const sibling = resourceSibling(target)
  if (sibling == null || !stateHasLiveProcesses(readState(sibling))) return
  throw new Error(
    `${target} shares a runtime resource with active target ${sibling}. ` +
      `Stop ${sibling} with explicit authorization before starting ${target}.`
  )
}

const ensureHomepageWorkspace = (target: DevStartTarget) => {
  if (target !== 'homepage' && target !== 'docs') return

  const homepageRoot = join(repoRoot, 'assets/homepage')
  log('initializing homepage submodule')
  runSync('git', ['submodule', 'update', '--init', '--recursive', 'assets/homepage'])
  if (existsSync(join(homepageRoot, 'node_modules'))) return

  log('installing homepage dependencies')
  runSync('pnpm', ['install'], { cwd: homepageRoot })
}

const reuseLinkedHomepageIfReady = async (linkedDocsUrl: string) => {
  const state = readState('homepage')
  if (state?.linkedDocsUrl !== linkedDocsUrl) return false
  if (!await stateReady(state)) return false

  printReady(state)
  return true
}

const ensureLinkedHomepage = async (
  linkedDocsUrl: string,
  options: { operation?: DevServiceOperation; portLockHeld?: boolean } = {}
) => {
  const existingState = readState('homepage')
  if (
    existingState?.linkedDocsUrl === linkedDocsUrl &&
    typeof existingState.clientUrl === 'string' &&
    await stateReady(existingState)
  ) {
    return existingState.clientUrl
  }

  log('starting linked homepage service for docs')
  const startHomepage = async (operation: DevServiceOperation) => {
    await runMain('homepage', {
      operation,
      portLockHeld: options.portLockHeld ?? false
    }, { linkedDocsUrl })
  }
  if (options.operation == null) {
    await withDevServiceOperation('homepage', 'ensure', startHomepage)
  } else {
    await startHomepage(options.operation)
  }

  const nextState = readState('homepage')
  if (
    nextState?.linkedDocsUrl !== linkedDocsUrl ||
    typeof nextState.clientUrl !== 'string' ||
    !await stateReady(nextState)
  ) {
    throw new Error('Linked homepage failed to become ready for docs')
  }
  return nextState.clientUrl
}

export const runMain = async (
  target: DevStartTarget,
  options: Pick<DevStartOptions, 'operation' | 'portLockHeld' | 'workspace'> = {},
  links: RunMainLinks = {}
) => {
  mkdirSync(logDir, { recursive: true })
  const config = getTargetConfig(target, options)
  const launchIdentity = config.kind === 'desktop'
    ? resolveElectronLaunchIdentity(config)
    : config.kind === 'android-emulator'
    ? `avd:${process.env.ONEWORKS_ANDROID_AVD ?? 'OneWorksApi35Visible'}`
    : undefined

  await withDevStartPreparationLock(async () => {
    ensureGitUpdated()
    ensureWorkspaceInstall()
  })
  if (target !== 'docs') {
    if (target === 'homepage' && links.linkedDocsUrl != null) {
      if (await reuseLinkedHomepageIfReady(links.linkedDocsUrl)) return
    } else if (await reuseIfReady(target, launchIdentity)) {
      return
    }
  }

  if (config.kind === 'android-emulator') {
    const current = readState(target)
    if (await reuseIfReady(target, launchIdentity)) return
    if (await stateReady(current)) {
      throw new Error(
        `android-emulator is already running as ${current?.launchIdentity ?? 'an unknown AVD'}; ` +
          'stop it with explicit authorization before switching AVDs.'
      )
    }
    assertResourceGroupStartable(target)
    startAndroidEmulator(options.operation)
    return
  }
  if (target !== 'docs') assertResourceGroupStartable(target)
  await withDevStartPreparationLock(async () => {
    ensureHomepageWorkspace(target)
    await buildStaticClient(target, config)
  })
  if (target !== 'docs') {
    if (target === 'homepage' && links.linkedDocsUrl != null) {
      if (await reuseLinkedHomepageIfReady(links.linkedDocsUrl)) return
    } else if (await reuseIfReady(target, launchIdentity)) {
      return
    }
  }

  if (config.readiness === 'process') {
    await startElectron(target, config, options.operation)
    return
  }

  if (target === 'docs') {
    await withDevServiceOperation('homepage', 'ensure', async (homepageOperation) => {
      const existingState = readState(target)
      if (
        typeof existingState?.docsUrl === 'string' &&
        await stateReady(existingState)
      ) {
        const linkedHomepageUrl = await ensureLinkedHomepage(existingState.docsUrl, {
          operation: homepageOperation
        })
        if (existingState.linkedHomepageUrl === linkedHomepageUrl) {
          printReady(existingState)
          return
        }
      }

      await withDevStartPortLock(async () => {
        assertResourceGroupStartable(target)
        const ports = await resolvePorts(config)
        if (ports.clientPort == null) throw new Error('Docs port was not resolved')
        const docsUrl = getDocsUrl(ports.clientPort)
        const linkedHomepageUrl = await ensureLinkedHomepage(docsUrl, {
          operation: homepageOperation,
          portLockHeld: true
        })
        await startServiceChild({ config, linkedHomepageUrl, operation: options.operation, ports, target })
        await waitForReady(target)
      })
    })
    return
  }

  const startTarget = async () => {
    assertResourceGroupStartable(target)
    const ports = await resolvePorts(config)
    await startServiceChild({
      config,
      linkedDocsUrl: links.linkedDocsUrl,
      operation: options.operation,
      ports,
      target
    })
    await waitForReady(target)
  }
  if (options.portLockHeld === true) await startTarget()
  else await withDevStartPortLock(startTarget)
}
