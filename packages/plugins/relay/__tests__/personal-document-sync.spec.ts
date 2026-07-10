import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ensureRelayFixtureDocumentEntries,
  isCanonicalRelayDocumentPayloadPath,
  listRelayDocumentEntries,
  readRelayDocumentContent,
  syncRelayPersonalDocuments,
  syncRelayProjectRuleDocuments
} from '../src/server/personal-document-sync.js'
import type { RelayStoredServer } from '../src/server/types.js'
import { relayDocumentScopePathSegment, relayProjectRuleDocumentBasePayloadPath } from '../src/shared/document-paths.js'

const tempDirs: string[] = []

const createTempHome = async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'oneworks-relay-doc-sync-'))
  tempDirs.push(homeDir)
  vi.stubEnv('HOME', homeDir)
  vi.stubEnv('__ONEWORKS_PROJECT_REAL_HOME__', homeDir)
  return homeDir
}

const writeHomeFile = async (homeDir: string, path: string, content: string) => {
  const target = join(homeDir, path)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, content, 'utf8')
}

const readHomeFile = async (homeDir: string, path: string) => await readFile(join(homeDir, path), 'utf8')

const createServer = () => ({
  id: 'local',
  name: 'Local Relay',
  pairingToken: '',
  pairingTokenConfigured: false,
  protocol: 'http' as const,
  remoteBaseUrl: 'https://relay.example',
  server: 'relay.example'
})

const createStoredServer = (): RelayStoredServer => ({
  account: {
    email: 'owner@example.test',
    id: 'owner',
    name: 'Owner'
  },
  deviceToken: 'device-token',
  id: 'local',
  personalDocumentSync: {
    agents: true,
    ooAgents: true,
    ooRules: true
  },
  remoteBaseUrl: 'https://relay.example'
})

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

