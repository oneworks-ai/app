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

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status
  })

describe('asset create API commit classification', () => {
  const fetchMock = vi.fn<typeof fetch>()
  const pending = (id = 'operation-1') =>
    response({
      success: true,
      data: { operation: { id, state: 'pending' } }
    }, 202)

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('submits once, polls pending status, and accepts a terminal indeterminate result', async () => {
    fetchMock
      .mockResolvedValueOnce(pending())
      .mockResolvedValueOnce(pending())
      .mockResolvedValueOnce(response({
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
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  })

  it('accepts a confirmed terminal status after exactly one create POST', async () => {
    fetchMock.mockResolvedValueOnce(pending()).mockResolvedValueOnce(response({
      success: true,
      data: { asset: { kind: 'entity', path: '.oo/entities/review.md' } }
    }))
    await expect(createAsset({ kind: 'entity', name: 'Review' })).resolves.toMatchObject({
      asset: { kind: 'entity', path: '.oo/entities/review.md' }
    })
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  })

  it.each([
    ['missing state', 202, undefined],
    ['confirmed state on pending status', 202, 'committed'],
    ['degraded state on pending status', 202, 'committed-degraded'],
    ['indeterminate on terminal status', 200, 'committed-indeterminate'],
    ['confirmed on legacy create status', 201, undefined]
  ])('rejects terminal status protocol mismatch %s', async (_label, status, commitState) => {
    fetchMock.mockResolvedValueOnce(pending()).mockResolvedValueOnce(response({
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

  it.each([
    ['lost transport', new TypeError('connection closed')],
    ['unknown 4xx', response({ success: false, error: { code: 'unknown', message: 'unknown state' } }, 409)],
    ['unknown 5xx', response({ success: false, error: { code: 'gateway', message: 'failed' } }, 502)],
    ['malformed 2xx', response({ success: true, data: { ok: true } })]
  ])('marks %s as commit-indeterminate', async (_label, failure) => {
    if (failure instanceof Response) fetchMock.mockResolvedValue(failure)
    else fetchMock.mockRejectedValue(failure)

    const error = await createAsset({ kind: 'rule', name: 'Review' }).catch(value => value)
    expect(error).toBeInstanceOf(AssetCreateCommitIndeterminateError)
    expect(isAssetCreateCommitIndeterminateError(error)).toBe(true)
  })

  it('treats a missing operation after acceptance as indeterminate without reposting', async () => {
    fetchMock.mockResolvedValueOnce(pending()).mockResolvedValueOnce(response({
      success: false,
      error: {
        code: 'asset_operation_unknown',
        details: { committed: 'indeterminate' },
        message: 'operation lost'
      }
    }, 404))
    const error = await createAsset({ kind: 'rule', name: 'Review' }).catch(value => value)
    expect(error).toBeInstanceOf(AssetCreateCommitIndeterminateError)
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  })

  it.each([409, 500])('preserves explicit committed-false at %i as safely retryable', async status => {
    fetchMock.mockResolvedValueOnce(pending()).mockResolvedValueOnce(response({
      success: false,
      error: {
        code: 'asset_publish_failed',
        details: { committed: false },
        message: 'not published'
      }
    }, status))

    const error = await createAsset({ kind: 'rule', name: 'Review' }).catch(value => value)
    expect(error).toMatchObject({ code: 'asset_publish_failed', details: { committed: false } })
    expect(isAssetCreateCommitIndeterminateError(error)).toBe(false)
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  })
})
