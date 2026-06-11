import process from 'node:process'

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_ONEWORKS_MCP_PERMISSION_NAME,
  DEFAULT_ONEWORKS_MCP_SERVER_NAME,
  mergeDefaultOneworksMcpPermissions,
  resolveDefaultOneworksMcpServerConfig,
  resolveUseDefaultOneworksMcpServer
} from '#~/default-oneworks-mcp.js'

describe('default OneWorks MCP', () => {
  it('enables the built-in MCP server by default', () => {
    expect(resolveUseDefaultOneworksMcpServer({})).toBe(true)
  })

  it('lets config disable the built-in MCP server unless runtime overrides it', () => {
    expect(resolveUseDefaultOneworksMcpServer({
      projectConfig: {
        noDefaultOneworksMcpServer: true
      }
    })).toBe(false)

    expect(resolveUseDefaultOneworksMcpServer({
      projectConfig: {
        noDefaultOneworksMcpServer: true
      },
      runtimeValue: true
    })).toBe(true)
  })

  it('resolves the managed MCP CLI wrapper as a stdio server command', () => {
    expect(DEFAULT_ONEWORKS_MCP_SERVER_NAME).toBe('OneWorks')
    expect(resolveDefaultOneworksMcpServerConfig()).toEqual({
      command: process.execPath,
      args: [expect.stringMatching(/packages\/mcp\/cli\.js$/)]
    })
  })

  it('adds the default managed permission alongside the built-in MCP server', () => {
    const [projectConfig, userConfig] = mergeDefaultOneworksMcpPermissions({
      projectConfig: {
        permissions: {
          allow: ['Read']
        }
      }
    })

    expect(DEFAULT_ONEWORKS_MCP_PERMISSION_NAME).toBe('OneWorks')
    expect(projectConfig?.permissions?.allow).toEqual(['Read', 'OneWorks'])
    expect(userConfig).toBeUndefined()
  })

  it('does not add the default managed permission when the built-in MCP server is disabled', () => {
    const [projectConfig] = mergeDefaultOneworksMcpPermissions({
      projectConfig: {
        noDefaultOneworksMcpServer: true,
        permissions: {
          allow: ['Read']
        }
      }
    })

    expect(projectConfig?.permissions?.allow).toEqual(['Read'])
  })
})
