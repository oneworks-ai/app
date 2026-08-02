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

export function chooseCredentials(env: Record<string, string | undefined>): [string, string]
export function findProjectId(input: VercelProjectLookup): Promise<string>
