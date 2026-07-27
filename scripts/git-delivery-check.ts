import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

import { evaluateGitDeliveryReadiness, usesSshRemote } from './git-delivery-readiness'
import type { GitDeliveryReadinessResult } from './git-delivery-readiness'

export { evaluateGitDeliveryReadiness } from './git-delivery-readiness'
export type { GitDeliveryReadinessFacts, GitDeliveryReadinessResult } from './git-delivery-readiness'

export interface RunGitDeliveryCheckInput {
  cwd?: string
  json?: boolean
  repository?: string
}

interface CommandResult {
  output: string
  status: number | null
}

const runCommand = (
  command: string,
  args: string[],
  cwd: string
): CommandResult => {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout: 10_000
  })

  return {
    output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim(),
    status: result.status
  }
}

const resolveRepositoryFromRemote = (remoteUrl: string | undefined) => {
  if (remoteUrl == null) return undefined
  const match = /github\.com(?::|\/)([^/\s]+\/[^/\s]+?)(?:\.git)?$/u.exec(remoteUrl.trim())
  return match?.[1]
}

const readProjectConfig = (root: string) => {
  try {
    return readFileSync(join(root, '.codex/config.toml'), 'utf8')
  } catch {
    return undefined
  }
}

const readRepositoryPermission = (
  cwd: string,
  repository: string | undefined,
  ghAuthenticated: boolean
) => {
  if (!ghAuthenticated || repository == null) return undefined
  const result = runCommand('gh', ['repo', 'view', repository, '--json', 'viewerPermission'], cwd)
  if (result.status !== 0) return undefined

  try {
    const parsed = JSON.parse(result.output) as {
      viewerPermission?: string
    }
    return parsed.viewerPermission
  } catch {
    return undefined
  }
}

export const inspectGitDeliveryReadiness = (
  input: RunGitDeliveryCheckInput = {}
): GitDeliveryReadinessResult => {
  const cwd = input.cwd ?? process.cwd()
  const rootResult = runCommand('git', ['rev-parse', '--show-toplevel'], cwd)
  const root = rootResult.status === 0 ? rootResult.output : cwd
  const remoteResult = runCommand('git', ['remote', 'get-url', 'origin'], root)
  const remoteUrl = remoteResult.status === 0 ? remoteResult.output : undefined
  const repository = input.repository ?? resolveRepositoryFromRemote(remoteUrl)
  const ghAuthResult = runCommand('gh', ['auth', 'status'], root)
  const ghAuthenticated = ghAuthResult.status === 0
  const sshResult = usesSshRemote(remoteUrl)
    ? runCommand(
      'ssh',
      ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', 'git@github.com'],
      root
    )
    : undefined
  const sshAuthenticated = sshResult != null &&
    /successfully authenticated/iu.test(sshResult.output)

  return evaluateGitDeliveryReadiness({
    ghAuthenticated,
    projectConfig: readProjectConfig(root),
    remoteUrl,
    repository,
    repositoryPermission: readRepositoryPermission(root, repository, ghAuthenticated),
    sshAuthenticated
  })
}

export const runGitDeliveryCheck = async (input: RunGitDeliveryCheckInput = {}) => {
  const result = inspectGitDeliveryReadiness(input)

  if (input.json === true) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } else {
    console.log(result.ok ? '[git-delivery check] ok' : '[git-delivery check] failed')
    console.log(
      `- project auto-review: ${result.checks.projectAutoReviewConfigured ? 'configured' : 'not configured'}`
    )
    console.log(`- gh authentication: ${result.checks.ghAuthenticated ? 'ready' : 'not ready'}`)
    console.log(
      `- repository permission: ${result.checks.repositoryPermission ?? 'unknown'}`
    )
    console.log(
      `- SSH authentication: ${
        result.checks.sshRequired
          ? (result.checks.sshAuthenticated ? 'ready' : 'not ready')
          : 'not required'
      }`
    )
    for (const violation of result.violations) {
      console.error(`- ${violation}`)
    }
  }

  if (!result.ok) {
    process.exitCode = 1
  }
}
