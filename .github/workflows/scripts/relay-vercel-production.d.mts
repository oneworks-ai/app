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
  buildLinkDir: string
  buildOutputDir: string
  deployLinkDir: string
  deployOutputDir: string
  relayDir: string
}

export function chooseCredentials(env: Record<string, string | undefined>): [string, string]
export function findProjectId(input: VercelProjectLookup): Promise<string>
export function selectProjectCandidate(env: Record<string, string | undefined>): string | undefined
