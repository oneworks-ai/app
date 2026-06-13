import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  SERVER_BASE_URL_STORAGE_KEY,
  SERVER_CONNECTION_PICKER_STORAGE_KEY,
  buildWorkspaceClientBase,
  clearServerConnectionPickerRequest,
  clearStoredServerBaseUrl,
  createServerUrl,
  getConfiguredServerBaseUrl,
  getRuntimeWorkspaceId,
  getServerBaseUrl,
  getServerHostEnv,
  isDesktopClientMode,
  isServerConnectionManagedClientMode,
  isServerConnectionPickerRequested,
  isServerManagerRole,
  normalizeServerBaseUrl,
  requestServerConnectionPicker,
  resolveDevDocumentTitle,
  resolveWorkspaceIdFromPathname,
  setStoredServerBaseUrl
} from '#~/runtime-config'

const getGlobalScope = () => (
  globalThis as {
    __ONEWORKS_PROJECT_RUNTIME_ENV__?: {
      __ONEWORKS_PROJECT_SERVER_BASE_URL__?: string
      __ONEWORKS_PROJECT_CLIENT_MODE__?: string
      __ONEWORKS_PROJECT_CLIENT_BASE__?: string
      __ONEWORKS_PROJECT_CLIENT_DEV_SERVER__?: string
      __ONEWORKS_PROJECT_SERVER_HOST__?: string
      __ONEWORKS_PROJECT_SERVER_PORT__?: string
      __ONEWORKS_PROJECT_SERVER_ROLE__?: string
      __ONEWORKS_PROJECT_WORKSPACE_ID__?: string
    }
  }
)

const setRuntimeServerHost = (host: string) => {
  getGlobalScope().__ONEWORKS_PROJECT_RUNTIME_ENV__ = {
    __ONEWORKS_PROJECT_SERVER_HOST__: host
  }
}

const clearRuntimeEnv = () => {
  delete getGlobalScope().__ONEWORKS_PROJECT_RUNTIME_ENV__
}

const setRuntimeEnv = (env: NonNullable<ReturnType<typeof getGlobalScope>['__ONEWORKS_PROJECT_RUNTIME_ENV__']>) => {
  getGlobalScope().__ONEWORKS_PROJECT_RUNTIME_ENV__ = env
}

const createStorage = (): Storage => {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    removeItem: (key: string) => {
      values.delete(key)
    },
    setItem: (key: string, value: string) => {
      values.set(key, value)
    }
  }
}

describe('resolveDevDocumentTitle', () => {
  it('keeps the base title in production', () => {
    expect(resolveDevDocumentTitle('One Works Web', {
      isDev: false,
      gitRef: 'codex/feature-a'
    })).toBe('One Works Web')
  })

  it('appends the git ref in development', () => {
    expect(resolveDevDocumentTitle('One Works Web', {
      isDev: true,
      gitRef: 'codex/feature-a'
    })).toBe('One Works Web [codex/feature-a]')
  })

  it('falls back to the base title when the git ref is empty', () => {
    expect(resolveDevDocumentTitle('One Works Web', {
      isDev: true,
      gitRef: '   '
    })).toBe('One Works Web')
  })

  it('replaces an existing trailing dev suffix instead of duplicating it', () => {
    expect(resolveDevDocumentTitle('One Works Web [old-branch]', {
      isDev: true,
      gitRef: 'codex/feature-a'
    })).toBe('One Works Web [codex/feature-a]')
  })
})

describe('getServerHostEnv', () => {
  afterEach(() => {
    clearRuntimeEnv()
    clearStoredServerBaseUrl()
  })

  it('ignores unspecified listen addresses for browser requests', () => {
    for (const host of ['0.0.0.0', '::', '[::]', '   ']) {
      setRuntimeServerHost(host)
      expect(getServerHostEnv()).toBeUndefined()
    }
  })

  it('returns a concrete runtime host', () => {
    setRuntimeServerHost(' 192.168.31.125 ')
    expect(getServerHostEnv()).toBe('192.168.31.125')
  })
})

