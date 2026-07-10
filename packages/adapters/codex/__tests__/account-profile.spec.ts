import { describe, expect, it, vi } from 'vitest'

import { fetchCodexProfileAvatarFromContent } from '#~/runtime/account-profile.js'

const createAuthContent = () =>
  JSON.stringify({
    auth_mode: 'chatgpt',
    tokens: {
      access_token: 'access-token',
      account_id: 'account-id'
    }
  })

const createJsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })

describe('fetchCodexProfileAvatarFromContent', () => {
  it('reads a trusted profile avatar with the Codex account credentials', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(createJsonResponse({
      profile: {
        profile_picture_url: 'https://chatgpt.com/backend-api/estuary/public_content/avatar/image'
      }
    }))

    await expect(fetchCodexProfileAvatarFromContent(createAuthContent(), {
      fetchImpl: fetchImpl as typeof fetch
    })).resolves.toBe('https://chatgpt.com/backend-api/estuary/public_content/avatar/image')

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [endpoint, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    const headers = new Headers(init.headers)
    expect(endpoint).toBe('https://chatgpt.com/backend-api/wham/profiles/me')
    expect(headers.get('Authorization')).toBe('Bearer access-token')
    expect(headers.get('ChatGPT-Account-Id')).toBe('account-id')
  })

  it('falls back to the Codex profile route', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(createJsonResponse({}, 404))
      .mockResolvedValueOnce(createJsonResponse({
        profile: {
          profile_picture_url: 'https://images.openai.com/avatar.png'
        }
      }))

    await expect(fetchCodexProfileAvatarFromContent(createAuthContent(), {
      fetchImpl: fetchImpl as typeof fetch
    })).resolves.toBe('https://images.openai.com/avatar.png')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls[1]?.[0]).toBe('https://chatgpt.com/backend-api/api/codex/profiles/me')
  })

  it('rejects avatar URLs outside trusted OpenAI hosts', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(createJsonResponse({
      profile: {
        profile_picture_url: 'https://example.com/avatar.png'
      }
    }))

    await expect(fetchCodexProfileAvatarFromContent(createAuthContent(), {
      fetchImpl: fetchImpl as typeof fetch
    })).resolves.toBeUndefined()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('does not make a request when the auth file has no access token', async () => {
    const fetchImpl = vi.fn()

    await expect(fetchCodexProfileAvatarFromContent('{"tokens":{}}', {
      fetchImpl: fetchImpl as typeof fetch
    })).resolves.toBeUndefined()
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
