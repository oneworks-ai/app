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

export const buildPushDryRunArgs = (targetRef: string) => [
  'push',
  '--dry-run',
  '--no-verify',
  '--no-recurse-submodules',
  '--porcelain',
  'origin',
  `HEAD:${targetRef}`
]

const readRepositoryAccess = (
  cwd: string,
  repository: string | undefined,
  ghIdentityVerified: boolean
) => {
  if (!ghIdentityVerified || repository == null) {
    return { permission: undefined, verified: false }
  }
  const result = runCommand('gh', ['api', `repos/${repository}`], cwd)
  if (result.status !== 0) return { permission: undefined, verified: false }

  try {
    const parsed = JSON.parse(result.output) as {
      permissions?: {
        admin?: boolean
        maintain?: boolean
        pull?: boolean
        push?: boolean
        triage?: boolean
      }
    }
    const permission = parsed.permissions?.admin
      ? 'ADMIN'
      : parsed.permissions?.maintain
      ? 'MAINTAIN'
      : parsed.permissions?.push
      ? 'WRITE'
      : parsed.permissions?.triage
      ? 'TRIAGE'
      : parsed.permissions?.pull
      ? 'READ'
      : undefined
    return { permission, verified: true }
  } catch {
    return { permission: undefined, verified: false }
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
  const ghIdentityResult = runCommand('gh', ['api', 'user', '--jq', '.login'], root)
  const ghIdentityVerified = ghIdentityResult.status === 0 && ghIdentityResult.output.length > 0
  const repositoryAccess = readRepositoryAccess(root, repository, ghIdentityVerified)
  const branchResult = runCommand('git', ['branch', '--show-current'], root)
  const branch = branchResult.status === 0 ? branchResult.output.trim() : ''
  const targetRef = branch.length > 0 ? `refs/heads/${branch}` : undefined
  const pushDryRunResult = usesSshRemote(remoteUrl) && targetRef != null
    ? runCommand(
      'git',
      buildPushDryRunArgs(targetRef),
      root
    )
    : undefined

  return evaluateGitDeliveryReadiness({
    ghIdentityVerified,
    projectConfig: readProjectConfig(root),
    pushDryRunVerified: pushDryRunResult?.status === 0,
    remoteUrl,
    repository,
    repositoryAccessVerified: repositoryAccess.verified,
    repositoryPermission: repositoryAccess.permission,
    targetRef
  })
}

export const runGitDeliveryCheck = async (input: RunGitDeliveryCheckInput = {}) => {
  const result = inspectGitDeliveryReadiness(input)

  if (input.json === true) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } else {
    console.log(result.ok ? '[git-delivery check] ok' : '[git-delivery check] failed')
    console.log(
      `- project Full Access: ${result.checks.projectFullAccessConfigured ? 'configured' : 'not configured'}`
    )
    console.log(`- GitHub API identity: ${result.checks.ghIdentityVerified ? 'verified' : 'not verified'}`)
    console.log(
      `- repository permission: ${result.checks.repositoryPermission ?? 'unknown'}`
    )
    console.log(
      `- exact-ref push dry-run: ${result.checks.pushDryRunVerified ? 'verified' : 'not verified'}`
    )
    for (const violation of result.violations) {
      console.error(`- ${violation}`)
    }
  }

  if (!result.ok) {
    process.exitCode = 1
  }
}
