import type { StartupProfiler } from '@oneworks/utils'

import type { HookContext, Plugin } from './context'
import type { HookInputs, HookOutputs } from './type'

interface HookProfileOptions {
  profiler?: StartupProfiler
  profilePrefix?: string
}

export const callPluginHook = async <K extends keyof HookInputs>(
  eventName: K,
  context: HookContext,
  input: HookInputs[K],
  plugins: Partial<Plugin>[] = [],
  profileOptions: HookProfileOptions = {}
): Promise<HookOutputs[K]> => {
  const { logger } = context
  const filterPluginsStartedAt = profileOptions.profiler?.now()
  const filteredPlugins = plugins.filter(
    (
      item
    ): item is
      & {
        name?: string
      }
      & {
        [P in K]: NonNullable<Plugin[P]>
      } => !!item && !!item[eventName]
  )
  if (filterPluginsStartedAt != null) {
    profileOptions.profiler?.mark(
      `${profileOptions.profilePrefix ?? `hook.${String(eventName)}`}.callPlugins.filter`,
      filterPluginsStartedAt,
      {
        matchedCount: filteredPlugins.length,
        totalCount: plugins.length
      }
    )
  }

  let index = 0

  const next = async (): Promise<HookOutputs[K]> => {
    if (index >= filteredPlugins.length) {
      return { continue: true }
    }

    const currentPlugin = filteredPlugins[index]
    const name = currentPlugin.name ?? '<anonymous>'
    const pluginIndex = index
    const hook = currentPlugin[eventName] as (
      ctx: HookContext,
      input: HookInputs[K],
      next: () => Promise<HookOutputs[K]>
    ) => Promise<HookOutputs[K]>
    index++

    const withNameLogger = {
      ...logger,
      info: logger.info.bind(logger, `[plugin.${name}]`),
      warn: logger.warn.bind(logger, `[plugin.${name}]`),
      debug: logger.debug.bind(logger, `[plugin.${name}]`),
      error: logger.error.bind(logger, `[plugin.${name}]`)
    }
    const pluginProfileName = `${
      profileOptions.profilePrefix ?? `hook.${String(eventName)}`
    }.plugin.${pluginIndex}.${name}`
    const totalStartedAt = profileOptions.profiler?.now()
    let failed = false
    let nextCallCount = 0
    const timedNext = async () => {
      nextCallCount += 1
      const nextStartedAt = profileOptions.profiler?.now()
      try {
        return await next()
      } finally {
        if (nextStartedAt != null) {
          profileOptions.profiler?.mark(`${pluginProfileName}.next`, nextStartedAt, {
            index: pluginIndex,
            nextCallCount,
            plugin: name
          })
        }
      }
    }

    try {
      return await hook(
        {
          ...context,
          logger: withNameLogger
        },
        input,
        timedNext
      )
    } catch (error) {
      failed = true
      if (error instanceof Error && !error.name.includes('[plugin.')) {
        error.name = `${error.name}[plugin.${name}]`
      }
      throw error
    } finally {
      if (totalStartedAt != null) {
        profileOptions.profiler?.mark(`${pluginProfileName}.total`, totalStartedAt, {
          error: failed,
          index: pluginIndex,
          nextCallCount,
          plugin: name
        })
      }
    }
  }

  return next()
}
