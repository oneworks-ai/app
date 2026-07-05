import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createRelayLoopLeaseManager } from '../src/server/loop-lease.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

const createLeaseRoot = async () => {
  const leaseRoot = await mkdtemp(join(tmpdir(), 'oneworks-relay-loop-lease-'))
  tempDirs.push(leaseRoot)
  return leaseRoot
}

describe('relay loop lease', () => {
  it('allows only one local owner to maintain the same relay loop', async () => {
    const leaseRoot = await createLeaseRoot()
    const first = createRelayLoopLeaseManager({
      leaseRoot,
      ownerId: 'owner-a'
    })
    const second = createRelayLoopLeaseManager({
      leaseRoot,
      ownerId: 'owner-b'
    })

    const firstLease = await first.acquire('prod:owner')
    const competingLease = await second.acquire('prod:owner')
    await firstLease?.release()
    const secondLease = await second.acquire('prod:owner')
    await secondLease?.release()

    expect(firstLease).toBeDefined()
    expect(competingLease).toBeUndefined()
    expect(secondLease).toBeDefined()
  })

  it('recovers an expired relay loop lease from another owner', async () => {
    const leaseRoot = await createLeaseRoot()
    const first = createRelayLoopLeaseManager({
      leaseRoot,
      ownerId: 'owner-a',
      ttlMs: 250
    })
    const second = createRelayLoopLeaseManager({
      leaseRoot,
      ownerId: 'owner-b',
      ttlMs: 250
    })

    const firstLease = await first.acquire('prod:owner')
    await new Promise(resolve => setTimeout(resolve, 300))
    const secondLease = await second.acquire('prod:owner')
    await firstLease?.release()
    await secondLease?.release()

    expect(firstLease).toBeDefined()
    expect(secondLease).toBeDefined()
  })

  it('shares one lease root across different project homes', async () => {
    const leaseRoot = await createLeaseRoot()
    const projectA = await mkdtemp(join(tmpdir(), 'oneworks-relay-project-a-'))
    const projectB = await mkdtemp(join(tmpdir(), 'oneworks-relay-project-b-'))
    tempDirs.push(projectA, projectB)
    const first = createRelayLoopLeaseManager({
      leaseRoot,
      ownerId: 'owner-a',
      projectHome: projectA
    })
    const second = createRelayLoopLeaseManager({
      leaseRoot,
      ownerId: 'owner-b',
      projectHome: projectB
    })

    const firstLease = await first.acquire('local-device:account-a')
    const competingLease = await second.acquire('local-device:account-a')
    await firstLease?.release()

    expect(firstLease).toBeDefined()
    expect(competingLease).toBeUndefined()
  })
})
