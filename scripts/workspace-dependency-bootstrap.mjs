import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { acquireFallbackBootstrapLock } from './fallback-bootstrap-lock.mjs'
import { initializeRequiredSubmodules, requiredSubmodulesReady } from './workspace-submodule-bootstrap.mjs'

const DEFAULT_TIMEOUT_MS = 120_000
const bootstrapScriptPath = fileURLToPath(import.meta.url)

const successfulResult = () => ({
  error: undefined,
  status: 0,
  stderr: null,
  stdout: null
})

const requiredBinPaths = (repoRoot, name) => {
  const binPath = resolve(repoRoot, 'node_modules', '.bin', name)
  return process.platform === 'win32'
    ? [binPath, `${binPath}.cmd`, `${binPath}.exe`, `${binPath}.ps1`]
    : [binPath]
}

export const workspaceDependenciesReady = ({
  repoRoot,
  requiredBins = [],
  requiredPaths = [],
  requiredSubmodules = []
}) => (
  existsSync(resolve(repoRoot, 'node_modules', '.modules.yaml')) &&
  requiredBins.every(name => requiredBinPaths(repoRoot, name).some(existsSync)) &&
  requiredPaths.every(path => existsSync(resolve(repoRoot, path))) &&
  requiredSubmodulesReady(repoRoot, requiredSubmodules)
)

const runWorkspaceDependencyInstall = ({ quiet, repoRoot }) =>
  spawnSync('pnpm', ['install'], {
    cwd: repoRoot,
    env: process.env,
    stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  })

const installUnderLock = (options) => {
  if (workspaceDependenciesReady(options)) return successfulResult()
  const submoduleResult = initializeRequiredSubmodules(options)
  if (submoduleResult.error != null || submoduleResult.status !== 0) return submoduleResult
  if (workspaceDependenciesReady(options)) return successfulResult()
  if (!options.quiet) {
    console.error('[workspace] dependencies are missing; running pnpm install')
  }
  const result = runWorkspaceDependencyInstall(options)
  if (result.error != null || result.status !== 0) return result
  if (workspaceDependenciesReady(options)) return result
  if (!options.quiet) {
    console.error('[workspace] pnpm install completed without the required workspace dependencies')
  }
  return { ...result, status: 1 }
}

const serializeBootstrapOptions = (options) => [
  '--bootstrap-child',
  '--repo-root',
  options.repoRoot,
  ...(options.quiet ? ['--quiet'] : []),
  ...options.requiredBins.flatMap(name => ['--require-bin', name]),
  ...options.requiredPaths.flatMap(path => ['--require-path', path]),
  ...options.requiredSubmodules.flatMap(({ path, requiredPath }) => [
    '--require-submodule',
    path,
    requiredPath
  ])
]

export const ensureWorkspaceDependencies = ({
  quiet = false,
  repoRoot,
  requiredBins = [],
  requiredPaths = [],
  requiredSubmodules = [],
  timeoutMs = DEFAULT_TIMEOUT_MS
}) => {
  const options = { quiet, repoRoot, requiredBins, requiredPaths, requiredSubmodules }
  if (workspaceDependenciesReady(options)) return successfulResult()

  const lockDir = resolve(repoRoot, '.logs')
  const lockPath = resolve(lockDir, 'run-tools-bootstrap.guard')
  mkdirSync(lockDir, { recursive: true })
  const command = process.platform === 'darwin'
    ? '/usr/bin/lockf'
    : process.platform === 'linux'
    ? 'flock'
    : null
  if (command != null) {
    const timeoutSeconds = String(Math.ceil(timeoutMs / 1_000))
    const lockArgs = process.platform === 'darwin'
      ? ['-k', '-t', timeoutSeconds, lockPath]
      : ['-w', timeoutSeconds, lockPath]
    return spawnSync(
      command,
      [
        ...lockArgs,
        process.execPath,
        bootstrapScriptPath,
        ...serializeBootstrapOptions(options)
      ],
      {
        cwd: repoRoot,
        env: process.env,
        stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit'
      }
    )
  }

  const release = acquireFallbackBootstrapLock(lockPath, timeoutMs)
  try {
    return installUnderLock(options)
  } finally {
    release()
  }
}

const parseBootstrapChildOptions = (args) => {
  const options = {
    quiet: false,
    repoRoot: undefined,
    requiredBins: [],
    requiredPaths: [],
    requiredSubmodules: []
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--quiet') {
      options.quiet = true
      continue
    }
    if (arg === '--repo-root') {
      options.repoRoot = args[index + 1]
      index += 1
      continue
    }
    if (arg === '--require-bin') {
      options.requiredBins.push(args[index + 1])
      index += 1
      continue
    }
    if (arg === '--require-path') {
      options.requiredPaths.push(args[index + 1])
      index += 1
      continue
    }
    if (arg === '--require-submodule') {
      options.requiredSubmodules.push({
        path: args[index + 1],
        requiredPath: args[index + 2]
      })
      index += 2
      continue
    }
    throw new Error(`Unknown workspace bootstrap argument: ${arg}`)
  }
  if (options.repoRoot == null) throw new Error('Workspace bootstrap requires --repo-root.')
  return options
}

if (process.argv[1] === bootstrapScriptPath && process.argv[2] === '--bootstrap-child') {
  try {
    const result = installUnderLock(parseBootstrapChildOptions(process.argv.slice(3)))
    if (result.error != null) throw result.error
    process.exit(result.status ?? 1)
  } catch (error) {
    console.error(error)
    process.exit(1)
  }
}
