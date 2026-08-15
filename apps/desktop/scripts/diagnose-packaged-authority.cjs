'use strict'
/* eslint-disable max-lines -- the parent and isolated child diagnostic stay together as one audited protocol. */

const { Buffer } = require('node:buffer')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { resolveDesktopAppMetadata } = require('./desktop-app-metadata.cjs')
const { normalizeArch } = require('./desktop-archs.cjs')

const allowedPhases = Object.freeze([
  'broker_start',
  'peer_open',
  'claim_publish',
  'publish',
  'claim_release',
  'release',
  'cleanup'
])
const allowedErrorCodes = new Set([
  'diagnostic_app_missing',
  'diagnostic_arch_invalid',
  'diagnostic_broker_start_failed',
  'diagnostic_claim_failed',
  'diagnostic_cleanup_failed',
  'diagnostic_executable_missing',
  'diagnostic_launch_failed',
  'diagnostic_output_invalid',
  'diagnostic_output_overflow',
  'diagnostic_package_missing',
  'diagnostic_peer_open_failed',
  'diagnostic_platform_unsupported',
  'diagnostic_publish_failed',
  'diagnostic_release_failed',
  'diagnostic_timeout'
])
const childOutputLimitBytes = 64 * 1024
const diagnosticTimeoutMs = 30000
const diagnosticTempBase = process.platform === 'darwin' ? '/private/tmp' : os.tmpdir()

class PackagedAuthorityDiagnosticError extends Error {
  constructor(code, phase = 'broker_start') {
    super(code)
    this.name = 'PackagedAuthorityDiagnosticError'
    this.code = allowedErrorCodes.has(code) ? code : 'diagnostic_output_invalid'
    this.phase = allowedPhases.includes(phase) ? phase : 'broker_start'
  }
}

const fail = (code, phase) => {
  throw new PackagedAuthorityDiagnosticError(code, phase)
}

const resolvePackagedAuthorityTarget = ({
  arch = normalizeArch(process.env.ONEWORKS_DESKTOP_SMOKE_ARCH?.trim() || process.arch),
  env = process.env,
  outputDir,
  platform = process.platform
}) => {
  if (platform !== 'darwin') fail('diagnostic_platform_unsupported')
  if (!['arm64', 'x64'].includes(arch)) fail('diagnostic_arch_invalid')

  const metadata = resolveDesktopAppMetadata({ env, platform })
  let packageDirs
  try {
    packageDirs = fs.readdirSync(outputDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && entry.name.startsWith(`${metadata.productName}-`))
      .map(entry => path.join(outputDir, entry.name))
      .filter(packageDir => packageDir.endsWith(`-${arch}`))
  } catch {
    fail('diagnostic_app_missing')
  }
  if (packageDirs.length !== 1) fail('diagnostic_app_missing')

  const appBundlePath = path.join(packageDirs[0], `${metadata.productName}.app`)
  const executablePath = path.join(appBundlePath, 'Contents', 'MacOS', metadata.executableName)
  const authorityPackageRoot = path.join(
    appBundlePath,
    'Contents',
    'Resources',
    'app',
    'node_modules',
    '.pnpm',
    'node_modules',
    '@oneworks',
    'fs-authority-native'
  )
  if (!fs.statSync(executablePath, { throwIfNoEntry: false })?.isFile()) {
    fail('diagnostic_executable_missing')
  }
  if (!fs.statSync(path.join(authorityPackageRoot, 'testing.cjs'), { throwIfNoEntry: false })?.isFile()) {
    fail('diagnostic_package_missing')
  }
  return { appBundlePath, authorityPackageRoot, executablePath }
}

