import type { PluginManifest } from '@oneworks/types'
import type { PluginRuntimeInstance } from './types.js'

export type FirstPartyPluginCapability = 'oneworksChannel' | 'roomRelay'

export const hasFirstPartyPluginCapability = (
  instance: Pick<PluginRuntimeInstance, 'sourceGroup'>,
  manifest: PluginManifest,
  capability: FirstPartyPluginCapability
) =>
  instance.sourceGroup === 'builtIn' &&
  manifest.plugin?.server?.capabilities?.includes(capability) === true
