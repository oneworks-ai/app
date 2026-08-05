import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  AssetCreateCommitIndeterminateError,
  createAsset,
  isAssetCreateCommitIndeterminateError
} from '#~/api/knowledge'

vi.mock('#~/runtime-config.js', () => ({
  createServerUrl: (path: string) => new URL(path.replace(/^\/+/, ''), 'http://api.example.com:8787/').toString(),
  getServerBaseUrl: () => 'http://api.example.com:8787'
}))

vi.mock('#~/homepage-preview/runtime-loader', () => ({
  handleHomepagePreviewFetchIfEnabled: () => undefined
}))

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status
  })

describe('asset create API commit classification', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('accepts a 202 indeterminate success result without converting it to failure', async () => {
    fetchMock.mockResolvedValue(response({
      success: true,
      data: {
        asset: {
          commitState: 'committed-indeterminate',
          kind: 'rule',
          path: '.oo/rules/review.md'
        }
      }
    }, 202))

    await expect(createAsset({ kind: 'rule', name: 'Review' })).resolves.toMatchObject({
      asset: { commitState: 'committed-indeterminate' }
    })
  })

  it.each([
    ['missing state', 202, undefined],
    ['confirmed state', 202, 'committed'],
    ['degraded state', 202, 'committed-degraded'],
    ['indeterminate on 201', 201, 'committed-indeterminate'],
    ['unexpected 200', 200, undefined]
  ])('rejects protocol mismatch %s', async (_label, status, commitState) => {
    fetchMock.mockResolvedValue(response({
      success: true,
      data: {
        asset: {
          ...(commitState == null ? {} : { commitState }),
          kind: 'rule',
          path: '.oo/rules/review.md'
        }
      }
    }, status))

    const error = await createAsset({ kind: 'rule', name: 'Review' }).catch(value => value)
    expect(error).toBeInstanceOf(AssetCreateCommitIndeterminateError)
  })

  it('rejects a 202 error envelope even when it claims committed false', async () => {
    fetchMock.mockResolvedValue(response({
      success: false,
      error: {
        code: 'asset_publish_failed',
        details: { committed: false },
        message: 'contradictory response'
      }
    }, 202))

    const error = await createAsset({ kind: 'rule', name: 'Review' }).catch(value => value)
    expect(error).toBeInstanceOf(AssetCreateCommitIndeterminateError)
  })

  it.each([
    ['lost transport', new TypeError('connection closed')],
    [
      'unknown 5xx',
      response({
        success: false,
        error: { code: 'gateway_failure', message: 'gateway failed' }
      }, 502)
    ],
    ['malformed 2xx', response({ success: true, data: { ok: true } })]
  ])('marks %s as commit-indeterminate', async (_label, failure) => {
    if (failure instanceof Response) fetchMock.mockResolvedValue(failure)
    else fetchMock.mockRejectedValue(failure)

    const error = await createAsset({ kind: 'rule', name: 'Review' }).catch(value => value)
    expect(error).toBeInstanceOf(AssetCreateCommitIndeterminateError)
    expect(isAssetCreateCommitIndeterminateError(error)).toBe(true)
  })

  it.each([401, 409])('marks an unknown %i as commit-indeterminate', async (status) => {
    fetchMock.mockResolvedValue(response({
      success: false,
      error: { code: 'unknown_failure', message: 'unknown state' }
    }, status))

    const error = await createAsset({ kind: 'rule', name: 'Review' }).catch(value => value)
    expect(error).toBeInstanceOf(AssetCreateCommitIndeterminateError)
  })

  it.each([409, 500])('preserves explicit committed-false at %i as safely retryable', async (status) => {
    fetchMock.mockResolvedValue(response({
      success: false,
      error: {
        code: 'asset_publish_failed',
        details: { committed: false, privateStaging: 'retained' },
        message: 'not published'
      }
    }, status))

    const error = await createAsset({ kind: 'rule', name: 'Review' }).catch(value => value)
    expect(error).toMatchObject({
      code: 'asset_publish_failed',
      details: { committed: false, privateStaging: 'retained' }
    })
    expect(isAssetCreateCommitIndeterminateError(error)).toBe(false)
  })
})
