import { Buffer } from 'node:buffer'

import { afterEach, describe, expect, it } from 'vitest'

import { seedConfigProfileFixture } from './config-profile-fixture.js'
import { authHeaders, cleanupRelayFixtures, listenRelay, requestJson } from './helpers.js'

afterEach(cleanupRelayFixtures)

describe('relay project-rule document routes', () => {
  it('stores encrypted documents under their assignment boundary', async () => {
    const { args, baseUrl } = await listenRelay()
    await seedConfigProfileFixture(args.dataPath)
    const profile = await requestJson(baseUrl, '/api/relay/teams/team-1/config-profiles', {
      body: JSON.stringify({ name: 'Project Docs Config' }),
      headers: authHeaders('owner-session'),
      method: 'POST'
    })
    const profileId = (profile.body.profile as Record<string, unknown>).id as string
    const version = await requestJson(baseUrl, `/api/relay/config-profiles/${profileId}/versions`, {
      body: JSON.stringify({ configPatch: { skills: ['project-docs'] } }),
      headers: authHeaders('owner-session'),
      method: 'POST'
    })
    const versionId = (version.body.version as Record<string, unknown>).id as string
    const assignment = await requestJson(baseUrl, `/api/relay/config-profiles/${profileId}/assignments`, {
      body: JSON.stringify({ project: { allow: ['github.com/oneworks-ai/app'] }, versionId }),
      headers: authHeaders('owner-session'),
      method: 'POST'
    })
    const assignmentId = (assignment.body.assignment as Record<string, unknown>).id as string
    const encryptedPayload = {
      algorithm: 'aes-256-gcm',
      ciphertext: Buffer.from('encrypted project rule documents').toString('base64'),
      iv: Buffer.from('abcdefghijkl').toString('base64'),
      tag: Buffer.from('abcdefghijklmnop').toString('base64'),
      version: 1
    }
    const update = await requestJson(
      baseUrl,
      `/api/relay/config-assignments/${encodeURIComponent(assignmentId)}/documents`,
      {
        body: JSON.stringify({
          documents: {
            countsByKind: { agents: 2, ooAgents: 0, ooRules: 0 },
            documentCount: 2,
            encryptedPayload,
            plaintext: 'project rule secret content',
            totalSizeBytes: 128,
            version: 1
          }
        }),
        headers: authHeaders('owner-session'),
        method: 'PUT'
      }
    )
    const pulled = await requestJson(
      baseUrl,
      `/api/relay/config-assignments/${encodeURIComponent(assignmentId)}/documents`,
      { headers: authHeaders('owner-session') }
    )
    const deniedMember = await requestJson(
      baseUrl,
      `/api/relay/config-assignments/${encodeURIComponent(assignmentId)}/documents`,
      { headers: authHeaders('member-session') }
    )
    const stale = await requestJson(
      baseUrl,
      `/api/relay/config-assignments/${encodeURIComponent(assignmentId)}/documents`,
      {
        body: JSON.stringify({
          baseHash: 'sha256:stale',
          documents: {
            countsByKind: { agents: 1, ooAgents: 0, ooRules: 0 },
            documentCount: 1,
            encryptedPayload,
            totalSizeBytes: 64,
            version: 1
          }
        }),
        headers: authHeaders('owner-session'),
        method: 'PUT'
      }
    )

    expect(update.response.status).toBe(200)
    expect(pulled.response.status).toBe(200)
    expect(deniedMember.response.status).toBe(403)
    expect(stale.response.status).toBe(409)
    expect(pulled.body.projectRuleDocumentSnapshot).toMatchObject({
      assignmentId,
      countsByKind: { agents: 2, ooAgents: 0, ooRules: 0 },
      documentCount: 2,
      encryptedPayload: {
        algorithm: 'aes-256-gcm',
        ciphertext: encryptedPayload.ciphertext,
        version: 1
      },
      hash: expect.stringMatching(/^sha256:/),
      teamId: 'team-1',
      totalSizeBytes: 128,
      updatedByUserId: 'owner-1',
      version: 1
    })
    expect(JSON.stringify(pulled.body)).not.toContain('project rule secret content')
  })
})
