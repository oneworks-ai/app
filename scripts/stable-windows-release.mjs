import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    ...options
  })
  if (result.error != null) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} failed (${result.status}): ${result.stderr?.trim() ?? ''}`)
  }
  return result.stdout?.trim() ?? ''
}

export const shouldBuildStableWindowsAsset = (packages, publishAll) => (
  publishAll === 'true' || packages.split(',').map(value => value.trim()).includes('oneworks')
)

export const assertStableVersion = version => {
  if (!/^\d+\.\d+\.\d+$/u.test(version)) {
    throw new Error(`Windows stable asset requires stable semver, received: ${version}`)
  }
  return version
}

export const buildWindowsAssetNames = version => ({
  archiveName: `oneworks-windows-${assertStableVersion(version)}.zip`,
  checksumName: `oneworks-windows-${version}.sha256`,
  releaseTag: `pkg/oneworks/v${version}`
})

const writeOutput = (name, value) => {
  if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required.')
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`)
}

const build = () => {
  if (!shouldBuildStableWindowsAsset(process.env.PACKAGES ?? '', process.env.PUBLISH_ALL ?? 'false')) {
    writeOutput('should_publish', 'false')
    process.stdout.write('Stable publish does not include oneworks; skipping the Windows portable asset.\n')
    return
  }

  const version = assertStableVersion(JSON.parse(readFileSync('apps/bootstrap/package.json', 'utf8')).version)
  const publishedVersion = run('npm', [
    'view',
    `oneworks@${version}`,
    'version',
    '--registry',
    'https://registry.npmjs.org'
  ])
  if (publishedVersion !== version) {
    throw new Error(`Registry version mismatch: expected ${version}, received ${publishedVersion}`)
  }

  const outputRoot = process.env.RUNNER_TEMP ?? tmpdir()
  const payloadDir = path.join(outputRoot, `oneworks-windows-${version}`)
  const names = buildWindowsAssetNames(version)
  const archive = path.join(outputRoot, names.archiveName)
  const checksum = path.join(outputRoot, names.checksumName)
  run('pnpm', [
    'tools',
    'windows-install',
    'package-oneworks',
    '--version',
    version,
    '--out-dir',
    payloadDir
  ], { stdio: 'inherit' })

  const payloadNames = ['README.txt', 'oneworks.cmd', 'ow.cmd', 'owo.cmd']
  const fixedTime = new Date('1980-01-01T00:00:00.000Z')
  for (const name of payloadNames) utimesSync(path.join(payloadDir, name), fixedTime, fixedTime)
  run('zip', ['-X', '-q', archive, ...payloadNames], { cwd: payloadDir })
  const digest = createHash('sha256').update(readFileSync(archive)).digest('hex')
  writeFileSync(checksum, `${digest}  ${names.archiveName}\n`)

  writeOutput('archive', archive)
  writeOutput('checksum', checksum)
  writeOutput('should_publish', 'true')
  writeOutput('tag', names.releaseTag)
  writeOutput('version', version)
}

const publish = () => {
  const archive = process.env.ARCHIVE
  const checksum = process.env.CHECKSUM
  const releaseTag = process.env.RELEASE_TAG
  const version = assertStableVersion(process.env.VERSION ?? '')
  if (!archive || !checksum || !releaseTag) throw new Error('Release asset paths and tag are required.')

  const releaseView = spawnSync('gh', ['release', 'view', releaseTag, '--json', 'assets'], {
    encoding: 'utf8'
  })
  if (releaseView.status !== 0) {
    run('gh', [
      'release',
      'create',
      releaseTag,
      '--verify-tag',
      '--title',
      `oneworks v${version}`,
      '--notes',
      `Stable One Works CLI ${version} release assets.`
    ], { stdio: 'inherit' })
  }

  const assets = releaseView.status === 0
    ? JSON.parse(releaseView.stdout).assets.map(asset => asset.name)
    : []
  for (const asset of [archive, checksum]) {
    const name = path.basename(asset)
    if (!assets.includes(name)) {
      run('gh', ['release', 'upload', releaseTag, asset], { stdio: 'inherit' })
      continue
    }

    const existingDir = mkdtempSync(path.join(tmpdir(), `oneworks-release-${name}-`))
    run('gh', ['release', 'download', releaseTag, '--pattern', name, '--dir', existingDir])
    if (!readFileSync(asset).equals(readFileSync(path.join(existingDir, name)))) {
      throw new Error(`Existing release asset differs: ${name}`)
    }
    process.stdout.write(`Reusing byte-identical release asset: ${name}\n`)
  }
}

if (process.argv[1] != null && fileURLToPath(import.meta.url) === process.argv[1]) {
  const command = process.argv[2]
  if (command === 'build') build()
  else if (command === 'publish') publish()
  else throw new Error(`Unknown stable Windows release command: ${command ?? ''}`)
}
