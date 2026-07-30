import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { PublishOperations } from '#~/services/ai/asset-create-filesystem.js'
import { safelyPublishFile } from '#~/services/ai/asset-create-filesystem.js'
import { runAssetPublishProcess } from '#~/services/ai/asset-publish-process.js'
import { badRequest } from '#~/utils/http.js'

describe('asset publisher process control fence', () => {
  let workspace = ''

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(os.tmpdir(), 'ow-asset-process-'))
    await mkdir(path.join(workspace, '.oo/rules'), { recursive: true })
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  const publish = (name: string, operations: PublishOperations) =>
    safelyPublishFile({
      content: `# ${name}\n`,
      targetPath: path.join(workspace, `.oo/rules/${name}.md`),
      workspaceRoot: workspace
    }, operations)

  it('fences delayed PUBLISHING after an async staged ACK failure and proves termination', async () => {
    const started = Date.now()
    await expect(publish('late-publishing', {
      fault: 'delay-publishing',
      processControl: {
        send: (child, message, callback) => {
          if ((message as { stage?: string }).stage === 'staged') {
            child.send(message)
            setTimeout(() => callback(new Error('late staged send failure')), 5)
          } else {
            child.send(message, callback)
          }
        },
        terminate: child => {
          setTimeout(() => child.kill(), 60)
        },
        terminationTimeoutMs: 200
      }
    })).rejects.toMatchObject({
      code: 'asset_publish_failed',
      details: { committed: false, privateStaging: 'retained' }
    })

    expect(Date.now() - started).toBeGreaterThanOrEqual(40)
    await expect(readFile(path.join(workspace, '.oo/rules/late-publishing.md')))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('classifies an async PUBLISHING ACK failure as indeterminate', async () => {
    await expect(publish('publishing-send-failed', {
      processControl: {
        send: (child, message, callback) => {
          if ((message as { stage?: string }).stage === 'publishing') {
            setTimeout(() => callback(new Error('publishing ACK unknown')), 0)
          } else {
            child.send(message, callback)
          }
        }
      }
    })).resolves.toMatchObject({
      state: 'committed-indeterminate',
      warnings: expect.arrayContaining([
        'asset_publisher_response_lost',
        'asset_private_staging_retained'
      ])
    })
  })

  it('ignores an old stage send callback after a newer stage is current', async () => {
    let staleCallback!: (error: Error | null) => void
    await expect(publish('stale-send-callback', {
      processControl: {
        send: (child, message, callback) => {
          const stage = (message as { stage?: string }).stage
          if (stage === 'staged') {
            staleCallback = callback
            child.send(message)
          } else {
            if (stage === 'publishing') staleCallback(new Error('late stale callback'))
            child.send(message, callback)
          }
        }
      }
    })).resolves.toEqual({
      state: 'committed-degraded',
      warnings: ['asset_private_staging_retained']
    })
  })

  it('returns indeterminate without rolling back when an afterVisible hook rejects', async () => {
    await expect(publish('post-visible-hook', {
      afterVisible: async () => {
        throw badRequest('post-visible callback failed', { committed: false }, 'post_visible_callback_failed')
      }
    })).resolves.toEqual({
      state: 'committed-indeterminate',
      warnings: ['asset_publisher_response_lost', 'asset_private_staging_retained']
    })
    await expect(readFile(path.join(workspace, '.oo/rules/post-visible-hook.md'), 'utf8'))
      .resolves.toBe('# post-visible-hook\n')
  })

  it('maps a pre-publishing IPC disconnect through the parent termination fence', async () => {
    let terminations = 0
    await expect(publish('ipc-disconnect', {
      fault: 'disconnect-before-publishing',
      processControl: {
        terminate: child => {
          terminations += 1
          child.kill()
        }
      }
    })).rejects.toMatchObject({
      code: 'asset_publish_failed',
      details: { committed: false, privateStaging: 'retained' }
    })
    expect(terminations).toBe(1)
  })

  it.each([
    ['replayed control id on a legal next stage', { controlId: 1, stage: 'publishing' }],
    ['out-of-order stage', { controlId: 2, stage: 'visible' }]
  ])('rejects %s without another hook or ACK', async (_label, invalid) => {
    const directory = path.join(workspace, '.oo/rules')
    const directoryStat = await stat(directory, { bigint: true })
    const script = `
      process.stdout.write('READY\\n')
      for await (const chunk of process.stdin) void chunk
      await new Promise(resolve => {
        const receive = message => {
          if (message?.type !== 'asset-publish-continue') return
          process.off('message', receive)
          resolve()
        }
        process.on('message', receive)
        process.send({
          type: 'asset-publish-stage',
          controlId: 1,
          stage: 'staged',
          stagingName: '.private-stage'
        })
      })
      process.send({
        type: 'asset-publish-stage',
        ...${JSON.stringify(invalid)}
      })
      await new Promise(() => {})
    `
    let acknowledgements = 0
    let hooks = 0
    let terminations = 0

    await expect(runAssetPublishProcess({
      args: ['--input-type=module', '--eval', script],
      content: 'protocol mutation',
      control: {
        send: (child, message, callback) => {
          acknowledgements += 1
          child.send(message, callback)
        },
        terminate: child => {
          terminations += 1
          child.kill()
        },
        terminationTimeoutMs: 200
      },
      directory,
      expectedParent: {
        dev: String(directoryStat.dev),
        ino: String(directoryStat.ino)
      },
      operations: {
        afterTempSync: async () => {
          hooks += 1
        }
      },
      workspaceRoot: workspace
    })).rejects.toMatchObject({
      code: 'asset_publish_failed',
      details: { committed: false, privateStaging: 'retained' }
    })
    expect({ acknowledgements, hooks, terminations }).toEqual({
      acknowledgements: 1,
      hooks: 1,
      terminations: 1
    })
  })

  it('returns indeterminate when delayed kill cannot prove termination in time', async () => {
    await expect(publish('kill-unconfirmed', {
      afterTempSync: async () => {
        throw new Error('stop before publishing')
      },
      processControl: {
        terminate: child => {
          setTimeout(() => child.kill(), 80)
        },
        terminationTimeoutMs: 5
      }
    })).resolves.toEqual({
      state: 'committed-indeterminate',
      warnings: ['asset_publisher_termination_unconfirmed', 'asset_private_staging_retained']
    })

    await new Promise(resolve => setTimeout(resolve, 100))
  })

  it('times out a stalled stage, fences its late continuation, and returns false after close', async () => {
    let resolveHook!: () => void
    const outcome = publish('stage-timeout', {
      afterTempSync: () =>
        new Promise<void>(resolve => {
          resolveHook = resolve
        }),
      processControl: {
        controlTimeoutMs: 100,
        terminationTimeoutMs: 200
      }
    })

    await expect(outcome).rejects.toMatchObject({
      code: 'asset_publish_failed',
      details: { committed: false, privateStaging: 'retained' }
    })
    resolveHook()
    await expect(readFile(path.join(workspace, '.oo/rules/stage-timeout.md')))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })
})
