import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolveWebAuthConfig = vi.fn()
const verifySessionToken = vi.fn()
const getBearerTokenFromHeader = vi.fn()

vi.mock('#~/services/auth/index.js', () => ({
  AUTH_COOKIE_NAME: 'oneworks_web_auth',
  getBearerTokenFromHeader,
  resolveWebAuthConfig,
  verifySessionToken
}))

const createCtx = (path = '/api/sessions', authorization = '', method = 'GET') => ({
  method,
  path,
  query: {},
  get: vi.fn((name: string) => name === 'Authorization' ? authorization : ''),
  cookies: {
    get: vi.fn(() => 'token')
  }
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
    verifySessionToken.mockResolvedValueOnce(false)
    const { authMiddleware } = await import('#~/middlewares/auth.js')

    await expect(authMiddleware({} as any)(createCtx() as any, vi.fn())).rejects.toMatchObject({
      status: 401,
      code: 'auth_required'
    })
  })

  it('allows protected api routes when auth is disabled', async () => {
    resolveWebAuthConfig.mockResolvedValueOnce({ enabled: false })
    const next = vi.fn()
    const { authMiddleware } = await import('#~/middlewares/auth.js')

    await authMiddleware({} as any)(createCtx() as any, next)

    expect(next).toHaveBeenCalledOnce()
    expect(verifySessionToken).not.toHaveBeenCalled()
  })

  it('accepts bearer tokens on protected api routes', async () => {
    resolveWebAuthConfig.mockResolvedValueOnce({ enabled: true })
    getBearerTokenFromHeader.mockReturnValueOnce('bearer-token')
    verifySessionToken.mockResolvedValueOnce(true)
    const next = vi.fn()
    const { authMiddleware } = await import('#~/middlewares/auth.js')

    await authMiddleware({} as any)(createCtx('/api/sessions', 'Bearer bearer-token') as any, next)

    expect(verifySessionToken).toHaveBeenCalledWith(expect.anything(), 'bearer-token')
    expect(next).toHaveBeenCalledOnce()
  })

  it('marks asset auth config faults as explicit pre-commit failures', async () => {
    resolveWebAuthConfig.mockRejectedValueOnce(new Error('config storage unavailable'))
    const { authMiddleware } = await import('#~/middlewares/auth.js')

    await expect(
      authMiddleware({} as any)(
        createCtx('/api/ai/assets', '', 'POST') as any,
        vi.fn()
      )
    ).rejects.toMatchObject({
      code: 'asset_auth_config_failed',
      details: { committed: false },
      status: 500
    })
  })

  it('marks asset token verification faults as explicit pre-commit failures', async () => {
    resolveWebAuthConfig.mockResolvedValueOnce({ enabled: true })
    verifySessionToken.mockRejectedValueOnce(new Error('token store unavailable'))
    const { authMiddleware } = await import('#~/middlewares/auth.js')

    await expect(
      authMiddleware({} as any)(
        createCtx('/api/ai/assets', '', 'POST') as any,
        vi.fn()
      )
    ).rejects.toMatchObject({
      code: 'asset_auth_verification_failed',
      details: { committed: false },
      status: 500
    })
  })

  it('preserves non-asset auth config fault semantics', async () => {
    const fault = new Error('config storage unavailable')
    resolveWebAuthConfig.mockRejectedValueOnce(fault)
    const { authMiddleware } = await import('#~/middlewares/auth.js')

    await expect(
      authMiddleware({} as any)(
        createCtx('/api/sessions') as any,
        vi.fn()
      )
    ).rejects.toBe(fault)
  })

  it('preserves non-asset token verification fault semantics', async () => {
    const fault = new Error('token store unavailable')
    resolveWebAuthConfig.mockResolvedValueOnce({ enabled: true })
    verifySessionToken.mockRejectedValueOnce(fault)
    const { authMiddleware } = await import('#~/middlewares/auth.js')

    await expect(
      authMiddleware({} as any)(
        createCtx('/api/sessions') as any,
        vi.fn()
      )
    ).rejects.toBe(fault)
  })
})
