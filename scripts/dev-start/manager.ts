import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

import { getTargetConfig } from './config'
import { getDocsUrl } from './docs-process'
import { buildRuntimeEnv } from './env'
import { ensureGitUpdated, ensureWorkspaceInstall } from './git-workspace'
import { resolvePorts } from './network'
import { log, logDir, managerLogPath, repoRoot, sleep, statePath } from './paths'
import { readState, runSync, spawnDetachedLogged, writeJsonAtomic } from './process'
import { printReady, reuseIfReady, stateReady, stopStaleState, waitForReady } from './readiness'
import { startServiceChild } from './service-manager'
import type { DevStartOptions, DevStartState, DevStartTarget, TargetConfig } from './types'

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

interface RunMainLinks {
  linkedDocsUrl?: string
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

const ensureLinkedHomepage = async (linkedDocsUrl: string) => {
  const existingState = readState('homepage')
  if (
    existingState?.linkedDocsUrl === linkedDocsUrl &&
    typeof existingState.clientUrl === 'string' &&
    await stateReady(existingState)
  ) {
    return existingState.clientUrl
  }

  if (existingState?.root === repoRoot) {
    await stopStaleState('homepage')
  }

  log('starting linked homepage service for docs')
  await runMain('homepage', {}, { linkedDocsUrl })

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

const startElectron = async (target: DevStartTarget, config: TargetConfig) => {
  await stopStaleState(target)
  writeFileSync(managerLogPath(target), '')

  const env: NodeJS.ProcessEnv = { ...process.env }
  if (config.desktopWorkspace === true) {
    env.ONEWORKS_DESKTOP_WORKSPACE = env.INIT_CWD?.trim() || repoRoot
    delete env.ONEWORKS_DESKTOP_LAUNCH_MODE
  } else {
    env.ONEWORKS_DESKTOP_LAUNCH_MODE = env.ONEWORKS_DESKTOP_LAUNCH_MODE?.trim() || 'empty'
  }

  const child = spawnDetachedLogged({
    args: ['apps/desktop/scripts/dev.cjs', ...(config.desktopWorkspace === true ? ['--workspace'] : [])],
    command: process.execPath,
    cwd: repoRoot,
    env,
    logPath: managerLogPath(target)
  })

  const state: DevStartState = {
    desktopPid: child.pid,
    managerLog: managerLogPath(target),
    readiness: 'process',
    root: repoRoot,
    target
  }
  writeJsonAtomic(statePath(target), state)
  await sleep(1500)
  printReady(state)
}

export const runMain = async (
  target: DevStartTarget,
  options: Pick<DevStartOptions, 'workspace'> = {},
  links: RunMainLinks = {}
) => {
  mkdirSync(logDir, { recursive: true })
  const config = getTargetConfig(target, options)

  const updateResult = ensureGitUpdated()
  if (target !== 'docs' && !updateResult.changed) {
    if (target === 'homepage' && links.linkedDocsUrl != null) {
      if (await reuseLinkedHomepageIfReady(links.linkedDocsUrl)) return
    } else if (await reuseIfReady(target)) {
      return
    }
  }

  ensureWorkspaceInstall()
  ensureHomepageWorkspace(target)
  await buildStaticClient(target, config)
  if (target !== 'docs' && !updateResult.changed) {
    if (target === 'homepage' && links.linkedDocsUrl != null) {
      if (await reuseLinkedHomepageIfReady(links.linkedDocsUrl)) return
    } else if (await reuseIfReady(target)) {
      return
    }
  }

  if (config.readiness === 'process') {
    await startElectron(target, config)
    return
  }

  if (target === 'docs') {
    const existingState = readState(target)
    if (
      !updateResult.changed &&
      typeof existingState?.docsUrl === 'string' &&
      await stateReady(existingState)
    ) {
      const linkedHomepageUrl = await ensureLinkedHomepage(existingState.docsUrl)
      if (existingState.linkedHomepageUrl === linkedHomepageUrl) {
        printReady(existingState)
        return
      }
    }

    await stopStaleState(target)
    const ports = await resolvePorts(config)
    if (ports.clientPort == null) throw new Error('Docs port was not resolved')
    const docsUrl = getDocsUrl(ports.clientPort)
    const linkedHomepageUrl = await ensureLinkedHomepage(docsUrl)
    await startServiceChild({ config, linkedHomepageUrl, ports, target })
    await waitForReady(target)
    return
  }

  await stopStaleState(target)
  const ports = await resolvePorts(config)
  await startServiceChild({
    config,
    linkedDocsUrl: links.linkedDocsUrl,
    ports,
    target
  })
  await waitForReady(target)
}
