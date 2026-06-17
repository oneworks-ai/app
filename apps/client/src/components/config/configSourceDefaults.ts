import type { ConfigSource } from '@oneworks/core'

interface ConfigPresentState {
  global?: boolean
  project?: boolean
  user?: boolean
}

export const getPreferredConfigSourceForTab = (tabKey: string): ConfigSource | undefined => {
  if (tabKey === 'modelServices') return 'global'
  return undefined
}

export const resolveConfigSourceForMissingQuery = (
  tabKey: string,
  configPresent?: ConfigPresentState
): ConfigSource => {
  const preferredSource = getPreferredConfigSourceForTab(tabKey)
  if (preferredSource != null) return preferredSource

  if (configPresent?.project === true) return 'project'
  if (configPresent?.user === true) return 'user'
  if (configPresent?.global === true) return 'global'
  return 'project'
}
