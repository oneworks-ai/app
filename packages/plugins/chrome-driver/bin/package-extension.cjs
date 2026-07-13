#!/usr/bin/env node
const { execFileSync } = require('node:child_process')
const { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { dirname, join, relative, resolve, sep } = require('node:path')
const process = require('node:process')
const { zipSync } = require('fflate')

const {
  archiveFileName,
  assertReleaseFlavor,
  packageManifest,
  pluginRoot
} = require('./extension-release.cjs')
const { validateExtensionArchive } = require('./validate-extension-package.cjs')

const readArgument = (name) => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const listFiles = (directory) =>
  readdirSync(directory, { withFileTypes: true })
    .flatMap(entry => {
      const path = join(directory, entry.name)
      return entry.isDirectory() ? listFiles(path) : [path]
    })
    .sort()

const buildArchiveEntries = (directory) =>
  Object.fromEntries(
    listFiles(directory).map(filePath => [
      relative(directory, filePath).split(sep).join('/'),
      [new Uint8Array(readFileSync(filePath)), { mtime: new Date(2000, 0, 1, 0, 0, 0) }]
    ])
  )

const packageExtension = ({ flavor, output }) => {
  assertReleaseFlavor(flavor)
  const archivePath = resolve(output ?? join(pluginRoot, 'dist-package', archiveFileName(flavor)))
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'oneworks-external-browser-package-'))
  const materialized = join(temporaryRoot, flavor)
  try {
    execFileSync(process.execPath, [
      join(pluginRoot, 'bin', 'materialize-extension.cjs'),
      ...(flavor === 'base' ? ['--minimal'] : []),
      '--output',
      materialized
    ], { stdio: ['ignore', 'ignore', 'inherit'] })
    mkdirSync(dirname(archivePath), { recursive: true })
    const archive = zipSync(buildArchiveEntries(materialized), { level: 9 })
    writeFileSync(archivePath, archive)
    return validateExtensionArchive({
      archivePath,
      flavor,
      packageVersion: packageManifest.version
    })
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
}

const main = () => {
  const flavor = readArgument('--flavor') ?? 'privileged'
  const output = readArgument('--output')
  process.stdout.write(`${JSON.stringify(packageExtension({ flavor, output }))}\n`)
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

module.exports = { buildArchiveEntries, packageExtension }
