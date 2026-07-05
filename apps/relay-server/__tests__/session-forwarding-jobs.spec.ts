import { describe, expect, it } from 'vitest'

import { pruneSessionForwardingJobs, updateDeviceSessionSnapshot } from '../src/session-forwarding/jobs.js'
import type { RelayForwardingJob } from '../src/types.js'
import { createFixtureStore } from './session-route-helpers.js'

const timestamp = (offsetMs: number) => new Date(1_800_000_000_000 + offsetMs).toISOString()

const job = (input: Partial<RelayForwardingJob> & Pick<RelayForwardingJob, 'id' | 'status'>): RelayForwardingJob => {
  const { completedAt, createdAt, id, status, updatedAt, ...rest } = input
  return {
    deviceId: 'device-1',
    payloadSizeBytes: 0,
    sessionId: 'session-1',
    traceId: `trace-${id}`,
    ...rest,
    ...(completedAt == null ? {} : { completedAt }),
    createdAt: createdAt ?? timestamp(0),
    id,
    status,
    updatedAt: updatedAt ?? completedAt ?? createdAt ?? timestamp(0)
  }
}

describe('relay session forwarding job state', () => {
  it('does not rewrite identical device session snapshots', () => {
    const store = createFixtureStore()
    const first = updateDeviceSessionSnapshot(store, {
      deviceId: 'device-1',
      updatedAt: timestamp(1),
      sessions: [
        {
          createdAt: timestamp(0),
          deviceId: 'device-1',
          id: 'session-1',
          title: 'Workspace A',
          updatedAt: timestamp(1),
          userId: 'user-1',
          workspaceFolder: '/tmp/workspace-a'
        }
      ]
    })
    const second = updateDeviceSessionSnapshot(store, {
      deviceId: 'device-1',
      updatedAt: timestamp(2),
      sessions: [
        {
          createdAt: timestamp(2),
          deviceId: 'device-1',
          id: 'session-1',
          title: 'Workspace A',
          updatedAt: timestamp(2),
          userId: 'user-1',
          workspaceFolder: '/tmp/workspace-a'
        }
      ]
    })

    expect(first.changed).toBe(true)
    expect(second.changed).toBe(false)
    expect(store.deviceSessions).toHaveLength(1)
    expect(store.deviceSessions[0]).toMatchObject({
      createdAt: timestamp(0),
      id: 'session-1',
      title: 'Workspace A',
      updatedAt: timestamp(1)
    })
  })

  it('prunes completed forwarding jobs while keeping active and recent jobs', () => {
    const store = createFixtureStore()
    store.forwardingJobs = [
      job({ id: 'old-succeeded', status: 'succeeded', completedAt: timestamp(0), updatedAt: timestamp(0) }),
      job({ id: 'recent-succeeded', status: 'succeeded', completedAt: timestamp(9_000), updatedAt: timestamp(9_000) }),
      job({ id: 'active-queued', status: 'queued', updatedAt: timestamp(1_000) })
    ]

    const pruned = pruneSessionForwardingJobs(store, {
      maxRetainedJobs: 2,
      nowMs: Date.parse(timestamp(10_000)),
      terminalTtlMs: 2_000
    })

    expect(pruned.map(item => item.id)).toEqual(['old-succeeded'])
    expect(store.forwardingJobs.map(item => item.id)).toEqual(['active-queued', 'recent-succeeded'])
  })
})
