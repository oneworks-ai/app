import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { ConfigResponse } from '@oneworks/types'

import { HistoryTimelineModeRadioGroup } from '#~/components/config/HistoryTimelineModeRadioGroup'
import {
  DEFAULT_HISTORY_TIMELINE_MODE,
  getGlobalHistoryTimelineMode,
  normalizeHistoryTimelineMode
} from '#~/utils/appearance-config'

describe('appearance history timeline mode', () => {
  it('defaults invalid and missing values to event lines', () => {
    expect(normalizeHistoryTimelineMode(undefined)).toBe(DEFAULT_HISTORY_TIMELINE_MODE)
    expect(normalizeHistoryTimelineMode('compact')).toBe('event-line')
    expect(getGlobalHistoryTimelineMode(undefined)).toBe('event-line')
  })

  it('reads the resolved global appearance before the raw global source', () => {
    const config = {
      resolvedSources: {
        global: {
          appearance: {
            historyTimelineMode: 'node'
          }
        }
      },
      sources: {
        global: {
          appearance: {
            historyTimelineMode: 'event-line'
          }
        }
      }
    } satisfies ConfigResponse

    expect(getGlobalHistoryTimelineMode(config)).toBe('node')
  })

  it('renders the same compact radio interaction with both modes', () => {
    const html = renderToStaticMarkup(
      <HistoryTimelineModeRadioGroup
        value='node'
        onChange={() => {}}
        t={key => key}
      />
    )

    expect(html).toContain('role="radiogroup"')
    expect(html).toContain('config.appSettings.historyTimelineMode.eventLine')
    expect(html).toContain('config.appSettings.historyTimelineMode.node')
    expect(html).toContain('aria-checked="true"')
    expect(html).toContain('tabindex="0"')
  })
})
