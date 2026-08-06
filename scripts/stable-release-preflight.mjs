import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { loadWorkspacePackages } from './publish-plan-core.mjs'
import installerIdentity from './windows-installer-identity.cjs'

const { assertWingetInstallerTemplate } = installerIdentity

const STABLE_VERSION_PATTERN = /^\d+\.\d+\.\d+$/u
const VSCODE_PACKAGE_NAME = '@oneworks/vscode-extension'

const parseArgs = argv => {
  const result = {}
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--version') result.version = argv[++index]
    else if (value === '--vscode-version') result.vscodeVersion = argv[++index]
    else throw new Error(`Unknown stable release preflight argument: ${value}`)
  }
  if (!result.version || !result.vscodeVersion) {
    throw new Error('Stable release preflight requires --version and --vscode-version.')
  }
  return result
}

export const evaluateStablePackageGraph = (input, packages) => {
  const errors = []
  if (!STABLE_VERSION_PATTERN.test(input.version)) {
    errors.push(`Coordinated version is not stable semver: ${input.version}`)
  }
  if (!STABLE_VERSION_PATTERN.test(input.vscodeVersion)) {
    errors.push(`VS Code version is not stable semver: ${input.vscodeVersion}`)
  }

  for (const pkg of packages) {
    const expectedVersion = pkg.name === VSCODE_PACKAGE_NAME ? input.vscodeVersion : input.version
    if (pkg.version !== expectedVersion) {
      errors.push(`${pkg.name} has version ${pkg.version}; expected ${expectedVersion}`)
    }
    if (pkg.license !== 'MIT') {
      errors.push(`${pkg.name} must declare license MIT`)
    }
    if (pkg.pluginVersion != null && pkg.pluginVersion !== pkg.version) {
      errors.push(`${pkg.name} plugin.json version ${pkg.pluginVersion} does not match ${pkg.version}`)
    }
  }

  return errors
}

const readJson = async filePath => JSON.parse(await readFile(filePath, 'utf8'))

const readPluginVersion = async packageDir => {
  try {
    const manifest = await readJson(path.join(packageDir, 'plugin.json'))
    return manifest.version
  } catch (error) {
    if (error.code === 'ENOENT') return undefined
    throw error
  }
}

const assertFileContains = async (filePath, expected, errors) => {
  const content = await readFile(filePath, 'utf8')
  if (!content.includes(expected)) errors.push(`${filePath} is missing ${expected}`)
}

export const validateStableWingetInstallerTemplate = (content, version) => {
  try {
    assertWingetInstallerTemplate(content, { version })
    return []
  } catch (error) {
    return [error.message]
  }
}

export const runStableReleasePreflight = async (argv = process.argv.slice(2)) => {
  const input = parseArgs(argv)
  const repoRoot = process.cwd()
  const workspacePackages = await loadWorkspacePackages(repoRoot)
  const packages = []
  for (const pkg of workspacePackages.values()) {
    if (pkg.publishAliasFor != null) continue
    packages.push({
      name: pkg.name,
      version: pkg.json.version,
      license: pkg.json.license,
      pluginVersion: await readPluginVersion(pkg.dir)
    })
  }

  const rootManifest = await readJson(path.join(repoRoot, 'package.json'))
  packages.push({
    name: rootManifest.name,
    version: rootManifest.version,
    license: rootManifest.license
  })

  const errors = evaluateStablePackageGraph(input, packages)
  await assertFileContains(
    path.join(repoRoot, 'changelog', input.version, 'readme.md'),
    `# One Works ${input.version}`,
    errors
  )
  await assertFileContains(
    path.join(repoRoot, 'changelog', input.vscodeVersion, 'vscode-extension.md'),
    `# @oneworks/vscode-extension ${input.vscodeVersion}`,
    errors
  )
  for (
    const relativePath of [
      'infra/windows/winget/OneWorks.OneWorks.yaml',
      'infra/windows/winget/OneWorks.OneWorks.locale.en-US.yaml',
      'infra/windows/winget/OneWorks.OneWorks.installer.template.yaml'
    ]
  ) {
    await assertFileContains(
      path.join(repoRoot, relativePath),
      `PackageVersion: ${input.version}`,
      errors
    )
  }
  const installerTemplate = path.join(repoRoot, 'infra/windows/winget/OneWorks.OneWorks.installer.template.yaml')
  errors.push(...validateStableWingetInstallerTemplate(await readFile(installerTemplate, 'utf8'), input.version))

  const result = {
    ok: errors.length === 0,
    packageCount: packages.length,
    version: input.version,
    vscodeVersion: input.vscodeVersion,
    errors
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (errors.length > 0) process.exitCode = 1
  return result
}

if (process.argv[1] != null && fileURLToPath(import.meta.url) === process.argv[1]) {
  await runStableReleasePreflight()
}
