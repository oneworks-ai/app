import { describe, expect, it } from 'vitest'

import {
  parseGitHubRunId,
  resolveExternalDeploymentTarget
} from '../../.github/workflows/scripts/relay-external-production.mjs'

describe('relay external production workflow', () => {
  it('requires the external target as one atomic credential and routing tuple', () => {
    expect(() => resolveExternalDeploymentTarget({ GH_TOKEN: 'token' })).toThrow(
      'requires token, repository, and workflow'
    )
    expect(resolveExternalDeploymentTarget({
      GH_TOKEN: 'token',
      RELAY_SERVER_DEPLOY_REPOSITORY: 'owner/relay',
      RELAY_SERVER_DEPLOY_WORKFLOW: 'deploy.yml'
    })).toEqual({ repository: 'owner/relay', workflow: 'deploy.yml' })
  })

  it('accepts only an exact GitHub Actions run URL', () => {
    expect(parseGitHubRunId('https://github.com/owner/relay/actions/runs/123')).toBe('123')
    expect(() => parseGitHubRunId('not-a-run-url')).toThrow('Unable to resolve')
  })
})
