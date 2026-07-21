import { composeWorkspaceConfigSchemaBundle } from '@oneworks/config'
import type { Config } from '@oneworks/types'
import { resolveAdapterRuntimeTarget } from '@oneworks/types'
import { resolveSelectableAdapterKeys } from '@oneworks/utils'

export const resolveSelectableAdapterRuntimeTargets = async (params: {
  config: Config
  workspaceFolder: string
}) => {
  const schemaBundle = await composeWorkspaceConfigSchemaBundle({ cwd: params.workspaceFolder })
  return resolveSelectableAdapterKeys({
    configuredAdapters: [
      ...Object.keys(params.config.adapters ?? {}),
      ...schemaBundle.extensions.adapters
    ],
    defaultAdapter: params.config.defaultAdapter
  }).map(adapterKey =>
    resolveAdapterRuntimeTarget(adapterKey, {
      config: params.config,
      cwd: params.workspaceFolder
    })
  )
}
