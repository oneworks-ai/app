import { Command } from 'commander'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { registerPluginCliCommands, runPluginCliCommand } from '#~/commands/plugin-cli.js'
import type { PluginCliCommandContribution } from '#~/commands/plugin-cli.js'

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

const createRelayContributions = (): PluginCliCommandContribution[] => [
  {
    command: {
      command: 'login',
      id: 'login',
      root: true
    },
    path: ['login'],
    scope: 'relay'
  },
  {
    command: {
      command: 'users',
      id: 'users',
      root: true
    },
    path: ['users'],
    scope: 'relay'
  },
  {
    command: {
      command: 'users-enable',
      id: 'users-enable',
      root: true
    },
    path: ['users', 'enable'],
    scope: 'relay'
  }
]

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  process.exitCode = undefined
})

describe('plugin CLI commands', () => {
  it('invokes a root plugin command through the daemon with server and JSON options', async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      new Response(JSON.stringify({
        success: true,
        data: {
          loginUrl: 'https://relay.example/login'
        }
      }))
    )
    vi.stubGlobal('fetch', fetchMock)
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const program = new Command()
    registerPluginCliCommands(program, createRelayContributions())

    await program.parseAsync([
      'login',
      '-s',
      'vercel',
      '--daemon',
      'http://127.0.0.1:9876',
      '--json'
    ], { from: 'user' })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:9876/api/plugins/relay/commands/login',
      expect.objectContaining({
        body: JSON.stringify({
          payload: {
            args: [],
            interactive: false,
            server: 'vercel'
          }
        }),
        method: 'POST'
      })
    )
    expect(JSON.parse(log.mock.calls[0]?.[0] as string)).toEqual({
      loginUrl: 'https://relay.example/login'
    })
  })

  it('dispatches nested plugin subcommands instead of treating them as parent args', async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      new Response(JSON.stringify({
        success: true,
        data: {
          message: 'Enabled alice on cf.'
        }
      }))
    )
    vi.stubGlobal('fetch', fetchMock)
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const program = new Command()
    registerPluginCliCommands(program, createRelayContributions())

    await program.parseAsync([
      'users',
      'enable',
      'alice',
      '-s',
      'cf',
      '--daemon',
      'http://127.0.0.1:9876'
    ], { from: 'user' })

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:9876/api/plugins/relay/commands/users-enable')
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      payload: {
        args: ['alice'],
        interactive: false,
        server: 'cf'
      }
    })
    expect(log).toHaveBeenCalledWith('Enabled alice on cf.')
  })

  it('prints account selection candidates as JSON for noninteractive automation', async () => {
    const result = {
      candidates: [
        {
          accountKey: 'oneworks-cloudflare:user-1',
          loginId: 'alice',
          serverAlias: 'cf',
          userId: 'user-1'
        },
        {
          accountKey: 'oneworks-cloudflare:user-2',
          loginId: 'alice',
          serverAlias: 'cf',
          userId: 'user-2'
        }
      ],
      selectionRequired: true
    }
    const fetchMock = vi.fn<FetchLike>(async () =>
      new Response(JSON.stringify({
        success: true,
        data: result
      }))
    )
    vi.stubGlobal('fetch', fetchMock)
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await runPluginCliCommand({
      args: [],
      commandId: 'users-disable',
      daemon: 'http://127.0.0.1:9876',
      interactive: false,
      json: true,
      scope: 'relay',
      server: 'cf'
    })

    expect(process.exitCode).toBe(1)
    expect(JSON.parse(log.mock.calls[0]?.[0] as string)).toEqual(result)
  })

  it('merges structured JSON input into the plugin command payload', async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      new Response(JSON.stringify({
        success: true,
        data: {
          ok: true
        }
      }))
    )
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await runPluginCliCommand({
      args: ['alice'],
      commandId: 'users-enable',
      daemon: 'http://127.0.0.1:9876',
      input: JSON.stringify({ accountKey: 'oneworks-cloudflare:user-1', reason: 'test' }),
      interactive: false,
      json: true,
      scope: 'relay',
      server: 'cf'
    })

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:9876/api/plugins/relay/commands/users-enable')
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      payload: {
        accountKey: 'oneworks-cloudflare:user-1',
        args: ['alice'],
        interactive: false,
        reason: 'test',
        server: 'cf'
      }
    })
  })
})
