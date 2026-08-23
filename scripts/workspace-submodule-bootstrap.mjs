import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

const successfulResult = () => ({
  error: undefined,
  status: 0,
  stderr: null,
  stdout: null
})

export const requiredSubmodulesReady = (repoRoot, requiredSubmodules = []) =>
  requiredSubmodules.every(({ requiredPath }) => existsSync(resolve(repoRoot, requiredPath)))

export const initializeRequiredSubmodules = (options) => {
  const missingSubmodules = options.requiredSubmodules.filter(({ requiredPath }) =>
    !existsSync(resolve(options.repoRoot, requiredPath))
  )
  if (missingSubmodules.length === 0) return successfulResult()
  if (!existsSync(resolve(options.repoRoot, '.gitmodules'))) {
    if (!options.quiet) console.error('[workspace] required submodules are missing')
    return { ...successfulResult(), status: 1 }
  }

  const result = spawnSync(
    'git',
    [
      'submodule',
      'update',
      '--init',
      '--depth',
      '1',
      '--',
      ...missingSubmodules.map(({ path }) => path)
    ],
    {
      cwd: options.repoRoot,
      env: process.env,
      stdio: options.quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit'
    }
  )
  if (
    result.error == null &&
    result.status === 0 &&
    requiredSubmodulesReady(options.repoRoot, missingSubmodules)
  ) return result
  if (!options.quiet) console.error('[workspace] required submodule bootstrap failed')
  return { ...result, status: result.status ?? 1 }
}
