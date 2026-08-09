import { describe, expect, it } from 'vitest'

import { buildPushDryRunArgs, evaluateGitDeliveryReadiness } from '../git-delivery-check'

const projectConfig = [
  'approval_policy = "never"',
  'default_permissions = ":danger-full-access"'
].join('\n')

describe('git-delivery check', () => {
  it('builds a hook-free exact-ref push dry-run', () => {
    expect(buildPushDryRunArgs('refs/heads/codex/channel-runtime-v2-final')).toEqual([
      'push',
      '--dry-run',
      '--no-verify',
      '--no-recurse-submodules',
      '--porcelain',
      'origin',
      'HEAD:refs/heads/codex/channel-runtime-v2-final'
    ])
  })

  it('accepts an authenticated SSH delivery path with repository write access', () => {
    const result = evaluateGitDeliveryReadiness({
      ghIdentityVerified: true,
      projectConfig,
      pushDryRunVerified: true,
      remoteUrl: 'git@github.com:oneworks-ai/app.git',
      repository: 'oneworks-ai/app',
      repositoryAccessVerified: true,
      repositoryPermission: 'ADMIN',
      targetRef: 'refs/heads/codex/channel-runtime-v2-final'
    })

    expect(result.ok).toBe(true)
    expect(result.checks).toMatchObject({
      ghIdentityVerified: true,
      projectFullAccessConfigured: true,
      pullRequestWriteReady: true,
      pushDryRunVerified: true,
      pushReady: true,
      repository: 'oneworks-ai/app',
      repositoryAccessVerified: true,
      repositoryPermission: 'ADMIN',
      sshRequired: true,
      targetRef: 'refs/heads/codex/channel-runtime-v2-final'
    })
    expect(result.violations).toEqual([])
  })

  it('reports every actionable permission-chain failure', () => {
    const result = evaluateGitDeliveryReadiness({
      ghIdentityVerified: false,
      projectConfig: 'approval_policy = "never"',
      pushDryRunVerified: false,
      remoteUrl: 'git@github.com:oneworks-ai/app.git',
      repository: 'oneworks-ai/app',
      repositoryAccessVerified: false,
      repositoryPermission: 'READ',
      targetRef: 'refs/heads/codex/channel-runtime-v2-final'
    })

    expect(result.ok).toBe(false)
    expect(result.violations).toEqual([
      'Project Full Access is not configured with approval_policy=never and default_permissions=:danger-full-access.',
      'The authoritative GitHub API identity probe failed; stop and report a capability gap.',
      'The authoritative GitHub API repository probe failed for oneworks-ai/app.',
      'The exact-ref push dry-run failed for refs/heads/codex/channel-runtime-v2-final.'
    ])
  })

  it('does not claim push readiness for an unverified HTTPS origin', () => {
    const result = evaluateGitDeliveryReadiness({
      ghIdentityVerified: true,
      projectConfig,
      pushDryRunVerified: false,
      remoteUrl: 'https://github.com/oneworks-ai/app.git',
      repository: 'oneworks-ai/app',
      repositoryAccessVerified: true,
      repositoryPermission: 'WRITE',
      targetRef: 'refs/heads/codex/channel-runtime-v2-final'
    })

    expect(result.ok).toBe(false)
    expect(result.checks.pushReady).toBe(false)
    expect(result.checks.sshRequired).toBe(false)
    expect(result.violations).toContain(
      'The origin remote is not SSH; project delivery policy requires SSH transport.'
    )
  })
})
