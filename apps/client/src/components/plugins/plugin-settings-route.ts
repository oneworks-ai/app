export type PluginSnapshotStatus = 'error' | 'loading' | 'ready'

export const isPluginSettingsTabKey = (tabKey: string) => tabKey.startsWith('plugin:')

export const resolveSettingsTabKey = ({
  availableTabKeys,
  requestedTabKey,
  snapshotStatus
}: {
  availableTabKeys: ReadonlySet<string>
  requestedTabKey: string
  snapshotStatus: PluginSnapshotStatus
}) => {
  if (availableTabKeys.has(requestedTabKey)) return requestedTabKey
  if (isPluginSettingsTabKey(requestedTabKey)) {
    return snapshotStatus === 'loading' ? requestedTabKey : 'plugins'
  }
  return 'general'
}
