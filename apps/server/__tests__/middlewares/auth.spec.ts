import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolveWebAuthConfig = vi.fn()
const resolveSessionTokenClaims = vi.fn()
const getBearerTokenFromHeader = vi.fn()

vi.mock('#~/services/auth/index.js', () => ({
  AUTH_COOKIE_NAME: 'oneworks_web_auth',
  getBearerTokenFromHeader,
  resolveSessionTokenClaims,
  resolveWebAuthConfig,
  LOCAL_WORKSPACE_REQUEST_PRINCIPAL: {
    id: 'local-workspace',
    kind: 'local_workspace',
    permissions: ['workspace:read', 'workspace:manage']
  },
  createWebAccountRequestPrincipal: (username: string) => ({
    id: `web-account:${username}`,
    kind: 'web_account',
    permissions: ['workspace:read', 'workspace:manage']
  }),
  isLocalServerHost: (host?: string) => host == null || host === '' || host === '127.0.0.1',
  setWorkspaceRequestPrincipal: (ctx: any, principal: unknown) => {
    ctx.state.workspaceRequestPrincipal = principal
  }
}))

const createCtx = (path = '/api/sessions', authorization = '', method = 'GET') => ({
  method,
  path,
  get: vi.fn((name: string) => name === 'Authorization' ? authorization : ''),
  cookies: {
    get: vi.fn(() => 'token')
  },
  state: {}
})

describe('authMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getBearerTokenFromHeader.mockReturnValue(undefined)
  })

  it('skips public auth routes', async () => {
    const { authMiddleware } = await import('#~/middlewares/auth.js')
    const next = vi.fn()

    await authMiddleware({} as any)(createCtx('/api/auth/status') as any, next)

    expect(next).toHaveBeenCalledOnce()
    expect(resolveWebAuthConfig).not.toHaveBeenCalled()
  })

  it('rejects protected api routes when auth is enabled and token is invalid', async () => {
    resolveWebAuthConfig.mockResolvedValueOnce({ enabled: true })
    resolveSessionTokenClaims.mockResolvedValueOnce(undefined)
    const { authMiddleware } = await import('#~/middlewares/auth.js')

    await expect(authMiddleware({} as any)(createCtx() as any, vi.fn())).rejects.toMatchObject({
      status: 401,
      code: 'auth_required'
    })
  })

  it('keeps the OneWorks Chat Rooms proxy behind API authentication', async () => {
    resolveWebAuthConfig.mockResolvedValueOnce({ enabled: true })
    resolveSessionTokenClaims.mockResolvedValueOnce(undefined)
    const { authMiddleware } = await import('#~/middlewares/auth.js')

    await expect(
      authMiddleware({} as any)(createCtx('/api/plugins/oneworks/proxy/product/rooms') as any, vi.fn())
    ).rejects.toMatchObject({ code: 'auth_required', status: 401 })
  })

  it('allows protected api routes when auth is disabled', async () => {
    resolveWebAuthConfig.mockResolvedValueOnce({ enabled: false })
    const next = vi.fn()
    const ctx = createCtx()
    const { authMiddleware } = await import('#~/middlewares/auth.js')

    await authMiddleware({} as any)(ctx as any, next)

    expect(next).toHaveBeenCalledOnce()
    expect(resolveSessionTokenClaims).not.toHaveBeenCalled()
    expect(ctx.state).toEqual({
      workspaceRequestPrincipal: {
        id: 'local-workspace',
        kind: 'local_workspace',
        permissions: ['workspace:read', 'workspace:manage']
      }
    })
  })

  it('does not mint a trusted local principal when auth is disabled on a remote bind', async () => {
    resolveWebAuthConfig.mockResolvedValueOnce({ enabled: false })
    const next = vi.fn()
    const ctx = createCtx()
    const { authMiddleware } = await import('#~/middlewares/auth.js')

    await authMiddleware({ __ONEWORKS_PROJECT_SERVER_HOST__: '0.0.0.0' } as any)(ctx as any, next)

    expect(next).toHaveBeenCalledOnce()
    expect(ctx.state).toEqual({})
  })

  it('accepts bearer tokens on protected api routes', async () => {
    resolveWebAuthConfig.mockResolvedValueOnce({ enabled: true })
    getBearerTokenFromHeader.mockReturnValueOnce('bearer-token')
    resolveSessionTokenClaims.mockResolvedValueOnce({ expiresAt: Date.now() + 60_000, username: 'alice' })
    const next = vi.fn()
    const ctx = createCtx('/api/sessions', 'Bearer bearer-token')
    const { authMiddleware } = await import('#~/middlewares/auth.js')

    await authMiddleware({} as any)(ctx as any, next)

    expect(resolveSessionTokenClaims).toHaveBeenCalledWith(expect.anything(), 'bearer-token')
    expect(next).toHaveBeenCalledOnce()
    expect(ctx.state).toEqual({
      workspaceRequestPrincipal: {
        id: 'web-account:alice',
        kind: 'web_account',
        permissions: ['workspace:read', 'workspace:manage']
      }
    })
  })

  it('marks asset auth config and verification faults as explicit pre-commit failures', async () => {
    const { authMiddleware } = await import('#~/middlewares/auth.js')
    const configFault = new Error('config unavailable')
    await expect(
      authMiddleware({} as any, {
        resolveConfig: async () => {
          throw configFault
        }
      })(createCtx('/api/ai/assets', '', 'POST') as any, vi.fn())
    ).rejects.toMatchObject({
      code: 'asset_auth_config_failed',
      details: { committed: false },
      status: 500
    })

    await expect(
      authMiddleware({} as any, {
        resolveConfig: async () => ({ enabled: true } as any),
        resolveToken: async () => {
          throw new Error('token unavailable')
        }
      })(createCtx('/api/ai/assets', '', 'POST') as any, vi.fn())
    ).rejects.toMatchObject({
      code: 'asset_auth_verification_failed',
      details: { committed: false },
      status: 500
    })
  })

  it('preserves non-asset config and token faults by identity', async () => {
    const { authMiddleware } = await import('#~/middlewares/auth.js')
    const configFault = new Error('config unavailable')
    await expect(
      authMiddleware({} as any, {
        resolveConfig: async () => {
          throw configFault
        }
      })(createCtx() as any, vi.fn())
    ).rejects.toBe(configFault)

    const tokenFault = new Error('token unavailable')
    await expect(
      authMiddleware({} as any, {
        resolveConfig: async () => ({ enabled: true } as any),
        resolveToken: async () => {
          throw tokenFault
        }
      })(createCtx() as any, vi.fn())
    ).rejects.toBe(tokenFault)
  })
})
