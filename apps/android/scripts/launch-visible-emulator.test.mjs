import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import process from 'node:process'

// The repository Vitest projects do not include apps/android/scripts, so this isolated launcher test uses Node's runner.
// eslint-disable-next-line test/no-import-node-test
import test from 'node:test'

const repoRoot = resolve(new URL('../../../', import.meta.url).pathname)
const launcher = resolve(repoRoot, 'apps/android/scripts/launch-visible-emulator.mjs')

test('reused emulator is associated with its exact AVD instead of adb device order', () => {
  const fixtureRoot = mkdtempSync(resolve(tmpdir(), 'oneworks-android-emulator-test-'))
  const fakeBin = resolve(fixtureRoot, 'bin')
  const fakeLogDir = resolve(fixtureRoot, 'logs')
  const fakeSdk = resolve(fixtureRoot, 'sdk')
  const avd = `CodexAssociationTest${process.pid}`
  const service = `ai.oneworks.android.emulator.${avd.toLowerCase()}`
  const pidPath = resolve(fakeLogDir, `${service}.pid`)
  mkdirSync(fakeBin, { recursive: true })
  mkdirSync(resolve(fakeSdk, 'emulator'), { recursive: true })
  mkdirSync(fakeLogDir, { recursive: true })

  const adbPath = resolve(fakeBin, 'adb')
  writeFileSync(
    adbPath,
    `#!/usr/bin/env node
const args = process.argv.slice(2)
if (args[0] === 'devices') console.log('List of devices attached\\nemulator-5554\\tdevice\\nemulator-5556\\tdevice')
else if (args[2] === 'emu') console.log(args[1] === 'emulator-5556' ? process.env.EXPECTED_AVD + '\\nOK' : 'UnrelatedAvd\\nOK')
else if (args[2] === 'shell') console.log('1')
else process.exitCode = 1
`
  )
  chmodSync(adbPath, 0o755)
  const emulatorPath = resolve(fakeSdk, 'emulator/emulator')
  writeFileSync(emulatorPath, '#!/usr/bin/env node\nsetInterval(() => {}, 60_000)\n')
  chmodSync(emulatorPath, 0o755)

  const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 60_000)'], { stdio: 'ignore' })
  const emulatorProcess = spawn(emulatorPath, ['-avd', avd, '-no-audio'], { stdio: 'ignore' })
  writeFileSync(pidPath, `${unrelated.pid}\n`)
  try {
    const result = spawnSync(process.execPath, [launcher, '--avd', avd], {
      encoding: 'utf8',
      env: {
        ...process.env,
        ANDROID_HOME: fakeSdk,
        EXPECTED_AVD: avd,
        ONEWORKS_ANDROID_OWNER_ROOT: repoRoot,
        ONEWORKS_ANDROID_SERVICE_LOG_DIR: fakeLogDir,
        PATH: `${fakeBin}:${process.env.PATH}`
      }
    })

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, new RegExp(`reusing ${service} pid=${emulatorProcess.pid}`))
    assert.doesNotMatch(result.stdout, new RegExp(`pid=${unrelated.pid}`))
    assert.match(result.stdout, /device=emulator-5556/)
    assert.doesNotMatch(result.stdout, /device=emulator-5554/)

    const coordinatedRegistry = JSON.parse(readFileSync(pidPath, 'utf8'))
    assert.equal(coordinatedRegistry.coordination, 'dev-service')
    assert.equal(coordinatedRegistry.ownerRoot, repoRoot)

    const directResult = spawnSync(process.execPath, [launcher, '--avd', avd], {
      encoding: 'utf8',
      env: {
        ...process.env,
        ANDROID_HOME: fakeSdk,
        EXPECTED_AVD: avd,
        ONEWORKS_ANDROID_SERVICE_LOG_DIR: fakeLogDir,
        PATH: `${fakeBin}:${process.env.PATH}`
      }
    })
    assert.equal(directResult.status, 0, directResult.stderr)
    const directRegistry = JSON.parse(readFileSync(pidPath, 'utf8'))
    assert.equal(directRegistry.coordination, 'dev-service')
    assert.equal(directRegistry.ownerRoot, repoRoot)

    const directRestart = spawnSync(process.execPath, [launcher, '--avd', avd, '--restart'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        ANDROID_HOME: fakeSdk,
        EXPECTED_AVD: avd,
        ONEWORKS_ANDROID_SERVICE_LOG_DIR: fakeLogDir,
        PATH: `${fakeBin}:${process.env.PATH}`
      }
    })
    assert.notEqual(directRestart.status, 0)
    assert.match(directRestart.stderr, /--restart requires the machine-level dev-service lease/)
  } finally {
    if (unrelated.exitCode === null) unrelated.kill('SIGTERM')
    if (emulatorProcess.exitCode === null) emulatorProcess.kill('SIGTERM')
    rmSync(pidPath, { force: true })
    rmSync(fixtureRoot, { force: true, recursive: true })
  }
})
