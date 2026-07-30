import type { ReactNode } from 'react'

export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'dontAsk' | 'bypassPermissions'
export type PermissionModeRiskLevel = 'high' | 'critical'

export interface PermissionModeOption {
  value: PermissionMode
  label: ReactNode
  description?: ReactNode
}

export const isPermissionMode = (value: string): value is PermissionMode => {
  return value === 'default' ||
    value === 'acceptEdits' ||
    value === 'plan' ||
    value === 'dontAsk' ||
    value === 'bypassPermissions'
}

export const isHighRiskPermissionMode = (
  value: string
): value is Extract<PermissionMode, 'dontAsk' | 'bypassPermissions'> => {
  return value === 'dontAsk' || value === 'bypassPermissions'
}

export const getPermissionModeRiskLevel = (
  mode: PermissionMode
): PermissionModeRiskLevel | undefined => {
  if (mode === 'dontAsk') return 'high'
  if (mode === 'bypassPermissions') return 'critical'
  return undefined
}

export const buildPermissionModeOptions = (
  t: (key: string) => string
): PermissionModeOption[] => [
  {
    value: 'default',
    label: t('chat.permissionModes.default.label'),
    description: t('chat.permissionModes.default.description')
  },
  {
    value: 'acceptEdits',
    label: t('chat.permissionModes.acceptEdits.label'),
    description: t('chat.permissionModes.acceptEdits.description')
  },
  {
    value: 'plan',
    label: t('chat.permissionModes.plan.label'),
    description: t('chat.permissionModes.plan.description')
  },
  {
    value: 'dontAsk',
    label: t('chat.permissionModes.dontAsk.label'),
    description: t('chat.permissionModes.dontAsk.description')
  },
  {
    value: 'bypassPermissions',
    label: t('chat.permissionModes.bypassPermissions.label'),
    description: t('chat.permissionModes.bypassPermissions.description')
  }
]
