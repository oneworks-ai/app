export function resolveExternalDeploymentTarget(env: Record<string, string | undefined>): {
  repository: string
  workflow: string
}

export function parseGitHubRunId(runUrl: string): string