describe('relay personal document sync', () => {
  it('keeps document scope paths inside their Relay namespace', () => {
    expect(relayDocumentScopePathSegment(' local:team ')).toBe('local:team')
    expect(relayProjectRuleDocumentBasePayloadPath('team/one', 'assignment\\one')).toBe(
      '.oo/teams/team_one/project-rules/assignment_one'
    )
    expect(() => relayDocumentScopePathSegment('..')).toThrow('cannot traverse directories')
    expect(relayDocumentScopePathSegment('\u0000')).toBe('_')
    expect(isCanonicalRelayDocumentPayloadPath('.oo/rules/coding.md')).toBe(true)
    expect(isCanonicalRelayDocumentPayloadPath('.oo/rules/../../AGENTS.md')).toBe(false)
    expect(isCanonicalRelayDocumentPayloadPath('.oo/rules//coding.md')).toBe(false)
    expect(isCanonicalRelayDocumentPayloadPath('/AGENTS.md')).toBe(false)
  })

  it('rejects symbolic links throughout document read and write paths', async () => {
    const homeDir = await createTempHome()
    const outsideDir = await mkdtemp(join(tmpdir(), 'oneworks-relay-doc-outside-'))
    tempDirs.push(outsideDir)
    const outsidePath = join(outsideDir, 'outside.md')
    await writeFile(outsidePath, '# Outside\n', 'utf8')
    const basePath = '.oo/teams/team-1/project-rules/assignment-1'
    const linkedPath = join(homeDir, basePath, 'AGENTS.md')
    await mkdir(dirname(linkedPath), { recursive: true })
    await symlink(outsidePath, linkedPath)
    const scope = { id: 'assignment-1', teamId: 'team-1', type: 'projectRule' as const }

    await expect(readRelayDocumentContent(`${basePath}/AGENTS.md`)).rejects.toThrow('不能包含符号链接')
    await expect(ensureRelayFixtureDocumentEntries(scope)).rejects.toThrow('不能包含符号链接')
    expect(await readFile(outsidePath, 'utf8')).toBe('# Outside\n')
  })

  it('rejects traversal in local document read actions', async () => {
    const homeDir = await createTempHome()
    await writeHomeFile(homeDir, '.ssh/id_rsa', 'private-key')

    await expect(
      readRelayDocumentContent('.oo/teams/../../.ssh/id_rsa')
    ).rejects.toThrow('文档路径不在允许的同步命名空间内')
  })

  it('syncs user-root instruction documents by kind without uploading .local.md files or plaintext', async () => {
    const homeDir = await createTempHome()
    await writeHomeFile(homeDir, 'AGENTS.md', '# Root AGENTS\n')
    await writeHomeFile(homeDir, '.oo/AGENTS.md', '# OneWorks AGENTS\n')
    await writeHomeFile(homeDir, '.oo/rules/coding.md', '# Coding\n')
    await writeHomeFile(homeDir, '.oo/rules/local/model-routing.local.md', '# Local only\n')

    const putBodies: Record<string, unknown>[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>
        putBodies.push(body)
        return new Response(
          JSON.stringify({
            personalConfigSnapshot: {
              documents: {
                ...(body.documents as Record<string, unknown>),
                hash: 'sha256:remote-documents',
                updatedAt: '2026-07-08T00:00:00.000Z'
              },
              hash: 'sha256:remote-config',
              updatedAt: '2026-07-08T00:00:00.000Z',
              userId: 'owner'
            }
          }),
          { headers: { 'content-type': 'application/json' }, status: 200 }
        )
      }
      expect(String(input)).toBe('https://relay.example/api/relay/config/global')
      return new Response(
        JSON.stringify({
          personalConfigSnapshot: null
        }),
        { headers: { 'content-type': 'application/json' }, status: 200 }
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    const status = await syncRelayPersonalDocuments({
      deviceToken: 'device-token',
      server: createServer(),
      storedServer: createStoredServer()
    })
    const uploaded = putBodies[0]?.documents as Record<string, unknown>

    expect(status).toMatchObject({
      countsByKind: {
        agents: 1,
        ooAgents: 1,
        ooRules: 1
      },
      documentCount: 3,
      pushedLocal: true
    })
    expect(uploaded).toMatchObject({
      countsByKind: {
        agents: 1,
        ooAgents: 1,
        ooRules: 1
      },
      documentCount: 3,
      totalSizeBytes: Buffer.byteLength('# Root AGENTS\n# OneWorks AGENTS\n# Coding\n', 'utf8'),
      version: 1
    })
    expect(JSON.stringify(putBodies[0])).not.toContain('Root AGENTS')
    expect(JSON.stringify(putBodies[0])).not.toContain('Local only')

    const entries = await listRelayDocumentEntries({ id: 'owner', type: 'account' })
    expect(entries.map(entry => ({
      kind: entry.kind,
      localOnly: entry.localOnly,
      path: entry.path
    }))).toEqual([
      { kind: 'agents', localOnly: false, path: 'AGENTS.md' },
      { kind: 'ooAgents', localOnly: false, path: '.oo/AGENTS.md' },
      { kind: 'ooRules', localOnly: false, path: '.oo/rules/coding.md' },
      { kind: 'ooRules', localOnly: true, path: '.oo/rules/local/model-routing.local.md' }
    ])
  })

  it('applies newer remote user-root documents with conflict backups for existing local files', async () => {
    const homeDir = await createTempHome()
    await writeHomeFile(homeDir, 'AGENTS.md', '# Remote Root\n')
    await writeHomeFile(homeDir, '.oo/AGENTS.md', '# Remote OO\n')
    await writeHomeFile(homeDir, '.oo/rules/coding.md', '# Remote Coding\n')

    let remoteDocuments: Record<string, unknown> | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'PUT') {
          const body = JSON.parse(String(init.body)) as Record<string, unknown>
          remoteDocuments = {
            ...(body.documents as Record<string, unknown>),
            hash: 'sha256:remote-documents',
            updatedAt: '2999-01-01T00:00:00.000Z'
          }
          return new Response(
            JSON.stringify({
              personalConfigSnapshot: {
                documents: remoteDocuments,
                hash: 'sha256:remote-config',
                updatedAt: '2999-01-01T00:00:00.000Z',
                userId: 'owner'
              }
            }),
            { headers: { 'content-type': 'application/json' }, status: 200 }
          )
        }
        return new Response(
          JSON.stringify({
            personalConfigSnapshot: remoteDocuments == null
              ? null
              : {
                documents: remoteDocuments,
                hash: 'sha256:remote-config',
                updatedAt: '2999-01-01T00:00:00.000Z',
                userId: 'owner'
              }
          }),
          { headers: { 'content-type': 'application/json' }, status: 200 }
        )
      })
    )

    await syncRelayPersonalDocuments({
      deviceToken: 'device-token',
      server: createServer(),
      storedServer: createStoredServer()
    })
    await writeHomeFile(homeDir, 'AGENTS.md', '# Local Changed\n')
    await writeHomeFile(homeDir, '.oo/AGENTS.md', '# Local OO Changed\n')

    const status = await syncRelayPersonalDocuments({
      deviceToken: 'device-token',
      server: createServer(),
      storedServer: createStoredServer()
    })
    const rootBackups = await readdir(homeDir)
    const ooBackups = await readdir(join(homeDir, '.oo'))

    expect(status).toMatchObject({
      appliedRemote: true,
      conflictBackups: 2,
      documentCount: 3
    })
    expect(await readHomeFile(homeDir, 'AGENTS.md')).toBe('# Remote Root\n')
    expect(await readHomeFile(homeDir, '.oo/AGENTS.md')).toBe('# Remote OO\n')
    expect(rootBackups.some(name => /^AGENTS\.relay-conflict-.+\.md$/u.test(name))).toBe(true)
    expect(ooBackups.some(name => /^AGENTS\.relay-conflict-.+\.md$/u.test(name))).toBe(true)
  })

  it('syncs project-rule documents in their own assignment directory', async () => {
    const homeDir = await createTempHome()
    const basePath = '.oo/teams/team-1/project-rules/assignment-1'
    await writeHomeFile(homeDir, `${basePath}/AGENTS.md`, '# Project Rule Guide\n')
    await writeHomeFile(homeDir, `${basePath}/rules/review.md`, '# Project Review\n')
    await writeHomeFile(homeDir, `${basePath}/rules/private.local.md`, '# Local only\n')

    const putBodies: Record<string, unknown>[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe(
          'https://relay.example/api/relay/config-assignments/assignment-1/documents'
        )
        expect(init?.headers).toMatchObject({ authorization: 'Bearer session-token' })
        if (init?.method === 'PUT') {
          const body = JSON.parse(String(init.body)) as Record<string, unknown>
          putBodies.push(body)
          return new Response(
            JSON.stringify({
              projectRuleDocumentSnapshot: {
                ...(body.documents as Record<string, unknown>),
                assignmentId: 'assignment-1',
                hash: 'sha256:project-rule-documents',
                teamId: 'team-1',
                updatedAt: '2026-07-10T00:00:00.000Z'
              }
            }),
            { headers: { 'content-type': 'application/json' }, status: 200 }
          )
        }
        return new Response(
          JSON.stringify({ projectRuleDocumentSnapshot: null }),
          { headers: { 'content-type': 'application/json' }, status: 200 }
        )
      })
    )

    const status = await syncRelayProjectRuleDocuments({
      assignmentId: 'assignment-1',
      preferences: { agents: true, ooAgents: false, ooRules: false },
      server: createServer(),
      sessionToken: 'session-token',
      teamId: 'team-1'
    })
    const entries = await listRelayDocumentEntries({
      id: 'assignment-1',
      teamId: 'team-1',
      type: 'projectRule'
    })

    expect(status).toMatchObject({
      countsByKind: { agents: 2, ooAgents: 0, ooRules: 0 },
      documentCount: 2,
      pushedLocal: true
    })
    expect(entries.map(entry => entry.path)).toEqual([
      `${basePath}/AGENTS.md`,
      `${basePath}/rules/private.local.md`,
      `${basePath}/rules/review.md`
    ])
    expect(JSON.stringify(putBodies[0])).not.toContain('Project Rule Guide')
    expect(JSON.stringify(putBodies[0])).not.toContain('Local only')
  })
})
