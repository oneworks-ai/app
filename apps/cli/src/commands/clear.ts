import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import {
  mergeProcessEnvWithProjectEnv,
  resolveLegacyProjectHomeSegmentPaths,
  resolveProjectHomePath,
  resolveProjectOoBaseDirName,
  resolveProjectOoPath
} from '@oneworks/utils'
import type { Command } from 'commander'
import fg from 'fast-glob'

const CLEAR_PROJECT_HOME_TARGETS = [
  'logs',
  'caches'
] as const

const CLEAR_MOCK_TARGETS = [
  '.mock/.claude/debug',
  '.mock/.claude/todos',
  '.mock/.claude/session-env',
  '.mock/.claude/projects',
  '.mock/.claude-core-router/logs',
  '.mock/.claude-code-router/logs'
] as const

const BENCHMARK_LOG_PATTERNS = [
  'benchmarks/specs/**/logs',
  'benchmarks/entities/**/logs',
  'benchmarks/cases/**/logs'
] as const

const CLAUDE_CODE_ROUTER_LOG_FILE_PATTERNS = [
  '.claude-code-router/*.log',
  '.claude-code-router/*.log.*'
] as const

const CLAUDE_CODE_ROUTER_SESSION_LOG_PATTERN = '.claude-code-router/*/logs'

export interface RunClearCommandOptions {
  cwd?: string
}

const resolveSegmentTargetDirs = (
  cwd: string,
  env: NodeJS.ProcessEnv,
  segment: 'logs' | 'caches' | '.mock'
) => {
  const paths = resolveLegacyProjectHomeSegmentPaths(cwd, env, segment)
  return [
    paths.targetDir,
    ...paths.sourceDirs
  ]
}

const resolveMockTargetDirs = (cwd: string, env: NodeJS.ProcessEnv, target: string) => {
  const mockRelativePath = target.replace(/^\.mock\//u, '')
  return resolveSegmentTargetDirs(cwd, env, '.mock')
    .map(mockRoot => path.resolve(mockRoot, ...mockRelativePath.split('/')))
}

async function collectClearTargets(cwd: string, env: NodeJS.ProcessEnv) {
  const aiBaseDir = resolveProjectOoPath(cwd, env)
  const logsDir = resolveProjectOoPath(cwd, env, 'logs')
  const mockHomeDirs = resolveSegmentTargetDirs(cwd, env, '.mock')
  const benchmarkLogDirs = await fg([...BENCHMARK_LOG_PATTERNS], {
    cwd: aiBaseDir,
    onlyDirectories: true,
    deep: 10,
    absolute: true
  })

  const claudeCodeRouterSessionLogDirs = (
    await Promise.all(mockHomeDirs.map(mockHomeDir =>
      fg(CLAUDE_CODE_ROUTER_SESSION_LOG_PATTERN, {
        cwd: mockHomeDir,
        onlyDirectories: true,
        deep: 2,
        absolute: true
      })
    ))
  ).flat()

  const claudeCodeRouterLogFiles = (
    await Promise.all(mockHomeDirs.map(mockHomeDir =>
      fg([...CLAUDE_CODE_ROUTER_LOG_FILE_PATTERNS], {
        cwd: mockHomeDir,
        onlyFiles: true,
        deep: 1,
        absolute: true
      })
    ))
  ).flat()

  return [
    path.resolve(cwd, '.logs'),
    ...CLEAR_PROJECT_HOME_TARGETS.flatMap(target => resolveSegmentTargetDirs(cwd, env, target)),
    ...CLEAR_MOCK_TARGETS.flatMap(target => resolveMockTargetDirs(cwd, env, target)),
    ...benchmarkLogDirs.filter(dir => dir !== logsDir && !dir.startsWith(`${logsDir}${path.sep}`)),
    ...claudeCodeRouterSessionLogDirs.map(dir => path.dirname(dir)),
    ...claudeCodeRouterLogFiles
  ]
}

export async function runClearCommand(options: RunClearCommandOptions = {}) {
  const cwd = options.cwd ?? process.cwd()
  const env = mergeProcessEnvWithProjectEnv(undefined, { workspaceFolder: cwd })
  const targets = Array.from(new Set(await collectClearTargets(cwd, env)))

  await Promise.all(
    targets.map(target => fs.rm(target, { force: true, recursive: true }))
  )

  await Promise.all([
    fs.mkdir(resolveProjectOoPath(cwd, env, 'logs'), { recursive: true }),
    fs.mkdir(resolveProjectOoPath(cwd, env, 'caches'), { recursive: true })
  ])

  await Promise.all([
    fs.writeFile(resolveProjectOoPath(cwd, env, 'logs', '.gitkeep'), ''),
    fs.writeFile(resolveProjectOoPath(cwd, env, 'caches', '.gitkeep'), '')
  ])

  console.log(
    `Clear logs and cache successfully (${resolveProjectOoBaseDirName(env)} assets, ${
      resolveProjectHomePath(cwd, env)
    } runtime data)`
  )
}

export function registerClearCommand(program: Command) {
  program
    .command('clear')
    .description('Clear logs and cache of sub-agents')
    .action(async () => {
      await runClearCommand()
    })
}
