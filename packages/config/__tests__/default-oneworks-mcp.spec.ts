import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { resolveProjectHomePath } from '@oneworks/utils'
import { afterEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_ONEWORKS_MCP_PERMISSION_NAME,
  DEFAULT_ONEWORKS_MCP_SERVER_NAME,
  mergeDefaultOneworksMcpPermissions,
  resolveDefaultOneworksMcpServerConfig,
  resolveUseDefaultOneworksMcpServer
} from '#~/default-oneworks-mcp.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

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
      args: [expect.stringMatching(/packages\/mcp\/cli\.js$/)],
      env: {
        HOME: expect.any(String),
        USERPROFILE: expect.any(String),
        __ONEWORKS_DISABLE_MOCK_HOME_BRIDGE: '1'
      }
    })
  })

  it('runs the managed MCP against the workspace mock home without re-bridging global state', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'oneworks-config-mcp-'))
    const realHome = await mkdtemp(join(tmpdir(), 'oneworks-config-home-'))
    tempDirs.push(cwd, realHome)
    const env = {
      HOME: realHome,
      __ONEWORKS_PROJECT_REAL_HOME__: realHome
    } as NodeJS.ProcessEnv
    const mockHome = resolveProjectHomePath(cwd, env, '.mock')

    expect(
      resolveDefaultOneworksMcpServerConfig({
        cwd,
        env
      })?.env
    ).toEqual({
      HOME: mockHome,
      USERPROFILE: mockHome,
      __ONEWORKS_DISABLE_MOCK_HOME_BRIDGE: '1'
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