describe('workspace client route helpers', () => {
  afterEach(() => {
    clearRuntimeEnv()
  })

  it('builds workspace client bases under the web client base', () => {
    expect(buildWorkspaceClientBase('w_abc123456', '/ui')).toBe('/ui/w/w_abc123456')
    expect(buildWorkspaceClientBase('w_abc123456', '/')).toBe('/w/w_abc123456')
    expect(buildWorkspaceClientBase(' w_abc123456 ', '/console/')).toBe('/console/w/w_abc123456')
  })

  it('resolves workspace ids from workspace client paths only', () => {
    expect(resolveWorkspaceIdFromPathname('/ui/w/w_abc123456/session/s1', '/ui')).toBe('w_abc123456')
    expect(resolveWorkspaceIdFromPathname('/ui/w/w_abc123456', '/ui')).toBe('w_abc123456')
    expect(resolveWorkspaceIdFromPathname('/ui/session/s1', '/ui')).toBeUndefined()
    expect(resolveWorkspaceIdFromPathname('/console/w/w_abc123456/session/s1', '/console')).toBe('w_abc123456')
    expect(resolveWorkspaceIdFromPathname('/other/w/w_abc123456/session/s1')).toBeUndefined()
    expect(resolveWorkspaceIdFromPathname('/ui/w/%E0%A4%A', '/ui')).toBeUndefined()
  })

  it('normalizes the runtime workspace id', () => {
    setRuntimeEnv({
      __ONEWORKS_PROJECT_WORKSPACE_ID__: ' w_abc123456 '
    })

    expect(getRuntimeWorkspaceId()).toBe('w_abc123456')
  })
})

