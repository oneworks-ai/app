import type { AppearanceHistoryTimelineMode, ConfigResponse } from '@oneworks/types'

export const DEFAULT_HISTORY_TIMELINE_MODE: AppearanceHistoryTimelineMode = 'event-line'

export const normalizeHistoryTimelineMode = (value: unknown): AppearanceHistoryTimelineMode => (
  value === 'node' ? 'node' : DEFAULT_HISTORY_TIMELINE_MODE
)

export const getGlobalHistoryTimelineMode = (
  configRes: ConfigResponse | undefined
): AppearanceHistoryTimelineMode =>
  normalizeHistoryTimelineMode(
    configRes?.resolvedSources?.global?.appearance?.historyTimelineMode ??
      configRes?.sources?.global?.appearance?.historyTimelineMode
  )
