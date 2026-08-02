import { describe, expect, it, vi } from 'vitest'

import {
  chooseCredentials,
  findProjectId,
  getVercelLayout,
  selectProjectCandidate
} from '../../.github/workflows/scripts/relay-vercel-production.mjs'

describe('getVercelLayout', () => {
  it('keeps the workspace link and output separate from the relay package link', () => {
    expect(getVercelLayout('/runner/work/app/app')).toEqual({
      linkDir: '/runner/work/app/app/.vercel',
      outputDir: '/runner/work/app/app/.vercel/output',
      relayDir: '/runner/work/app/app/apps/relay-server',
      relayLinkDir: '/runner/work/app/app/apps/relay-server/.vercel'
    })
  })
})

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

  it('does not select a dev project id on the production path', () => {
    expect(selectProjectCandidate({ DEV_PROJECT_ID: 'dev-project' }, false)).toBeUndefined()
  })

  it('selects a dev project id only on the dev fallback path', () => {
    expect(selectProjectCandidate({ DEV_PROJECT_ID: 'dev-project' }, true)).toBe('dev-project')
  })

  it('prioritizes production secret then production variable', () => {
    expect(
      selectProjectCandidate({
        EXPLICIT_PROJECT_ID: 'prod-variable',
        PROD_PROJECT_ID: 'prod-secret',
        DEV_PROJECT_ID: 'dev'
      }, true)
    ).toBe('prod-secret')
    expect(selectProjectCandidate({ EXPLICIT_PROJECT_ID: 'prod-variable', DEV_PROJECT_ID: 'dev' }, true)).toBe(
      'prod-variable'
    )
  })
})
