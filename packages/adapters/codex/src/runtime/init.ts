/* eslint-disable max-lines -- Codex init centralizes mock-home config, auth, skills, and native hooks setup. */
import { access, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'

import { readJsonFileOrDefault, resolveMockHome, writeJsonFile } from '@oneworks/hooks'
import type { AdapterCtx } from '@oneworks/types'
import {
  createStartupProfiler,
  migrateProjectHomeSegments,
  resolveProjectOoPath,
  syncSymlinkTarget,
  unlinkMockHomeBridgePaths
} from '@oneworks/utils'
import { ensureManagedNpmCli } from '@oneworks/utils/managed-npm-cli'

import {
  CODEX_CLI_COMPATIBILITY_RANGE,
  CODEX_CLI_PACKAGE,
  CODEX_CLI_VERSION,
  resolveCodexBinaryPath,
  resolveCodexSystemBinaryPaths
} from '#~/paths.js'
import {
  resolveCodexAdapterConfig,
  resolveInitialManagedCodexConfigContent,
  writeManagedCodexConfigFile
} from './config'
import { ensureCodexNativeHooksInstalled } from './native-hooks'

const CODEX_MANAGED_SKILLS_STATE_FILE = '.oneworks-managed-skills.json'

const syncCodexMockHomeSymlink = async (params: {
  sourcePath: string
  targetPath: string
  type: 'dir' | 'file'
}) => {
  await syncSymlinkTarget({
    ...params,
    onMissingSource: 'remove'
  })
}

/**
 * Symlink `<home>/.codex/auth.json` into `<aiHome>/.codex/auth.json` so
 * the codex process can authenticate when HOME is redirected to the project mock home.
 */
async function linkAuthFile(home: string, mockHome: string): Promise<void> {
  const realAuth = join(home, '.codex', 'auth.json')
  const aiCodexDir = join(mockHome, '.codex')
  const aiAuth = join(aiCodexDir, 'auth.json')

  await unlinkMockHomeBridgePaths({
    mockHome,
    paths: ['.codex/auth.json']
  })
  await mkdir(aiCodexDir, { recursive: true })
  await syncCodexMockHomeSymlink({
    sourcePath: realAuth,
    targetPath: aiAuth,
    type: 'file'
  })
}

const resolveCodexManagedSkills = (ctx: Pick<AdapterCtx, 'assets'>) => {
  const result = new Map<string, string>()
  for (const asset of ctx.assets?.skills ?? []) {
    const targetName = asset.displayName.replaceAll('/', '__')
    if (targetName === '' || result.has(targetName)) continue
    result.set(targetName, dirname(asset.sourcePath))
  }
  return result
}

const syncCodexMockHomeSkillDirectoryEntries = async (params: {
  skills: Map<string, string>
  targetDir: string
}) => {
  await rm(params.targetDir, { recursive: true, force: true })
  await mkdir(params.targetDir, { recursive: true })

  for (const [skillName, sourcePath] of params.skills.entries()) {
    await syncCodexMockHomeSymlink({
      sourcePath,
      targetPath: join(params.targetDir, skillName),
      type: 'dir'
    })
  }
}

async function syncCodexMockHomeSkills(ctx: Pick<AdapterCtx, 'assets' | 'cwd' | 'env'>): Promise<void> {
  const sourceDir = resolveProjectOoPath(ctx.cwd, ctx.env, 'skills')
  const mockHome = resolveMockHome(ctx.cwd, ctx.env)
  const managedSkills = resolveCodexManagedSkills(ctx)

  await unlinkMockHomeBridgePaths({
    mockHome,
    paths: ['.agents/skills', '.codex/skills']
  })

  if (managedSkills.size > 0) {
    await syncCodexMockHomeSkillDirectoryEntries({
      skills: managedSkills,
      targetDir: resolve(mockHome, '.agents', 'skills')
    })
    await syncCodexMockHomeNativeSkillEntries({
      skills: managedSkills,
      targetDir: resolve(mockHome, '.codex', 'skills')
    })
    return
  }

  await syncCodexMockHomeSymlink({
    sourcePath: sourceDir,
    targetPath: resolve(mockHome, '.agents', 'skills'),
    type: 'dir'
  })
  await syncCodexMockHomeNativeSkillEntries({
    skills: await readSourceDirSkillEntries(sourceDir),
    targetDir: resolve(mockHome, '.codex', 'skills')
  })
}

const readSourceDirSkillEntries = async (sourceDir: string) => {
  try {
    await access(sourceDir)
  } catch {
    return undefined
  }

  const skillNames = (await readdir(sourceDir, { withFileTypes: true }))
    .filter(entry => !entry.name.startsWith('.') && (entry.isDirectory() || entry.isSymbolicLink()))
    .map(entry => entry.name)
    .sort((left, right) => left.localeCompare(right))

  return new Map(skillNames.map(skillName => [skillName, join(sourceDir, skillName)]))
}

const syncCodexMockHomeNativeSkillEntries = async (params: {
  skills: Map<string, string> | undefined
  targetDir: string
}) => {
  const { skills, targetDir } = params
  const statePath = join(targetDir, CODEX_MANAGED_SKILLS_STATE_FILE)
  const previousState = await readJsonFileOrDefault<{ skills?: unknown }>(statePath, {})
  const previousManagedSkills = Array.isArray(previousState.skills)
    ? previousState.skills.filter((name): name is string => typeof name === 'string' && name.trim() !== '')
    : []

  for (const skillName of previousManagedSkills) {
    await rm(join(targetDir, skillName), { recursive: true, force: true })
  }

  if (skills == null) {
    await writeJsonFile(statePath, { skills: [] })
    return
  }

  await mkdir(targetDir, { recursive: true })
  const nextManagedSkills = Array.from(skills.keys()).sort((left, right) => left.localeCompare(right))

  for (const skillName of nextManagedSkills) {
    const sourcePath = skills.get(skillName)
    if (sourcePath == null) continue
    await syncCodexMockHomeSymlink({
      sourcePath,
      targetPath: join(targetDir, skillName),
      type: 'dir'
    })
  }

  await writeJsonFile(statePath, { skills: nextManagedSkills })
}

const readOptionalTextFile = async (filePath: string) => {
  try {
    return await readFile(filePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function writeManagedCodexConfig(
  ctx: Pick<AdapterCtx, 'configState' | 'cwd' | 'env' | 'configs'>
): Promise<void> {
  const mockHome = resolveMockHome(ctx.cwd, ctx.env)
  const configPath = join(mockHome, '.codex', 'config.toml')
  const currentConfigContent = await readOptionalTextFile(configPath)
  const realHome = ctx.env.__ONEWORKS_PROJECT_REAL_HOME__?.trim() || process.env.__ONEWORKS_PROJECT_REAL_HOME__?.trim()
  const realConfigContent = realHome == null || realHome === ''
    ? undefined
    : await readOptionalTextFile(join(realHome, '.codex', 'config.toml'))
  const initialContent = resolveInitialManagedCodexConfigContent({
    currentContent: currentConfigContent,
    inheritedContent: realConfigContent
  })

  await unlinkMockHomeBridgePaths({
    mockHome,
    paths: ['.codex/config.toml']
  })
  await writeManagedCodexConfigFile({
    configPath,
    workspacePath: ctx.cwd,
    configs: ctx.configs,
    configState: ctx.configState,
    forceWrite: initialContent !== undefined,
    ...(initialContent === undefined ? {} : { initialContent })
  })
}

/**
 * Initialize the Codex adapter.
 *
 * Unlike the claude-code adapter (which generates a CCR config.json and
 * restarts a router), the Codex adapter manages its own `~/.codex/config.toml`
 * and accepts all configuration as per-connection or per-turn overrides in the
 * JSON-RPC protocol.
 *
 * This init step:
 *   1. Verifies that the `codex` binary is reachable.
 *   2. Writes a managed mock-home `config.toml` for trust and startup defaults.
 *   3. Installs a workspace-local native hooks bridge into the mock Codex home.
 */
export const initCodexAdapter = async (ctx: AdapterCtx) => {
  await migrateProjectHomeSegments(ctx.cwd, ctx.env, ['caches', '.mock'])
  const { env } = ctx
  const startupProfiler = createStartupProfiler({
    config: ctx.configState?.mergedConfig,
    cwd: ctx.cwd,
    ctxId: ctx.ctxId,
    env,
    sessionId: env.__ONEWORKS_PROJECT_SESSION_ID__ ?? ctx.ctxId
  })
  const home = ctx.env.__ONEWORKS_PROJECT_REAL_HOME__?.trim() || process.env.__ONEWORKS_PROJECT_REAL_HOME__?.trim()
  const mockHome = resolveMockHome(ctx.cwd, ctx.env)

  const { native: adapterConfig } = resolveCodexAdapterConfig(ctx)
  const managedCliStartedAt = startupProfiler.now()
  ctx.env.__ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__ = await ensureManagedNpmCli({
    adapterKey: 'codex',
    binaryName: 'codex',
    bundledPath: resolveCodexBinaryPath(env, ctx.cwd),
    config: adapterConfig.cli,
    cwd: ctx.cwd,
    defaultPackageName: CODEX_CLI_PACKAGE,
    defaultVersion: CODEX_CLI_VERSION,
    env,
    logger: ctx.logger,
    preferSystem: adapterConfig.cli?.source == null,
    systemBinaryPaths: await resolveCodexSystemBinaryPaths(env),
    versionRange: CODEX_CLI_COMPATIBILITY_RANGE
  })
  startupProfiler.mark('codex.init.ensureManagedNpmCli', managedCliStartedAt)

  if (home != null && home !== '') {
    const linkAuthStartedAt = startupProfiler.now()
    await linkAuthFile(home, mockHome)
    startupProfiler.mark('codex.init.linkAuthFile', linkAuthStartedAt)
  }
  const skillsStartedAt = startupProfiler.now()
  await syncCodexMockHomeSkills(ctx)
  startupProfiler.mark('codex.init.syncCodexMockHomeSkills', skillsStartedAt)
  const configStartedAt = startupProfiler.now()
  await writeManagedCodexConfig(ctx)
  startupProfiler.mark('codex.init.writeManagedCodexConfig', configStartedAt)
  const hooksStartedAt = startupProfiler.now()
  await ensureCodexNativeHooksInstalled(ctx)
  startupProfiler.mark('codex.init.ensureCodexNativeHooksInstalled', hooksStartedAt)
}
