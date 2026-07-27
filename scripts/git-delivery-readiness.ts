const writableRepositoryPermissions = new Set(['ADMIN', 'MAINTAIN', 'WRITE'])

export interface GitDeliveryReadinessFacts {
  ghAuthenticated: boolean
  projectConfig?: string
  remoteUrl?: string
  repository?: string
  repositoryPermission?: string
  sshAuthenticated: boolean
}

export interface GitDeliveryReadinessResult {
  checks: {
    ghAuthenticated: boolean
    projectAutoReviewConfigured: boolean
    pullRequestWriteReady: boolean
    pushReady: boolean
    repository?: string
    repositoryPermission?: string
    sshAuthenticated: boolean
    sshRequired: boolean
  }
  ok: boolean
  recommendations: string[]
  violations: string[]
}

const hasProjectAutoReviewConfig = (config: string | undefined) => (
  config != null &&
  /^\s*approval_policy\s*=\s*["']on-request["']\s*$/mu.test(config) &&
  /^\s*approvals_reviewer\s*=\s*["']auto_review["']\s*$/mu.test(config)
)

export const usesSshRemote = (remoteUrl: string | undefined) => (
  remoteUrl != null && /^(?:ssh:\/\/)?git@github\.com(?::|\/)/u.test(remoteUrl.trim())
)

export const evaluateGitDeliveryReadiness = (
  facts: GitDeliveryReadinessFacts
): GitDeliveryReadinessResult => {
  const projectAutoReviewConfigured = hasProjectAutoReviewConfig(facts.projectConfig)
  const repositoryPermission = facts.repositoryPermission?.toUpperCase()
  const hasRepositoryWrite = repositoryPermission != null &&
    writableRepositoryPermissions.has(repositoryPermission)
  const sshRequired = usesSshRemote(facts.remoteUrl)
  const pullRequestWriteReady = facts.ghAuthenticated && hasRepositoryWrite
  const pushReady = hasRepositoryWrite && sshRequired && facts.sshAuthenticated
  const violations: string[] = []

  if (!projectAutoReviewConfigured) {
    violations.push(
      'Project auto-review is not configured with approval_policy=on-request and approvals_reviewer=auto_review.'
    )
  }
  if (!facts.ghAuthenticated) {
    violations.push('GitHub CLI is not authenticated. Run gh auth login before starting delivery.')
  }
  if (facts.repository == null) {
    violations.push('The GitHub repository could not be resolved from --repository or the origin remote.')
  } else if (!hasRepositoryWrite) {
    violations.push(
      `GitHub CLI does not report write permission for ${facts.repository} (permission: ${
        repositoryPermission ?? 'unknown'
      }).`
    )
  }
  if (facts.remoteUrl == null) {
    violations.push('The origin remote could not be resolved.')
  } else if (!sshRequired) {
    violations.push(
      'The origin remote is not SSH; this non-mutating check cannot verify HTTPS push credentials.'
    )
  }
  if (sshRequired && !facts.sshAuthenticated) {
    violations.push('The origin remote uses SSH, but GitHub SSH authentication is not ready.')
  }

  return {
    checks: {
      ghAuthenticated: facts.ghAuthenticated,
      projectAutoReviewConfigured,
      pullRequestWriteReady,
      pushReady,
      repository: facts.repository,
      repositoryPermission,
      sshAuthenticated: facts.sshAuthenticated,
      sshRequired
    },
    ok: violations.length === 0 && pullRequestWriteReady && pushReady,
    recommendations: [
      'Run delivery writes from a newly loaded project task so .codex/config.toml is effective.',
      'Use authenticated gh for PR writes when the GitHub Connector lacks write permission; Connector access is optional.'
    ],
    violations
  }
}
