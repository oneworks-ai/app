import { dirname, resolve } from 'node:path'
import process from 'node:process'

import { GLOBAL_CONFIG_RELATIVE_PATHS, resolveGlobalConfigDir } from '@oneworks/config'
import { resolvePrimaryWorkspaceFolder, resolveProjectConfigDir, resolveProjectWorkspaceFolder } from '@oneworks/utils'

const PROJECT_CONFIG_RELATIVE_PATHS = [
  '.oo.config.json',
  'infra/.oo.config.json',
  '.oo.config.yaml',
  'infra/.oo.config.yaml',
  '.oo.config.yml',
  'infra/.oo.config.yml'
] as const

const USER_CONFIG_RELATIVE_PATHS = [
  '.oo.dev.config.json',
  'infra/.oo.dev.config.json',
  '.oo.dev.config.yaml',
  'infra/.oo.dev.config.yaml',
  '.oo.dev.config.yml',
  'infra/.oo.dev.config.yml'
] as const

const CONFIG_INFRA_DIR = 'infra'

interface ConfigWatchSourceState {
  configPath?: string
  resolvedExtendPaths?: string[]
}

const addRelativeTargets = (
  targets: Set<string>,
  cwd: string,
  relativePaths: readonly string[]
) => {
  for (const relativePath of relativePaths) {
    targets.add(resolve(cwd, relativePath))
  }
}

const collectBaseConfigTargets = (
  workspaceFolder: string,
  env: NodeJS.ProcessEnv = process.env
) => {
  const resolvedWorkspaceFolder = resolveProjectWorkspaceFolder(workspaceFolder, env)
  const configCwd = resolveProjectConfigDir(workspaceFolder, env) ?? resolvedWorkspaceFolder
  const primaryWorkspaceFolder = resolvePrimaryWorkspaceFolder(resolvedWorkspaceFolder, env)
  const globalConfigDir = resolveGlobalConfigDir(env)
  const targets = new Set<string>()

  if (globalConfigDir != null) {
    targets.add(resolve(globalConfigDir))
    addRelativeTargets(targets, globalConfigDir, GLOBAL_CONFIG_RELATIVE_PATHS)
  }

  addRelativeTargets(targets, configCwd, PROJECT_CONFIG_RELATIVE_PATHS)
  addRelativeTargets(targets, configCwd, USER_CONFIG_RELATIVE_PATHS)
  targets.add(resolve(configCwd, CONFIG_INFRA_DIR))

  if (primaryWorkspaceFolder != null && resolve(primaryWorkspaceFolder) !== resolve(configCwd)) {
    addRelativeTargets(targets, primaryWorkspaceFolder, USER_CONFIG_RELATIVE_PATHS)
    targets.add(resolve(primaryWorkspaceFolder, CONFIG_INFRA_DIR))
  }

  return targets
}

export const buildDirectoryTargetPlan = (targets: Iterable<string>) => {
  const plan = new Map<string, Set<string>>()

  for (const target of targets) {
    const targetPath = resolve(target)
    const dir = dirname(targetPath)
    const entry = plan.get(dir)
    if (entry == null) {
      plan.set(dir, new Set([targetPath]))
      continue
    }
    entry.add(targetPath)
  }

  return plan
}

export const buildBaseConfigWatchPlan = (
  workspaceFolder: string,
  env: NodeJS.ProcessEnv = process.env
) => (
  buildDirectoryTargetPlan(collectBaseConfigTargets(workspaceFolder, env))
)

export const buildConfigWatchPlan = (
  workspaceFolder: string,
  sources: {
    globalSource?: ConfigWatchSourceState
    projectSource?: ConfigWatchSourceState
    userSource?: ConfigWatchSourceState
  },
  env: NodeJS.ProcessEnv = process.env
) => {
  const targets = collectBaseConfigTargets(workspaceFolder, env)

  for (
    const target of [
      sources.globalSource?.configPath,
      sources.projectSource?.configPath,
      sources.userSource?.configPath,
      ...(sources.globalSource?.resolvedExtendPaths ?? []),
      ...(sources.projectSource?.resolvedExtendPaths ?? []),
      ...(sources.userSource?.resolvedExtendPaths ?? [])
    ]
  ) {
    if (target != null && target !== '') {
      targets.add(resolve(target))
    }
  }

  return buildDirectoryTargetPlan(targets)
}
