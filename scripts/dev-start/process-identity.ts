import { spawnSync } from 'node:child_process'
import process from 'node:process'

export const pidRunning = (pid: number | undefined) => {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export const processFingerprint = (pid: number | undefined) => {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return undefined
  const result = spawnSync('ps', ['-o', 'lstart=', '-o', 'command=', '-p', String(pid)], {
    encoding: 'utf8',
    stdio: 'pipe'
  })
  const value = result.status === 0 ? result.stdout?.trim() : undefined
  return value == null || value === '' ? undefined : value
}

const PROCESS_START_TIME_LENGTH = 24

export const processFingerprintMatches = (
  actualFingerprint: string | undefined,
  recordedFingerprint: string | undefined
) => {
  if (actualFingerprint == null || recordedFingerprint == null) return false
  if (actualFingerprint === recordedFingerprint) return true
  if (
    actualFingerprint.length <= PROCESS_START_TIME_LENGTH ||
    recordedFingerprint.length <= PROCESS_START_TIME_LENGTH
  ) return false

  // pnpm can start through a shell wrapper and later exec the real Node process.
  // PID and kernel start time stay stable even though the command text changes.
  return actualFingerprint.slice(0, PROCESS_START_TIME_LENGTH) ===
    recordedFingerprint.slice(0, PROCESS_START_TIME_LENGTH)
}

export const processCwd = (pid: number | undefined) => {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return undefined
  const result = spawnSync('lsof', ['-a', '-d', 'cwd', '-Fn', '-p', String(pid)], {
    encoding: 'utf8',
    stdio: 'pipe'
  })
  const value = result.status === 0
    ? result.stdout?.split('\n').find(line => line.startsWith('n'))?.slice(1).trim()
    : undefined
  return value == null || value === '' ? undefined : value
}

export const terminateTrackedPid = async ({
  fingerprint,
  label,
  pid,
  timeoutMs = 3_000
}: {
  fingerprint?: string
  label: string
  pid?: number
  timeoutMs?: number
}) => {
  if (pid == null || !pidRunning(pid)) return
  const actualFingerprint = processFingerprint(pid)
  if (!processFingerprintMatches(actualFingerprint, fingerprint)) {
    throw new Error(`Refusing to stop ${label} pid=${pid}: process identity no longer matches shared state.`)
  }

  process.kill(pid, 'SIGTERM')
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!pidRunning(pid)) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  if (!processFingerprintMatches(processFingerprint(pid), fingerprint)) {
    throw new Error(`Refusing to force-stop ${label} pid=${pid}: process identity changed after SIGTERM.`)
  }
  process.kill(pid, 'SIGKILL')
  await new Promise(resolve => setTimeout(resolve, 100))
  if (pidRunning(pid)) throw new Error(`Failed to stop ${label} pid=${pid}.`)
}
