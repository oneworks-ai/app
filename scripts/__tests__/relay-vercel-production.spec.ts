import { describe, expect, it, vi } from 'vitest'

import { chooseCredentials, findProjectId } from '../../.github/workflows/scripts/relay-vercel-production.mjs'

describe('findProjectId', () => {
  it('paginates projects and requires the exact production domain once', async () => {
    const fetchImpl = vi.fn(async (url) => ({
      ok: true,
      json: async () => {
        if (url.includes('/v9/projects?')) {
          return url.includes('until=2')
            ? { pagination: { next: null }, projects: [{ id: 'project-2' }] }
            : { pagination: { next: 2 }, projects: [{ id: 'project-1' }] }
        }
        return { domains: url.includes('project-2') ? [{ name: 'vc.oneworks.cloud' }] : [] }
      }
    }))
    await expect(findProjectId({ domain: 'vc.oneworks.cloud', fetchImpl, orgId: 'team_1', token: 'token' })).resolves
      .toBe('project-2')
    expect(fetchImpl).toHaveBeenCalledTimes(4)
  })

  it('fails closed for zero or multiple matching domains', async () => {
    const fetchImpl = vi.fn(async (url) => ({
      ok: true,
      json: async () =>
        url.includes('/v9/projects?')
          ? { pagination: { next: null }, projects: [{ id: 'one' }, { id: 'two' }] }
          : { domains: [{ name: 'vc.oneworks.cloud' }] }
    }))
    await expect(findProjectId({ domain: 'missing.example', fetchImpl, orgId: 'team_1', token: 'token' })).rejects
      .toThrow('found 0')
    await expect(findProjectId({ domain: 'vc.oneworks.cloud', fetchImpl, orgId: 'team_1', token: 'token' })).rejects
      .toThrow('found 2')
  })

  it('requires atomic credential pairs', () => {
    expect(() => chooseCredentials({ PROD_TOKEN: 'token' })).toThrow('configured together')
    expect(() => chooseCredentials({ DEV_TOKEN: 'token' })).toThrow('fallback are incomplete')
  })
})
