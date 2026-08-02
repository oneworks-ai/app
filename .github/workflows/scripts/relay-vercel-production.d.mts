export interface VercelProjectLookup {
  domain: string
  fetchImpl: (url: string, init: { headers: { Authorization: string } }) => Promise<{
    ok: boolean
    status?: number
    json: () => Promise<unknown>
  }>
  orgId: string
  token: string
}

export function getVercelLayout(workspaceRoot: string): {
  linkDir: string
  outputDir: string
  relayDir: string
  relayLinkDir: string
}

export function chooseCredentials(env: Record<string, string | undefined>): [string, string]
export function findProjectId(input: VercelProjectLookup): Promise<string>
export function selectProjectCandidate(
  env: Record<string, string | undefined>,
  usingDevFallback: boolean
): string | undefined
