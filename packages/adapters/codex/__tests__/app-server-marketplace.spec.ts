import { EventEmitter } from 'node:events'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  installCodexAppServerPlugin,
  listCodexAppServerPlugins,
  resetCodexAppServerPluginCatalogCache
} from '../src/plugins/app-server-marketplace'

const mocks = vi.hoisted(() => {
  const requests: Array<{ method: string; params: unknown }> = []
  const responses = new Map<string, Array<unknown | Error>>()
  const processes: Array<{
    kill: ReturnType<typeof vi.fn>
    stderr: { resume: ReturnType<typeof vi.fn> }
  }> = []

  const spawn = vi.fn(() => {
    const proc = Object.assign(new EventEmitter(), {
      kill: vi.fn(),
      stderr: { resume: vi.fn() },
      stdin: {},
      stdout: {}
    })
    processes.push(proc)
    return proc
  })

  class RpcClient {
    destroy = vi.fn()
    notify = vi.fn()
    onRequest = vi.fn()
    respond = vi.fn()

    async request(method: string, params: unknown) {
      requests.push({ method, params })
      const queued = responses.get(method)
      const value = queued?.shift()
      if (value instanceof Error) throw value
      return value ?? {}
    }
  }

  return {
    processes,
    requests,
    resolveBinary: vi.fn(() => '/managed/codex'),
    responses,
    RpcClient,
    spawn
  }
})

vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
vi.mock('@oneworks/utils/managed-npm-cli', () => ({
  resolveManagedNpmCliBinaryPath: mocks.resolveBinary
}))
vi.mock('#~/protocol/rpc.js', () => ({ CodexRpcClient: mocks.RpcClient }))

const params = {
  cwd: '/workspace',
  env: { CODEX_HOME: '/home/.codex' },
  includeRemoteCatalog: true
}

const pluginListResponse = {
  featuredPluginIds: ['notion@openai-curated-remote'],
  marketplaces: [{ name: 'openai-curated-remote', plugins: [] }]
}

beforeEach(() => {
  mocks.processes.length = 0
  mocks.requests.length = 0
  mocks.responses.clear()
  mocks.resolveBinary.mockClear()
  mocks.spawn.mockClear()
  resetCodexAppServerPluginCatalogCache()
})

afterEach(() => resetCodexAppServerPluginCatalogCache())

describe('codex app-server marketplace transport', () => {
  it('uses the managed binary, drains stderr, and cleans up the process', async () => {
    mocks.responses.set('plugin/list', [pluginListResponse])

    await expect(listCodexAppServerPlugins(params)).resolves.toEqual({
      featuredPluginIds: ['notion@openai-curated-remote'],
      marketplaces: [{ name: 'openai-curated-remote', plugins: [] }]
    })

    expect(mocks.resolveBinary).toHaveBeenCalledWith(expect.objectContaining({
      adapterKey: 'codex',
      binaryName: 'codex',
      cwd: params.cwd,
      env: params.env
    }))
    expect(mocks.spawn).toHaveBeenCalledWith(
      '/managed/codex',
      ['app-server', '--enable', 'remote_plugin'],
      expect.objectContaining({ cwd: params.cwd, stdio: ['pipe', 'pipe', 'pipe'] })
    )
    expect(mocks.processes[0]?.stderr.resume).toHaveBeenCalledOnce()
    expect(mocks.processes[0]?.kill).toHaveBeenCalledOnce()
  })

  it('shares an in-flight catalog request and evicts failed requests', async () => {
    mocks.responses.set('plugin/list', [pluginListResponse])
    const first = listCodexAppServerPlugins(params)
    const second = listCodexAppServerPlugins(params)

    expect(second).toBe(first)
    await expect(first).resolves.toBeDefined()
    expect(mocks.spawn).toHaveBeenCalledTimes(1)

    resetCodexAppServerPluginCatalogCache()
    mocks.responses.set('plugin/list', [new Error('catalog unavailable'), pluginListResponse])
    await expect(listCodexAppServerPlugins(params)).rejects.toThrow('catalog unavailable')
    await expect(listCodexAppServerPlugins(params)).resolves.toBeDefined()
    expect(mocks.spawn).toHaveBeenCalledTimes(3)
  })

  it('invalidates the catalog cache after installation', async () => {
    mocks.responses.set('plugin/list', [pluginListResponse, pluginListResponse])
    await listCodexAppServerPlugins(params)

    mocks.responses.set('plugin/install', [{}])
    mocks.responses.set('plugin/read', [{
      plugin: {
        summary: {
          enabled: true,
          id: 'notion@openai-curated-remote',
          installed: true,
          name: 'notion',
          source: { type: 'remote' }
        }
      }
    }])
    await installCodexAppServerPlugin({
      ...params,
      marketplace: 'openai-curated-remote',
      pluginName: 'notion'
    })
    await listCodexAppServerPlugins(params)

    expect(mocks.spawn).toHaveBeenCalledTimes(3)
    expect(mocks.requests.filter(request => request.method === 'plugin/list')).toHaveLength(2)
  })
})
