import { useMemo } from 'react'
import type { ReactNode } from 'react'

import { PluginProvider } from './PluginProvider'
import { PluginContext, usePluginContext } from './plugin-context'
import type { PluginContextValue, PluginContributionRuntimeSource, PluginRuntimeSource } from './plugin-context'
import type { PluginContributionSurface } from './plugin-manifest'

interface PluginContributionProviderProps {
  children: ReactNode
  runtimeServerBaseUrl?: string
  runtimeSource: PluginRuntimeSource
  surface?: PluginContributionSurface
}

function mergeContributionRuntimeSources(
  primarySources: PluginContributionRuntimeSource[],
  supplementalSources: PluginContributionRuntimeSource[]
) {
  const merged = new Map<PluginRuntimeSource, PluginContributionRuntimeSource>()
  for (const source of [...primarySources, ...supplementalSources]) {
    if (!merged.has(source.runtimeSource)) merged.set(source.runtimeSource, source)
  }
  return [...merged.values()]
}

function PluginContributionContextBridge({
  children,
  primaryContext
}: {
  children: ReactNode
  primaryContext: PluginContextValue
}) {
  const supplementalContext = usePluginContext()
  const contributionRuntimeSources = useMemo(
    () =>
      mergeContributionRuntimeSources(
        primaryContext.contributionRuntimeSources,
        supplementalContext.contributionRuntimeSources
      ),
    [primaryContext.contributionRuntimeSources, supplementalContext.contributionRuntimeSources]
  )
  const value = useMemo<PluginContextValue>(() => ({
    ...primaryContext,
    contributionRuntimeSources
  }), [contributionRuntimeSources, primaryContext])

  return <PluginContext.Provider value={value}>{children}</PluginContext.Provider>
}

/**
 * Adds already-filtered host contribution slots from another runtime while
 * retaining the parent context as the owner of routes, views, themes and APIs.
 */
export function PluginContributionProvider({
  children,
  runtimeServerBaseUrl,
  runtimeSource,
  surface = 'workspace'
}: PluginContributionProviderProps) {
  const primaryContext = usePluginContext()

  return (
    <PluginProvider
      runtimeServerBaseUrl={runtimeServerBaseUrl}
      runtimeSource={runtimeSource}
      surface={surface}
    >
      <PluginContributionContextBridge primaryContext={primaryContext}>
        {children}
      </PluginContributionContextBridge>
    </PluginProvider>
  )
}
