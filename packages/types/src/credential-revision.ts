export interface CredentialRevision {
  counter: number
  id: string
}

const CREDENTIAL_REVISION_PATTERN = /^(\d+):([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})$/iu

export const parseCredentialRevision = (value: unknown): CredentialRevision | undefined => {
  if (typeof value !== 'string') return undefined
  const match = CREDENTIAL_REVISION_PATTERN.exec(value.trim())
  if (match == null) return undefined

  const counter = Number(match[1])
  if (!Number.isSafeInteger(counter) || counter < 0) return undefined
  return {
    counter,
    id: match[2]!.toLowerCase()
  }
}

export const normalizeCredentialRevision = (value: unknown) => {
  const revision = parseCredentialRevision(value)
  return revision == null ? undefined : `${revision.counter}:${revision.id}`
}

export const isCredentialRevision = (value: unknown): value is string => (
  parseCredentialRevision(value) != null
)

export const compareCredentialRevisions = (left: unknown, right: unknown) => {
  const leftRevision = parseCredentialRevision(left)
  const rightRevision = parseCredentialRevision(right)
  if (leftRevision == null) return rightRevision == null ? 0 : -1
  if (rightRevision == null) return 1
  if (leftRevision.counter !== rightRevision.counter) {
    return leftRevision.counter < rightRevision.counter ? -1 : 1
  }
  return leftRevision.id.localeCompare(rightRevision.id)
}
