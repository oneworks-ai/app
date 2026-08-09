const writableRepositoryPermissions = new Set(['ADMIN', 'MAINTAIN', 'WRITE'])

export interface GitDeliveryReadinessFacts {
  ghIdentityVerified: boolean
  projectConfig?: string
  pushDryRunVerified: boolean
  remoteUrl?: string
  repository?: string
  repositoryAccessVerified: boolean
  repositoryPermission?: string
  targetRef?: string
}

export interface GitDeliveryReadinessResult {
  checks: {
    ghIdentityVerified: boolean
    projectFullAccessConfigured: boolean
    pullRequestWriteReady: boolean
    pushDryRunVerified: boolean
    pushReady: boolean
    repository?: string
    repositoryAccessVerified: boolean
    repositoryPermission?: string
    sshRequired: boolean
    targetRef?: string
  }
  ok: boolean
  recommendations: string[]
  violations: string[]
}

const hasProjectFullAccessConfig = (config: string | undefined) => (
  config != null &&
  /^\s*approval_policy\s*=\s*["']never["']\s*$/mu.test(config) &&
  /^\s*default_permissions\s*=\s*["']:danger-full-access["']\s*$/mu.test(config)
)

export const usesSshRemote = (remoteUrl: string | undefined) => (
  remoteUrl != null && /^(?:ssh:\/\/)?git@github\.com(?::|\/)/u.test(remoteUrl.trim())
)

export const evaluateGitDeliveryReadiness = (
  facts: GitDeliveryReadinessFacts
): GitDeliveryReadinessResult => {
  const projectFullAccessConfigured = hasProjectFullAccessConfig(facts.projectConfig)
  const repositoryPermission = facts.repositoryPermission?.toUpperCase()
  const hasRepositoryWrite = repositoryPermission != null &&
    writableRepositoryPermissions.has(repositoryPermission)
  const sshRequired = usesSshRemote(facts.remoteUrl)
  const pullRequestWriteReady = facts.ghIdentityVerified &&
    facts.repositoryAccessVerified && hasRepositoryWrite
  const pushReady = hasRepositoryWrite && sshRequired && facts.pushDryRunVerified
  const violations: string[] = []

  if (!projectFullAccessConfigured) {
    violations.push(
      'Project Full Access is not configured with approval_policy=never and default_permissions=:danger-full-access.'
    )
  }
  if (!facts.ghIdentityVerified) {
    violations.push('The authoritative GitHub API identity probe failed; stop and report a capability gap.')
  }
  if (facts.repository == null) {
    violations.push('The GitHub repository could not be resolved from --repository or the origin remote.')
  } else if (!facts.repositoryAccessVerified) {
    violations.push(`The authoritative GitHub API repository probe failed for ${facts.repository}.`)
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
    violations.push('The origin remote is not SSH; project delivery policy requires SSH transport.')
  }
  if (facts.targetRef == null) {
    violations.push('The current checkout has no named branch to use as the exact push target ref.')
  } else if (sshRequired && !facts.pushDryRunVerified) {
    violations.push(`The exact-ref push dry-run failed for ${facts.targetRef}.`)
  }

  return {
    checks: {
      ghIdentityVerified: facts.ghIdentityVerified,
      projectFullAccessConfigured,
      pullRequestWriteReady,
      pushDryRunVerified: facts.pushDryRunVerified,
      pushReady,
      repository: facts.repository,
      repositoryAccessVerified: facts.repositoryAccessVerified,
      repositoryPermission,
      sshRequired,
      targetRef: facts.targetRef
    },
    ok: violations.length === 0 && pullRequestWriteReady && pushReady,
    recommendations: [
      'This precheck validates static project config and authoritative Git transport/API probes; separately prove that the newly loaded operator applied Full Access.',
      'Use authenticated gh for PR writes when the GitHub Connector lacks write permission; Connector access is optional.'
    ],
    violations
  }
}
