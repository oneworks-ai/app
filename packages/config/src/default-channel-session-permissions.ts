import process from 'node:process'

import type { Config } from '@oneworks/types'
import { CHANNEL_SESSION_BUILTIN_PERMISSION_KEYS } from '@oneworks/utils'

import { mergeUniqueList } from './merge'

const CHANNEL_SESSION_ENV_KEYS = [
  '__ONEWORKS_PROJECT_CHANNEL_CONTEXT_PATH__',
  '__ONEWORKS_PROJECT_CHANNEL_TYPE__',
  '__ONEWORKS_PROJECT_CHANNEL_KEY__',
  '__ONEWORKS_PROJECT_CHANNEL_SESSION_TYPE__',
  '__ONEWORKS_PROJECT_CHANNEL_ID__'
] as const

const hasNonEmptyEnvValue = (
  env: Record<string, string | null | undefined>,
  key: string
) => {
  const value = env[key]
  return typeof value === 'string' && value.trim() !== ''
}

export const isChannelSessionRuntimeEnv = (
  env: Record<string, string | null | undefined> = process.env
) => CHANNEL_SESSION_ENV_KEYS.some(key => hasNonEmptyEnvValue(env, key))

const withChannelSessionBuiltInPermissions = (config: Config | undefined): Config => ({
  ...(config ?? {}),
  permissions: {
    ...(config?.permissions ?? {}),
    allow: mergeUniqueList(
      config?.permissions?.allow,
      [...CHANNEL_SESSION_BUILTIN_PERMISSION_KEYS]
    )
  }
})

export const mergeDefaultChannelSessionPermissions = (options: {
  env?: Record<string, string | null | undefined>
  projectConfig?: Config
  userConfig?: Config
}) => {
  if (!isChannelSessionRuntimeEnv(options.env ?? process.env)) {
    return [options.projectConfig, options.userConfig] as const
  }

  return [
    withChannelSessionBuiltInPermissions(options.projectConfig),
    options.userConfig
  ] as const
}