describe('server base URL helpers', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorage())
  })

  afterEach(() => {
    clearRuntimeEnv()
    clearStoredServerBaseUrl()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('normalizes backend addresses with optional paths', () => {
    expect(normalizeServerBaseUrl(' http://localhost:8787/ ')).toBe('http://localhost:8787')
    expect(normalizeServerBaseUrl('https://api.example.com/ow/')).toBe('https://api.example.com/ow')
    expect(normalizeServerBaseUrl('ftp://api.example.com')).toBeUndefined()
  })

  it('uses the stored backend address in standalone client mode', () => {
    localStorage.setItem(SERVER_BASE_URL_STORAGE_KEY, 'https://standalone.example.com')
    setRuntimeEnv({
      __ONEWORKS_PROJECT_CLIENT_MODE__: 'standalone',
      __ONEWORKS_PROJECT_SERVER_HOST__: 'server.example.com',
      __ONEWORKS_PROJECT_SERVER_PORT__: '8787'
    })

    expect(getServerBaseUrl()).toBe('https://standalone.example.com')
    expect(createServerUrl('/api/auth/status')).toBe('https://standalone.example.com/api/auth/status')
  })

  it('uses the stored workspace server address from manager client mode', () => {
    localStorage.setItem(SERVER_BASE_URL_STORAGE_KEY, 'http://127.0.0.1:4899')
    setRuntimeEnv({
      __ONEWORKS_PROJECT_CLIENT_MODE__: 'static',
      __ONEWORKS_PROJECT_SERVER_HOST__: '127.0.0.1',
      __ONEWORKS_PROJECT_SERVER_PORT__: '8787',
      __ONEWORKS_PROJECT_SERVER_ROLE__: 'manager'
    })

    expect(isServerManagerRole()).toBe(true)
    expect(isServerConnectionManagedClientMode()).toBe(true)
    expect(getServerBaseUrl()).toBe('http://127.0.0.1:4899')
  })

  it('prefers the explicit runtime workspace server over stored manager addresses', () => {
    localStorage.setItem(SERVER_BASE_URL_STORAGE_KEY, 'http://127.0.0.1:4899')
    setRuntimeEnv({
      __ONEWORKS_PROJECT_CLIENT_MODE__: 'static',
      __ONEWORKS_PROJECT_SERVER_BASE_URL__: 'http://127.0.0.1:5901',
      __ONEWORKS_PROJECT_SERVER_ROLE__: 'manager'
    })

    expect(getServerBaseUrl()).toBe('http://127.0.0.1:5901')
  })

  it('persists normalized standalone server addresses', () => {
    expect(setStoredServerBaseUrl('http://localhost:8787/')).toBe('http://localhost:8787')
    expect(localStorage.getItem(SERVER_BASE_URL_STORAGE_KEY)).toBe('http://localhost:8787')
  })

  it('uses the configured desktop runtime host and port as the default backend', () => {
    setRuntimeEnv({
      __ONEWORKS_PROJECT_CLIENT_MODE__: 'desktop',
      __ONEWORKS_PROJECT_SERVER_HOST__: '127.0.0.1',
      __ONEWORKS_PROJECT_SERVER_PORT__: '43123'
    })

    expect(isDesktopClientMode()).toBe(true)
    expect(isServerConnectionManagedClientMode()).toBe(true)
    expect(getConfiguredServerBaseUrl()).toBe('http://127.0.0.1:43123')
    expect(getServerBaseUrl()).toBe('http://127.0.0.1:43123')
  })

  it('detects manager server role from runtime env', () => {
    setRuntimeEnv({
      __ONEWORKS_PROJECT_SERVER_ROLE__: 'manager'
    })

    expect(isServerManagerRole()).toBe(true)
  })

  it('uses the dev server origin so Vite can proxy backend requests', () => {
    vi.stubGlobal('location', {
      origin: 'http://127.0.0.1:5174',
      protocol: 'http:',
      hostname: '127.0.0.1'
    })
    setRuntimeEnv({
      __ONEWORKS_PROJECT_CLIENT_MODE__: 'dev',
      __ONEWORKS_PROJECT_SERVER_HOST__: '127.0.0.1',
      __ONEWORKS_PROJECT_SERVER_PORT__: '8788'
    })

    expect(getConfiguredServerBaseUrl()).toBe('http://127.0.0.1:8788')
    expect(getServerBaseUrl()).toBe('http://127.0.0.1:5174')
    expect(createServerUrl('/api/auth/status')).toBe('http://127.0.0.1:5174/api/auth/status')
  })

  it('keeps desktop connection behavior while using the dev server proxy', () => {
    vi.stubGlobal('location', {
      origin: 'http://127.0.0.1:5175',
      protocol: 'http:',
      hostname: '127.0.0.1'
    })
    setRuntimeEnv({
      __ONEWORKS_PROJECT_CLIENT_MODE__: 'desktop',
      __ONEWORKS_PROJECT_CLIENT_DEV_SERVER__: 'true',
      __ONEWORKS_PROJECT_SERVER_HOST__: '127.0.0.1',
      __ONEWORKS_PROJECT_SERVER_PORT__: '8789'
    })

    expect(isDesktopClientMode()).toBe(true)
    expect(isServerConnectionManagedClientMode()).toBe(true)
    expect(getConfiguredServerBaseUrl()).toBe('http://127.0.0.1:8789')
    expect(getServerBaseUrl()).toBe('http://127.0.0.1:5175')
    expect(createServerUrl('/api/auth/status')).toBe('http://127.0.0.1:5175/api/auth/status')
  })

  it('keeps an explicit server base URL in dev mode', () => {
    vi.stubGlobal('location', {
      origin: 'http://127.0.0.1:5174',
      protocol: 'http:',
      hostname: '127.0.0.1'
    })
    setRuntimeEnv({
      __ONEWORKS_PROJECT_CLIENT_MODE__: 'dev',
      __ONEWORKS_PROJECT_SERVER_BASE_URL__: 'http://127.0.0.1:8788'
    })

    expect(getServerBaseUrl()).toBe('http://127.0.0.1:8788')
  })

  it('stores and clears the forced server picker flag', () => {
    setStoredServerBaseUrl('https://remote.example.com')

    requestServerConnectionPicker({ clearCurrentServer: true })

    expect(localStorage.getItem(SERVER_BASE_URL_STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem(SERVER_CONNECTION_PICKER_STORAGE_KEY)).toBe('true')
    expect(isServerConnectionPickerRequested()).toBe(true)

    clearServerConnectionPickerRequest()
    expect(localStorage.getItem(SERVER_CONNECTION_PICKER_STORAGE_KEY)).toBeNull()
  })
})
