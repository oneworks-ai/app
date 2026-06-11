import type { ChatSessionTargetType } from '#~/hooks/chat/chat-session-target'

export type SelectableTargetType = Exclude<ChatSessionTargetType, 'default'>

export const sessionTargetModeIcons: Record<ChatSessionTargetType, string> = {
  default: 'radio_button_checked',
  workspace: 'workspaces',
  entity: 'group_work',
  spec: 'account_tree'
}

export const selectableSessionTargetTypes: SelectableTargetType[] = ['workspace', 'entity', 'spec']
export const sessionTargetMenuKeySeparator = '::'
