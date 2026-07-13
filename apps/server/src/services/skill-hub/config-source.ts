import { basename } from 'node:path'

import type { ConfigSource, ResolvedConfigState } from '@oneworks/config'
import { resolveWritableConfigPath } from '@oneworks/config'

export const toConfigLabel = (workspaceFolder: string, configSource: ConfigSource) => (
  configSource === 'global'
    ? '~/.oneworks/.oo.config.json'
    : basename(resolveWritableConfigPath(workspaceFolder, configSource))
)

export const getSourceConfig = (state: ResolvedConfigState, configSource: ConfigSource) => {
  switch (configSource) {
    case 'global':
      return state.globalConfig
    case 'project':
      return state.projectSource?.resolvedConfig
    case 'user':
      return state.userConfig
  }
}

export const getRawSourceConfig = (state: ResolvedConfigState, configSource: ConfigSource) => {
  switch (configSource) {
    case 'global':
      return state.globalSource?.rawConfig
    case 'project':
      return state.projectSource?.rawConfig
    case 'user':
      return state.userSource?.rawConfig
  }
}

export const getResolvedSourceConfig = (state: ResolvedConfigState, configSource: ConfigSource) => {
  switch (configSource) {
    case 'global':
      return state.globalSource?.resolvedConfig
    case 'project':
      return state.projectSource?.resolvedConfig
    case 'user':
      return state.userSource?.resolvedConfig
  }
}
