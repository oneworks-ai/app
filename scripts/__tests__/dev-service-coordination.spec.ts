import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { afterEach, describe, expect, it } from 'vitest'

import { readDevServiceEvents, readDevServiceLease, withDevServiceOperation } from '../dev-start/coordination'

describe('dev service coordination', () => {
  let tempDir = ''

  afterEach(async () => {
    if (tempDir !== '') await rm(tempDir, { recursive: true, force: true })
  })

  it('serializes mutations for one target and records operation events', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'oneworks-dev-service-'))
    const paths = {
      events: join(tempDir, 'events.jsonl'),
      lease: join(tempDir, 'operation.lock')
    }
    const order: string[] = []
    let releaseFirst = () => {}
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    const first = withDevServiceOperation('daemon', 'restart', async () => {
      order.push('first:start')
      const lease = readDevServiceLease('daemon', paths.lease)
      expect(lease).toMatchObject({ resourceKey: 'manager-family', target: 'daemon' })
      await firstGate
      order.push('first:end')
    }, paths)
    while (!order.includes('first:start')) await new Promise(resolve => setTimeout(resolve, 5))

    const second = withDevServiceOperation('daemon', 'stop', async () => {
      order.push('second:start')
      order.push('second:end')
    }, paths)
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(order).toEqual(['first:start'])

    releaseFirst()
    await Promise.all([first, second])
    expect(order).toEqual(['first:start', 'first:end', 'second:start', 'second:end'])

    const events = (await readFile(paths.events, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line) as { action: string; phase: string })
    expect(events.map(event => `${event.action}:${event.phase}`)).toEqual([
      'restart:started',
      'restart:completed',
      'stop:started',
      'stop:completed'
    ])
  })

  it('fails the coordinator closed if the kernel lock holder dies', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'oneworks-dev-service-lock-loss-'))
    const helperPath = join(tempDir, 'lock-loss.ts')
    const lockPath = join(tempDir, 'operation.guard')
    await writeFile(
      helperPath,
      `
      import { withCrossProcessLock } from ${JSON.stringify(join(process.cwd(), 'scripts/dev-start/file-lock.ts'))}
      void withCrossProcessLock(${JSON.stringify(lockPath)}, async ({ holderPid }) => {
        process.stdout.write(\`HOLDER=\${holderPid}\\n\`)
        await new Promise(() => {})
      }).catch(error => {
        process.stderr.write(String(error))
        process.exit(1)
      })
    `
    )
    const child = spawn(process.execPath, ['-r', 'esbuild-register', helperPath], {
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => {
      stdout += String(chunk)
    })
    child.stderr.on('data', chunk => {
      stderr += String(chunk)
    })
    const deadline = Date.now() + 5_000
    while (!stdout.includes('HOLDER=') && child.exitCode == null && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    const holderPid = Number(/HOLDER=(\d+)/u.exec(stdout)?.[1])
    expect(holderPid, stderr).toBeGreaterThan(0)
    process.kill(holderPid, 'SIGKILL')
    const [code] = await once(child, 'exit') as [number | null]
    expect(code).toBe(70)
    expect(stderr).toContain('cross-process lock was lost unexpectedly')
  }, 10_000)

  it('recovers one dead lease without allowing concurrent owners', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'oneworks-dev-service-stale-'))
    const paths = {
      events: join(tempDir, 'events.jsonl'),
      lease: join(tempDir, 'operation.lock')
    }
    await mkdir(paths.lease)
    await writeFile(
      join(paths.lease, 'owner.json'),
      `${
        JSON.stringify({
          action: 'ensure',
          actor: 'dead-test-owner',
          fingerprint: 'dead-process',
          id: 'dead-lease',
          pid: 99_999_999,
          resourceKey: 'manager-family',
          target: 'daemon',
          startedAt: new Date(Date.now() - 60_000).toISOString()
        })
      }\n`
    )
    expect(readDevServiceLease('daemon', paths.lease)).toBeUndefined()
    let active = 0
    let maximumActive = 0
    const run = async () => {
      await withDevServiceOperation('daemon', 'ensure', async () => {
        active += 1
        maximumActive = Math.max(maximumActive, active)
        await new Promise(resolve => setTimeout(resolve, 30))
        active -= 1
      }, paths)
    }

    await Promise.all([run(), run()])
    expect(maximumActive).toBe(1)
  })

  it('records a failed event and releases the lease when an operation throws', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'oneworks-dev-service-failure-'))
    const paths = {
      events: join(tempDir, 'events.jsonl'),
      lease: join(tempDir, 'operation.lock')
    }
    await expect(withDevServiceOperation('daemon', 'ensure', async () => {
      throw new Error('expected failure')
    }, paths)).rejects.toThrow('expected failure')
    await expect(readFile(join(paths.lease, 'owner.json'), 'utf8')).rejects.toThrow()
    const events = (await readFile(paths.events, 'utf8')).trim().split('\n')
      .map(line => JSON.parse(line) as { phase: string })
    expect(events.map(event => event.phase)).toEqual(['started', 'failed'])
  })

  it('preserves valid event history around a corrupt crash-tail line', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'oneworks-dev-service-events-'))
    const path = join(tempDir, 'events.jsonl')
    await writeFile(
      path,
      [
        JSON.stringify({ phase: 'started', target: 'daemon' }),
        '{"phase":"completed"',
        JSON.stringify({ phase: 'completed', target: 'daemon' })
      ].join('\n')
    )

    expect(readDevServiceEvents('daemon', 20, path).map(event => event.phase)).toEqual([
      'started',
      'completed'
    ])
  })
})
