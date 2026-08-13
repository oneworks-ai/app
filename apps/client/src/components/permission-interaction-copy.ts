import type { TFunction } from 'i18next'

import type {
  InteractionOption,
  PermissionInteractionOptionPresentation,
  PermissionInteractionOptionSemantic
} from '@oneworks/types'

const frameworkPermissionSemantics = new Set<PermissionInteractionOptionSemantic>([
  'allow_once',
  'allow_session',
  'allow_project',
  'deny_once',
  'deny_session',
  'deny_project'
])

const legacyPermissionSemantics = new Set<PermissionInteractionOptionSemantic>([
  'allow_once',
  'allow_session',
  'allow_project',
  'deny_once',
  'deny_session',
  'deny_project'
])

export const getPermissionInteractionOptionSemantic = (
  option: Pick<InteractionOption, 'permission' | 'value'>
): PermissionInteractionOptionSemantic | undefined => {
  if (option.permission != null) return option.permission.semantic
  const value = option.value as PermissionInteractionOptionSemantic | undefined
  return value != null && legacyPermissionSemantics.has(value) ? value : undefined
}

export const getPermissionInteractionOptionMeta = (
  option: Pick<InteractionOption, 'permission' | 'value'>
) => {
  const semantic = getPermissionInteractionOptionSemantic(option)
  switch (semantic) {
    case 'allow_once':
      return { icon: 'task_alt', primary: true, semantic, tone: 'allow' as const }
    case 'allow_session':
      return { icon: 'history_toggle_off', primary: true, semantic, tone: 'allow' as const }
    case 'allow_project':
      return { icon: 'folder_managed', primary: false, semantic, tone: 'allow' as const }
    case 'deny_once':
      return { icon: 'cancel', primary: true, semantic, tone: 'deny' as const }
    case 'deny_session':
      return { icon: 'block', primary: false, semantic, tone: 'deny' as const }
    case 'deny_project':
      return { icon: 'folder_off', primary: false, semantic, tone: 'deny' as const }
    case 'allow_persistent':
      return { icon: 'verified_user', primary: false, semantic, tone: 'allow' as const }
    case 'deny_persistent':
      return { icon: 'gpp_bad', primary: false, semantic, tone: 'deny' as const }
    case 'native_unknown':
      return { icon: 'help', primary: false, semantic, tone: 'neutral' as const }
    default:
      return { icon: 'help', primary: false, semantic: undefined, tone: 'neutral' as const }
  }
}

const getPresentation = (option: InteractionOption): PermissionInteractionOptionPresentation | undefined => {
  if (option.permission != null) return option.permission
  const semantic = getPermissionInteractionOptionSemantic(option)
  return semantic != null && frameworkPermissionSemantics.has(semantic) ? { semantic } : undefined
}

export const resolvePermissionInteractionOptionCopy = (
  option: InteractionOption,
  t: TFunction
) => {
  const presentation = getPresentation(option)
  if (presentation == null) return { description: option.description, label: option.label }

  const key = `chat.permissionOptions.${presentation.semantic}`
  const interpolation = {
    adapter: presentation.adapterLabel ?? t('chat.permissionOptions.nativeAdapter'),
    nativeLabel: presentation.nativeLabel ?? option.label
  }
  return {
    label: t(`${key}.label`, interpolation),
    description: t(`${key}.description`, interpolation)
  }
}
