export const relayDocumentScopePathSegment = (value: string) => {
  const trimmed = value.trim()
  if (trimmed === '') throw new Error('Relay document scope id is required.')
  const segment = trimmed.replace(/[\\/\p{Cc}]/gu, '_')
  if (segment === '.' || segment === '..') {
    throw new Error('Relay document scope id cannot traverse directories.')
  }
  return segment
}

export const relayProjectRuleDocumentBasePayloadPath = (
  teamId: string,
  assignmentId: string
) => (
  `.oo/teams/${relayDocumentScopePathSegment(teamId)}/project-rules/${relayDocumentScopePathSegment(assignmentId)}`
)

export const relayProjectRuleDocumentDisplayPath = (
  teamId: string,
  assignmentId: string
) => `~/${relayProjectRuleDocumentBasePayloadPath(teamId, assignmentId)}`