const childProgram = String.raw`
'use strict'
const { Buffer } = require('node:buffer')
const fs = require('node:fs')
const path = require('node:path')
process.env.NODE_ENV = 'test'
const phases = []
let authority
let broker
let currentPhase = 'broker_start'
let failureCode
let failurePhase
const errorCodeForPhase = phase => ({
  broker_start: 'diagnostic_broker_start_failed',
  peer_open: 'diagnostic_peer_open_failed',
  claim_publish: 'diagnostic_claim_failed',
  publish: 'diagnostic_publish_failed',
  claim_release: 'diagnostic_claim_failed',
  release: 'diagnostic_release_failed',
  cleanup: 'diagnostic_cleanup_failed'
})[phase] || 'diagnostic_output_invalid'
const main = async () => {
  const authorityPackageRoot = process.argv[2]
  const operationRoot = process.argv[3]
  const controlRoot = path.join(operationRoot, 'control')
  const workspaceRoot = path.join(operationRoot, 'workspace')
  fs.mkdirSync(workspaceRoot, { recursive: true })
  try {
    const api = require(path.join(authorityPackageRoot, 'testing.cjs'))
    const prepared = api.prepareFilesystemAuthorityTestControlRoot(controlRoot)
    currentPhase = 'broker_start'
    broker = await api.startFilesystemAuthorityBroker({
      controlRoot: prepared.controlRoot,
      secret: prepared.secret
    })
    phases.push(currentPhase)

    currentPhase = 'peer_open'
    authority = await api.openFilesystemAuthorityForTest(workspaceRoot, {
      autoStart: false,
      controlRoot: prepared.controlRoot,
      secret: prepared.secret,
      timeoutMs: 5000
    })
    phases.push(currentPhase)

    currentPhase = 'claim_publish'
    const publishGeneration = await authority.claim('rule', 'recovery-authority-diagnostic-publish')
    phases.push(currentPhase)

    currentPhase = 'publish'
    const published = await authority.publish({
      authorityId: authority.id,
      basename: 'authority-diagnostic.md',
      bytes: Buffer.from('oneworks-recovery-authority-diagnostic'),
      generation: publishGeneration,
      parentSegments: ['.oo', 'rules']
    })
    if (published?.state !== 'committed') throw new Error('publication state rejected')
    if (
      fs.readFileSync(path.join(workspaceRoot, '.oo', 'rules', 'authority-diagnostic.md'), 'utf8') !==
        'oneworks-recovery-authority-diagnostic'
    ) throw new Error('publication bytes rejected')
    phases.push(currentPhase)

    currentPhase = 'claim_release'
    const releaseGeneration = await authority.claim('rule', 'recovery-authority-diagnostic-release')
    phases.push(currentPhase)

    currentPhase = 'release'
    if (await authority.release(releaseGeneration) !== true) throw new Error('release rejected')
    phases.push(currentPhase)
  } catch {
    failureCode = errorCodeForPhase(currentPhase)
    failurePhase = currentPhase
  } finally {
    currentPhase = 'cleanup'
    try {
      authority?.close()
      await broker?.close()
      fs.rmSync(operationRoot, { force: true, recursive: true })
      phases.push(currentPhase)
    } catch {
      if (failureCode == null) {
        failureCode = errorCodeForPhase(currentPhase)
        failurePhase = currentPhase
      }
    }
  }

  const result = failureCode == null
    ? { ok: true, phases }
    : { errorCode: failureCode, ok: false, phase: failurePhase }
  process.stdout.write(JSON.stringify(result) + '\n')
  if (failureCode != null) process.exitCode = 1
}
main().catch(() => {
  process.stdout.write(JSON.stringify({
    errorCode: 'diagnostic_cleanup_failed',
    ok: false,
    phase: 'cleanup'
  }) + '\n')
  process.exitCode = 1
})
`

const decodeChildResult = stdout => {
  let result
  try {
    result = JSON.parse(stdout.trim())
  } catch {
    fail('diagnostic_output_invalid')
  }
  if (result?.ok === true) {
    if (
      !Array.isArray(result.phases) ||
      result.phases.length !== allowedPhases.length ||
      result.phases.some((phase, index) => phase !== allowedPhases[index])
    ) fail('diagnostic_output_invalid')
    return Object.freeze({ ok: true, phases: Object.freeze([...result.phases]) })
  }
  if (
    result?.ok !== false ||
    !allowedErrorCodes.has(result.errorCode) ||
    !allowedPhases.includes(result.phase)
  ) fail('diagnostic_output_invalid')
  return Object.freeze({ errorCode: result.errorCode, ok: false, phase: result.phase })
}

const parseChildResult = stdout => {
  const result = decodeChildResult(stdout)
  if (result.ok) return result
  fail(result.errorCode, result.phase)
}

