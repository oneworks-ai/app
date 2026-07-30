import process from 'node:process'
import { once } from 'node:events'

import { acquireLockFile } from '../../src/lock.ts'

const [lockPath, staleMsValue, mode] = process.argv.slice(2)
if (lockPath == null) throw new Error('lock path is required')

const lock = await acquireLockFile(lockPath, { operation: 'cross-process-owner' }, {
  staleMs: Number(staleMsValue ?? 30),
  timeoutMs: 2_000,
  ...(mode === 'pause-reclaimer'
    ? {
        testHooks: {
          afterReclaimBarrierAcquired: async () => {
            process.stdout.write('BARRIER\n')
            while (true) {
              const [chunk] = await once(process.stdin, 'data')
              if (String(chunk).trim() === 'continue') break
            }
          }
        }
      }
    : {})
})

process.stdout.write('READY\n')
process.stdin.setEncoding('utf8')
process.stdin.on('data', (value) => {
  if (value.trim() !== 'release') return
  void lock.release().then(() => process.exit(0))
})
