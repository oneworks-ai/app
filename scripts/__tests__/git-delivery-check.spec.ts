import { describe, expect, it } from 'vitest'

import { evaluateGitDeliveryReadiness } from '../git-delivery-check'

const projectConfig = [
  'approval_policy = "on-request"',
  'approvals_reviewer = "auto_review"'
].join('\n')

describe('git-delivery check', () => {
  it('accepts an authenticated SSH delivery path with repository write access', () => {
    const result = evaluateGitDeliveryReadiness({
      ghAuthenticated: true,
      projectConfig,
      remoteUrl: 'git@github.com:oneworks-ai/app.git',
      repository: 'oneworks-ai/app',
      repositoryPermission: 'ADMIN',
      sshAuthenticated: true
    })

    expect(result.ok).toBe(true)
    expect(result.checks).toMatchObject({
      ghAuthenticated: true,
      projectAutoReviewConfigured: true,
      pullRequestWriteReady: true,
      pushReady: true,
      repository: 'oneworks-ai/app',
      repositoryPermission: 'ADMIN',
      sshAuthenticated: true,
      sshRequired: true
    })
    expect(result.violations).toEqual([])
  })

  it('reports every actionable permission-chain failure', () => {
    const result = evaluateGitDeliveryReadiness({
      ghAuthenticated: false,
      projectConfig: 'approval_policy = "never"',
      remoteUrl: 'git@github.com:oneworks-ai/app.git',
      repository: 'oneworks-ai/app',
      repositoryPermission: 'READ',
      sshAuthenticated: false
    })

    expect(result.ok).toBe(false)
    expect(result.violations).toEqual([
      'Project auto-review is not configured with approval_policy=on-request and approvals_reviewer=auto_review.',
      'GitHub CLI is not authenticated. Run gh auth login before starting delivery.',
      'GitHub CLI does not report write permission for oneworks-ai/app (permission: READ).',
      'The origin remote uses SSH, but GitHub SSH authentication is not ready.'
    ])
  })

  it('does not claim push readiness for an unverified HTTPS origin', () => {
    const result = evaluateGitDeliveryReadiness({
      ghAuthenticated: true,
      projectConfig,
      remoteUrl: 'https://github.com/oneworks-ai/app.git',
      repository: 'oneworks-ai/app',
      repositoryPermission: 'WRITE',
      sshAuthenticated: false
    })

    expect(result.ok).toBe(false)
    expect(result.checks.pushReady).toBe(false)
    expect(result.checks.sshRequired).toBe(false)
    expect(result.violations).toContain(
      'The origin remote is not SSH; this non-mutating check cannot verify HTTPS push credentials.'
    )
  })
})
