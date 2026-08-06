const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { resolveDesktopAppMetadata } = require('./desktop-app-metadata.cjs')
const { verifyAdHocAppBundle } = require('./mac-adhoc-seal.cjs')

const appMetadata = resolveDesktopAppMetadata()
const desktopPackage = require('../package.json')
const supportedArchitectures = new Set(['arm64', 'x64'])
const supportedTargets = new Set(['dmg', 'pkg', 'zip'])

const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: 'pipe' })
  if (result.error != null) throw result.error
  if (result.status !== 0) {
    throw new Error(
      [
        `${command} ${args.join(' ')} failed with exit code ${result.status}`,
        result.stdout,
        result.stderr
      ].filter(Boolean).join('\n')
    )
  }
  return `${result.stdout ?? ''}${result.stderr ?? ''}`
}

const parseCsv = ({ allowed, name, value }) => {
  const values = String(value ?? '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
  if (values.length === 0 || values.some(value => !allowed.has(value))) {
    throw new Error(`Unsupported or empty ${name}: ${value}.`)
  }
  return values
}

const findProductAppBundle = root => {
  const expectedName = `${appMetadata.productName}.app`
  const matches = []
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const entryPath = path.join(directory, entry.name)
      if (entry.name === expectedName) {
        matches.push(entryPath)
      } else {
        visit(entryPath)
      }
    }
  }
  visit(root)
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${expectedName} in ${root}, found ${matches.length}.`)
  }
  return matches[0]
}

const verifyExtractedAppBundle = ({ appPath, architecture, runCommand = run }) => {
  verifyAdHocAppBundle({ appPath, runCommand })
  const executablePath = path.join(
    appPath,
    'Contents',
    'MacOS',
    appMetadata.executableName
  )
  const expectedArchitecture = architecture === 'x64' ? 'x86_64' : architecture
  const actualArchitectures = runCommand('lipo', ['-archs', executablePath]).trim().split(/\s+/u)
  if (actualArchitectures.length !== 1 || actualArchitectures[0] !== expectedArchitecture) {
    throw new Error(
      `Expected ${architecture} executable in ${appPath}, found ${actualArchitectures.join(', ')}.`
    )
  }
}

const verifyDmg = ({ architecture, artifactPath, temporaryRoot }) => {
  const mountPath = path.join(temporaryRoot, 'mount')
  fs.mkdirSync(mountPath)
  let mounted = false
  try {
    run('hdiutil', ['attach', artifactPath, '-nobrowse', '-readonly', '-mountpoint', mountPath])
    mounted = true
    verifyExtractedAppBundle({
      appPath: findProductAppBundle(mountPath),
      architecture
    })
  } finally {
    if (mounted) run('hdiutil', ['detach', mountPath])
  }
}

const verifyZip = ({ architecture, artifactPath, temporaryRoot }) => {
  const extractPath = path.join(temporaryRoot, 'zip')
  fs.mkdirSync(extractPath)
  run('ditto', ['-x', '-k', artifactPath, extractPath])
  verifyExtractedAppBundle({
    appPath: findProductAppBundle(extractPath),
    architecture
  })
}

const verifyPkg = ({ architecture, artifactPath, temporaryRoot }) => {
  const expandPath = path.join(temporaryRoot, 'pkg')
  run('pkgutil', ['--expand-full', artifactPath, expandPath])
  verifyExtractedAppBundle({
    appPath: findProductAppBundle(expandPath),
    architecture
  })
}

const verifyAdHocArtifactMatrix = ({ architectures, releaseDirectory, targets, version }) => {
  if (process.platform !== 'darwin') {
    throw new Error('macOS artifact verification can only run on darwin.')
  }
  for (const architecture of architectures) {
    for (const target of targets) {
      const artifactPath = path.join(
        releaseDirectory,
        `${appMetadata.artifactBaseName}-${version}-mac-${architecture}.${target}`
      )
      if (!fs.existsSync(artifactPath)) {
        throw new Error(`Expected desktop artifact was not found: ${artifactPath}`)
      }
      const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), `oneworks-${architecture}-${target}-`))
      try {
        const verify = { dmg: verifyDmg, pkg: verifyPkg, zip: verifyZip }[target]
        verify({ architecture, artifactPath, temporaryRoot })
        console.log(`[desktop] verified ad-hoc ${architecture} ${target}: ${artifactPath}`)
      } finally {
        fs.rmSync(temporaryRoot, { force: true, recursive: true })
      }
    }
  }
}

const runCli = () => {
  const releaseDirectory = path.resolve(process.argv[2] ?? 'apps/desktop/release')
  verifyAdHocArtifactMatrix({
    architectures: parseCsv({
      allowed: supportedArchitectures,
      name: 'architectures',
      value: process.env.ONEWORKS_DESKTOP_ARCHS
    }),
    releaseDirectory,
    targets: parseCsv({
      allowed: supportedTargets,
      name: 'targets',
      value: process.env.ONEWORKS_DESKTOP_MAKE_TARGETS
    }),
    version: process.env.ONEWORKS_DESKTOP_VERSION?.trim() || desktopPackage.version
  })
}

if (require.main === module) {
  try {
    runCli()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

module.exports = {
  findProductAppBundle,
  verifyAdHocArtifactMatrix,
  verifyExtractedAppBundle
}
