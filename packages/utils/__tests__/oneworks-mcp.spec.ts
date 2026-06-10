import { describe, expect, it } from 'vitest'

import {
  CANONICAL_ONEWORKS_MCP_SERVER_NAME,
  isCanonicalOneworksMcpServerName,
  resolveMcpPermissionServerKey,
  resolveMcpPermissionServerKeys,
  sanitizeMcpPermissionKeySegment
} from '#~/index.js'

describe('oneworks mcp naming helpers', () => {
  it('exposes OneWorks as the canonical built-in MCP server name', () => {
    expect(CANONICAL_ONEWORKS_MCP_SERVER_NAME).toBe('OneWorks')
    expect(isCanonicalOneworksMcpServerName('OneWorks')).toBe(true)
    expect(isCanonicalOneworksMcpServerName('oneworks')).toBe(false)
  })

  it('keeps the built-in MCP permission server key stable', () => {
    expect(resolveMcpPermissionServerKey('OneWorks')).toBe('oneworks')
    expect(resolveMcpPermissionServerKeys('OneWorks')).toEqual(['oneworks'])
    expect(sanitizeMcpPermissionKeySegment('OneWorks')).toBe('oneworks')
    expect(sanitizeMcpPermissionKeySegment('List Tasks')).toBe('list-tasks')
  })

  it('does not treat similarly-prefixed custom MCP servers as the built-in server', () => {
    expect(resolveMcpPermissionServerKeys('OneWorks Docs')).toEqual(['oneworks-docs'])
  })
})
