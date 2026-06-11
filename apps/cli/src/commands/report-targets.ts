import { constants } from 'node:fs'
import type { Dirent } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

import {
  mergeProcessEnvWithProjectEnv,
  migrateProjectHomeSegments,
  resolveProjectHomePath,
  resolveProjectOoPath
} from '@oneworks/utils'

const REPORT_TARGETS = ['logs', 'caches'] as const
const REPORT_MOCK_TARGETS = [
  '.mock/.claude',
  '.mock/.claude-code-router',
  '.mock/.config',
  '.mock/.codex',
  '.mock/.oneworks'
] as const
const REPORT_MOCK_FILE_PREFIX = '.claude.json'

const collectExistingTargets = async (cwd: string, env: NodeJS.ProcessEnv, targets: readonly string[]) => {
  const availableTargets: string[] = []

  for (const target of targets) {
    try {
      const resolvedTarget = resolveProjectOoPath(cwd, env, ...target.split('/'))
      await fs.access(resolvedTarget, constants.F_OK)
      availableTargets.push(resolvedTarget)
    } catch {
      // ignore missing targets
    }
  }

  return availableTargets
}

const collectMockReportTargets = async (cwd: string, env: NodeJS.ProcessEnv) => {
  const availableTargets = await collectExistingTargets(cwd, env, REPORT_MOCK_TARGETS)
  const mockRoot = resolveProjectOoPath(cwd, env, '.mock')

  try {
    const entries = await fs.readdir(mockRoot, { withFileTypes: true })
    const mockFiles = entries
      .filter(entry =>
        entry.isFile() && (
          entry.name === REPORT_MOCK_FILE_PREFIX ||
          entry.name.startsWith(`${REPORT_MOCK_FILE_PREFIX}.backup`)
        )
      )
      .map(entry => path.resolve(mockRoot, entry.name))
      .sort((left, right) => left.localeCompare(right))

    availableTargets.push(...mockFiles)
  } catch {
    // ignore missing mock root
  }

  return availableTargets
}

const isPathInside = (target: string, source: string) => {
  const relativePath = path.relative(source, target)
  return relativePath === '' || (
    relativePath !== '..' &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  )
}

const isLoggerPayloadRefPath = (entryPath: string, logRoot: string) => (
  path.relative(logRoot, entryPath)
    .split(path.sep)
    .some(part => part.endsWith('.payloads'))
)

const findLoggerPayloadRefTargets = async (params: {
  logRoot: string
  payloadStoreRoot: string
}): Promise<string[]> => {
  const targets = new Set<string>()

  const visit = async (current: string) => {
    let entries: Dirent[]
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch {
      return
    }

    await Promise.all(entries.map(async (entry) => {
      const entryPath = path.resolve(current, entry.name)
      if (entry.isDirectory()) {
        await visit(entryPath)
        return
      }

      if (!entry.isSymbolicLink() || !isLoggerPayloadRefPath(entryPath, params.logRoot)) return

      try {
        const linkTarget = await fs.readlink(entryPath)
        const resolvedTarget = path.resolve(path.dirname(entryPath), linkTarget)
        if (!isPathInside(resolvedTarget, params.payloadStoreRoot)) return
        await fs.access(resolvedTarget, constants.F_OK)
        targets.add(resolvedTarget)
      } catch {
        // ignore dangling symlinks
      }
    }))
  }

  await visit(params.logRoot)
  return [...targets].sort((left, right) => left.localeCompare(right))
}

const collectLoggerPayloadReportTargets = async (cwd: string, env: NodeJS.ProcessEnv) => {
  const projectHomeLogsDir = resolveProjectHomePath(cwd, env, 'logs')
  const projectHomePayloadStoreDir = resolveProjectHomePath(cwd, env, 'caches', '.logger-payloads', 'sha256')
  const logRoots = new Set<string>()

  try {
    await fs.access(projectHomeLogsDir, constants.F_OK)
    logRoots.add(projectHomeLogsDir)
  } catch {
    // ignore missing project-home logs
  }
  const targets = await Promise.all([...logRoots].map(logRoot =>
    findLoggerPayloadRefTargets({
      logRoot,
      payloadStoreRoot: projectHomePayloadStoreDir
    })
  ))
  return [...new Set(targets.flat())].sort((left, right) => left.localeCompare(right))
}

export const collectReportTargets = async (
  cwd: string,
  env: NodeJS.ProcessEnv = mergeProcessEnvWithProjectEnv(undefined, { workspaceFolder: cwd })
) => {
  await migrateProjectHomeSegments(cwd, env, ['logs', 'caches', '.mock'])
  const availableTargets = await collectExistingTargets(cwd, env, REPORT_TARGETS)
  const loggerPayloadTargets = await collectLoggerPayloadReportTargets(cwd, env)
  availableTargets.push(
    ...loggerPayloadTargets.filter(target => !availableTargets.some(source => isPathInside(target, source)))
  )
  availableTargets.push(...await collectMockReportTargets(cwd, env))
  return availableTargets
}
