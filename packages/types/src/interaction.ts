export type PermissionInteractionOptionSemantic =
  | PermissionInteractionDecision
  | 'allow_persistent'
  | 'deny_persistent'
  | 'native_unknown'

export interface PermissionInteractionOptionPresentation {
  adapterLabel?: string
  nativeLabel?: string
  semantic: PermissionInteractionOptionSemantic
}

const permissionInteractionOptionSemantics = new Set<PermissionInteractionOptionSemantic>([
  'allow_once',
  'allow_session',
  'allow_project',
  'deny_once',
  'deny_session',
  'deny_project',
  'allow_persistent',
  'deny_persistent',
  'native_unknown'
])

export const normalizePermissionInteractionOptionPresentation = (
  value: unknown
): PermissionInteractionOptionPresentation | undefined => {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const candidate = value as Record<string, unknown>
  if (
    typeof candidate.semantic !== 'string' ||
    !permissionInteractionOptionSemantics.has(candidate.semantic as PermissionInteractionOptionSemantic)
  ) return undefined
  const adapterLabel = typeof candidate.adapterLabel === 'string' && candidate.adapterLabel.trim() !== ''
    ? candidate.adapterLabel.trim()
    : undefined
  const nativeLabel = typeof candidate.nativeLabel === 'string' && candidate.nativeLabel.trim() !== ''
    ? candidate.nativeLabel.trim()
    : undefined
  return {
    semantic: candidate.semantic as PermissionInteractionOptionSemantic,
    ...(adapterLabel != null ? { adapterLabel } : {}),
    ...(nativeLabel != null ? { nativeLabel } : {})
  }
}

export interface InteractionOption {
  label: string
  value?: string
  description?: string
  permission?: PermissionInteractionOptionPresentation
}

export type InteractionResponseData = string | string[]

export type InteractionResponseHandler = (
  id: string,
  data: InteractionResponseData
) => void | Promise<void>

export type PermissionInteractionDecision =
  | 'allow_once'
  | 'allow_session'
  | 'allow_project'
  | 'deny_once'
  | 'deny_session'
  | 'deny_project'

export interface PermissionInteractionContext {
  adapter?: string
  currentMode?: 'default' | 'acceptEdits' | 'plan' | 'dontAsk' | 'bypassPermissions'
  suggestedMode?: 'default' | 'acceptEdits' | 'plan' | 'dontAsk' | 'bypassPermissions'
  deniedTools?: string[]
  reasons?: string[]
  subjectKey?: string
  subjectLookupKeys?: string[]
  subjectLabel?: string
  scope?: 'tool'
  projectConfigPath?: string
}

export interface AskUserQuestionParams {
  sessionId: string
  question: string
  defaultValue?: string | string[]
  options?: InteractionOption[]
  multiselect?: boolean
  kind?: 'question' | 'permission'
  permissionContext?: PermissionInteractionContext
}
