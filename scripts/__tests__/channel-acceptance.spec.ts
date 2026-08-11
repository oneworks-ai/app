import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { inspectChannelAcceptance } from '../channel-acceptance'

describe('channel acceptance', () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map(root => rm(root, { force: true, recursive: true })))
  })

  const createWorkspace = async (options: { withAdmin?: boolean } = {}) => {
    const workspace = await mkdtemp(join(tmpdir(), 'oneworks-channel-acceptance-'))
    roots.push(workspace)
    await Promise.all([
      mkdir(join(workspace, '.oo', 'entities', 'assistant'), { recursive: true }),
      mkdir(join(workspace, '.oo', 'channels', 'first'), { recursive: true }),
      mkdir(join(workspace, '.oo', 'channels', 'second'), { recursive: true })
    ])
    await writeFile(
      join(workspace, '.oo.config.json'),
      JSON.stringify({
        disableGlobalConfig: true,
        channels: {
          'lark:fixture': {
            type: 'lark',
            appId: 'fixture',
            appSecret: 'fixture',
            access: {
              admins: options.withAdmin === false ? [] : ['fixture-admin'],
              allowedGroups: ['fixture-chat-a', 'fixture-chat-b']
            }
          }
        }
      })
    )
    await writeFile(
      join(workspace, '.oo', 'entities', 'assistant', 'README.md'),
      '---\nname: assistant\ndescription: Fixture entity\n---\n\n# Assistant\n'
    )
    for (
      const [directory, chatId] of [
        ['first', 'fixture-chat-a'],
        ['second', 'fixture-chat-b']
      ]
    ) {
      await writeFile(
        join(workspace, '.oo', 'channels', directory, 'channel.json'),
        JSON.stringify({
          channel: 'lark:fixture',
          entity: 'assistant',
          external: {
            type: 'chat',
            chatId
          }
        })
      )
    }
    return workspace
  }

  it('validates a complete matrix without returning tenant identifiers', async () => {
    const workspace = await createWorkspace()
    const result = await inspectChannelAcceptance({
      expectChannels: 1,
      expectEntities: 1,
      expectGroups: 2,
      expectLinks: 2,
      requireAdmins: true,
      requireCredentials: true,
      requireGroupAllowlist: true,
      workspace
    })

    expect(result).toMatchObject({
      ok: true,
      counts: {
        adminReadyChannels: 1,
        channels: 1,
        credentialReadyChannels: 1,
        entities: 1,
        groupAllowlistReadyChannels: 1,
        groups: 2,
        linkedChannels: 1,
        linkedEntities: 1,
        links: 2
      },
      violations: []
    })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('fixture-chat-a')
    expect(serialized).not.toContain('fixture-admin')
    expect(result.digest).toMatch(/^[0-9a-f]{16}$/u)
  })

  it('reports a hashed reference when a linked channel has no admin', async () => {
    const workspace = await createWorkspace({ withAdmin: false })
    const result = await inspectChannelAcceptance({
      requireAdmins: true,
      workspace
    })

    expect(result.ok).toBe(false)
    expect(result.violations).toEqual([
      {
        code: 'channel_missing_admin',
        ref: expect.stringMatching(/^[0-9a-f]{16}$/u)
      }
    ])
    expect(JSON.stringify(result)).not.toContain('lark:fixture')
  })
})