const runPackagedAuthorityDiagnostic = ({
  authorityPackageRoot,
  executablePath,
  spawnChild = spawn,
  tempRoot = fs.mkdtempSync(path.join(diagnosticTempBase, 'ow-recovery-authority-')),
  timeoutMs = diagnosticTimeoutMs
}) =>
  new Promise((resolve, reject) => {
    const scriptPath = path.join(tempRoot, 'diagnostic.cjs')
    const operationRoot = path.join(tempRoot, 'operation')
    fs.mkdirSync(tempRoot, { mode: 0o700, recursive: true })
    fs.writeFileSync(scriptPath, childProgram, { mode: 0o600 })
    let child
    let finished = false
    let overflow = false
    let stderr = Buffer.alloc(0)
    let stdout = Buffer.alloc(0)
    const complete = (callback) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      fs.rmSync(tempRoot, { force: true, recursive: true })
      callback()
    }
    const append = (current, chunk) => {
      const next = Buffer.concat([current, Buffer.from(chunk)])
      if (next.length <= childOutputLimitBytes) return next
      overflow = true
      child?.kill('SIGKILL')
      return next.subarray(0, childOutputLimitBytes)
    }
    try {
      child = spawnChild(executablePath, [scriptPath, authorityPackageRoot, operationRoot], {
        env: {
          ELECTRON_RUN_AS_NODE: '1',
          HOME: tempRoot,
          LANG: process.env.LANG ?? 'C',
          NODE_ENV: 'test',
          PATH: process.env.PATH ?? '/usr/bin:/bin',
          TMPDIR: tempRoot
        },
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch {
      fs.rmSync(tempRoot, { force: true, recursive: true })
      reject(new PackagedAuthorityDiagnosticError('diagnostic_launch_failed'))
      return
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      complete(() => reject(new PackagedAuthorityDiagnosticError('diagnostic_timeout')))
    }, timeoutMs)
    child.stdout.on('data', chunk => {
      stdout = append(stdout, chunk)
    })
    child.stderr.on('data', chunk => {
      stderr = append(stderr, chunk)
    })
    child.once('error', () => {
      complete(() => reject(new PackagedAuthorityDiagnosticError('diagnostic_launch_failed')))
    })
    child.once('close', (code, signal) => {
      complete(() => {
        if (overflow) {
          reject(new PackagedAuthorityDiagnosticError('diagnostic_output_overflow'))
          return
        }
        if (signal != null) {
          reject(new PackagedAuthorityDiagnosticError('diagnostic_launch_failed'))
          return
        }
        try {
          const result = decodeChildResult(stdout.toString('utf8'))
          if (result.ok) {
            if (code !== 0) {
              reject(new PackagedAuthorityDiagnosticError('diagnostic_launch_failed'))
              return
            }
            resolve(result)
            return
          }
          if (typeof code !== 'number' || code === 0) {
            reject(new PackagedAuthorityDiagnosticError('diagnostic_output_invalid'))
            return
          }
          reject(new PackagedAuthorityDiagnosticError(result.errorCode, result.phase))
        } catch (error) {
          reject(error)
        }
      })
    })
  })

const diagnosePackagedAuthority = async ({
  arch,
  env = process.env,
  outputDir,
  platform = process.platform,
  ...options
}) => {
  const target = resolvePackagedAuthorityTarget({ arch, env, outputDir, platform })
  return await runPackagedAuthorityDiagnostic({ ...target, ...options })
}

const runCli = async () => {
  if (process.argv.length !== 3) fail('diagnostic_app_missing')
  const result = await diagnosePackagedAuthority({ outputDir: path.resolve(process.argv[2]) })
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

if (require.main === module) {
  runCli().catch(error => {
    const normalized = error instanceof PackagedAuthorityDiagnosticError
      ? error
      : new PackagedAuthorityDiagnosticError('diagnostic_output_invalid')
    process.stderr.write(`${
      JSON.stringify({
        errorCode: normalized.code,
        ok: false,
        phase: normalized.phase
      })
    }\n`)
    process.exitCode = 1
  })
}

module.exports = {
  PackagedAuthorityDiagnosticError,
  allowedErrorCodes,
  allowedPhases,
  diagnosePackagedAuthority,
  parseChildResult,
  resolvePackagedAuthorityTarget,
  runPackagedAuthorityDiagnostic
}
