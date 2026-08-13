import { describe, expect, it } from 'vitest'

import { isNativeHistoryAdapter } from '#~/api'
import {
  buildExternalSessionsRoute,
  parseExternalSessionsAdapter,
  parseExternalSessionsShowAllTime
} from '#~/components/config/external-sessions-route'

describe('external sessions route helpers', () => {
  it('builds a deep link for the selected native adapter', () => {
    expect(buildExternalSessionsRoute('claude-code')).toBe(
      '/config/externalSessions?adapter=claude-code&time=all'
    )
  })

  it('parses only supported native adapters', () => {
    expect(parseExternalSessionsAdapter(new URLSearchParams('adapter=codex'))).toBe('codex')
    expect(parseExternalSessionsAdapter(new URLSearchParams('adapter=cline'))).toBe('cline')
    expect(parseExternalSessionsAdapter(new URLSearchParams('adapter=gemini'))).toBeUndefined()
    expect(isNativeHistoryAdapter('cline')).toBe(true)
    expect(isNativeHistoryAdapter('claude-code')).toBe(true)
    expect(isNativeHistoryAdapter('opencode')).toBe(false)
  })

  it('shows the full time range only for an explicit shortcut deep link', () => {
    expect(parseExternalSessionsShowAllTime(new URLSearchParams('time=all'))).toBe(true)
    expect(parseExternalSessionsShowAllTime(new URLSearchParams())).toBe(false)
  })
})
