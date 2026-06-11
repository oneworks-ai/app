import { access, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, '..')
const repositoryDirectory = 'apps/vscode-extension'
const repositoryUrl = 'git+https://github.com/oneworks-ai/app.git'

export function getAppRoot() {
  return appRoot
}

export function getVsceBinaryPath() {
  return resolve(
    appRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'vsce.cmd' : 'vsce'
  )
}

export async function readSourceManifest() {
  return JSON.parse(
    await readFile(resolve(appRoot, 'package.json'), 'utf8')
  )
}

export function resolveExtensionName(sourceManifest) {
  const configured = sourceManifest.oneWorksRelease?.extensionName

  if (typeof configured === 'string' && configured.trim().length > 0) {
    return configured.trim()
  }

  return 'oneworks-vscode-extension'
}

export function resolveExtensionPublisher(environment = process.env) {
  const configured = environment.VSCODE_EXTENSION_PUBLISHER?.trim()

  return configured || 'oneworks-ai'
}

export async function createReleaseStage(options = {}) {
  const sourceManifest = await readSourceManifest()
  const extensionName = options.extensionName ?? resolveExtensionName(sourceManifest)
  const publisher = options.publisher ?? resolveExtensionPublisher()
  const prerelease = isPrereleaseVersion(sourceManifest.version)
  const marketplaceVersion = resolveMarketplaceVersion(sourceManifest.version)
  const stageDir = await mkdtemp(resolve(tmpdir(), 'oneworks-vscode-extension-'))

  try {
    await access(resolve(appRoot, 'dist', 'extension.js'))
    await cp(resolve(appRoot, 'dist'), resolve(stageDir, 'dist'), {
      recursive: true
    })
    await cp(resolve(appRoot, 'README.md'), resolve(stageDir, 'README.md'))
    await cp(resolve(appRoot, 'resources'), resolve(stageDir, 'resources'), {
      recursive: true
    })

    const releaseManifest = {
      name: extensionName,
      publisher,
      version: marketplaceVersion,
      displayName: sourceManifest.displayName,
      description: sourceManifest.description,
      license: sourceManifest.license,
      categories: sourceManifest.categories,
      main: sourceManifest.main,
      engines: sourceManifest.engines,
      extensionKind: sourceManifest.extensionKind,
      capabilities: sourceManifest.capabilities,
      files: [
        'dist/**',
        'README.md',
        'resources/**'
      ],
      contributes: sourceManifest.contributes,
      repository: {
        type: 'git',
        url: repositoryUrl,
        directory: repositoryDirectory
      }
    }

    validateReleaseManifest(releaseManifest)

    await writeFile(
      resolve(stageDir, 'package.json'),
      JSON.stringify(releaseManifest, null, 2)
    )

    return {
      stageDir,
      cleanup: () =>
        rm(stageDir, {
          recursive: true,
          force: true
        }),
      manifest: releaseManifest,
      prerelease,
      sourceVersion: sourceManifest.version
    }
  } catch (error) {
    await rm(stageDir, {
      recursive: true,
      force: true
    })
    throw error
  }
}

export function resolveVsixPath(version, extensionName, outputPath) {
  return resolve(
    appRoot,
    outputPath ?? `${extensionName}-v${version}.vsix`
  )
}

export function isPrereleaseVersion(version) {
  return version.includes('-')
}

export function resolveMarketplaceVersion(version) {
  const match = version.match(/^(\d+\.\d+\.\d+)(?:-.+)?$/u)

  if (!match) {
    throw new Error(
      `Invalid VS Code extension version "${version}". Expected major.minor.patch or a prerelease variant.`
    )
  }

  return match[1]
}

function validateReleaseManifest(manifest) {
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(manifest.name)) {
    throw new Error(
      `Invalid VS Code extension release name "${manifest.name}". Use lowercase letters, numbers, and dashes only.`
    )
  }

  if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/u.test(manifest.publisher)) {
    throw new Error(
      `Invalid VS Code Marketplace publisher "${manifest.publisher}". Set VSCODE_EXTENSION_PUBLISHER to a valid publisher id.`
    )
  }
}
