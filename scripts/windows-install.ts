/* eslint-disable max-lines -- windows install sync coordinates Scoop, winget, and release asset metadata. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { computeUrlSha256, normalizeOneWorksVersion } from './cli-package-release'
import installerIdentity from './windows-installer-identity.cjs'

const {
  assertWingetInstallerTemplate,
  buildCanonicalScoopInstallerUrl,
  buildCanonicalWingetInstallerUrl,
  buildStableWindowsMsiProductCode
} = installerIdentity

const DEFAULT_SCOOP_MANIFEST_PATH = 'infra/windows/scoop-bucket/bucket/oneworks.json'
const DEFAULT_WINGET_VERSION_MANIFEST_PATH = 'infra/windows/winget/OneWorks.OneWorks.yaml'
const DEFAULT_WINGET_LOCALE_MANIFEST_PATH = 'infra/windows/winget/OneWorks.OneWorks.locale.en-US.yaml'
const DEFAULT_WINGET_TEMPLATE_PATH = 'infra/windows/winget/OneWorks.OneWorks.installer.template.yaml'

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value != null && !Array.isArray(value)
)

export const buildDefaultScoopInstallerUrl = buildCanonicalScoopInstallerUrl
export const buildDefaultWingetInstallerUrl = buildCanonicalWingetInstallerUrl

export const buildWindowsPortableCommand = (version: string, command: string) => {
  const normalizedVersion = normalizeOneWorksVersion(version)
  if (!['oneworks', 'ow', 'owo'].includes(command)) {
    throw new Error(`Unsupported One Works Windows command: ${command}`)
  }

  return [
    '@echo off',
    'setlocal',
    `npx --yes --package "oneworks@${normalizedVersion}" ${command} %*`,
    'exit /b %errorlevel%',
    ''
  ].join('\r\n')
}

export const runWindowsPortablePackage = async (input: {
  version: string
  outDir: string
  cwd?: string
  stdout?: Pick<NodeJS.WriteStream, 'write'>
}) => {
  const cwd = input.cwd ?? process.cwd()
  const version = normalizeOneWorksVersion(input.version)
  const outDir = path.resolve(cwd, input.outDir)
  const commands = ['oneworks', 'ow', 'owo'] as const

  await mkdir(outDir, { recursive: true })
  await Promise.all(commands.map(async command => {
    await writeFile(path.join(outDir, `${command}.cmd`), buildWindowsPortableCommand(version, command))
  }))

  const readmePath = path.join(outDir, 'README.txt')
  await writeFile(
    readmePath,
    [
      `One Works ${version}`,
      '',
      'Requires Node.js 22 or newer with npm/npx available on PATH.',
      'Commands: oneworks, ow, owo',
      ''
    ].join('\r\n')
  )

  const stdout = input.stdout ?? process.stdout
  stdout.write(`[windows-install] packaged Windows launchers in ${path.relative(cwd, outDir)}\n`)

  return {
    commands: commands.map(command => path.join(outDir, `${command}.cmd`)),
    outDir,
    readmePath,
    version
  }
}

export const buildInitialScoopManifest = (input: {
  installerSha256: string
  installerUrl: string
  version: string
}) =>
  `${
    JSON.stringify(
      {
        version: normalizeOneWorksVersion(input.version),
        description: 'One Works AI-native workspace launcher',
        homepage: 'https://oneworks.cloud',
        license: 'MIT',
        url: input.installerUrl,
        hash: input.installerSha256,
        bin: ['oneworks.cmd', 'ow.cmd', 'owo.cmd'],
        depends: 'nodejs-lts',
        autoupdate: {
          url:
            'https://github.com/oneworks-ai/app/releases/download/pkg/oneworks/v$version/oneworks-windows-$version.zip'
        }
      },
      null,
      2
    )
  }\n`

const replaceRequiredLine = (
  content: string,
  pattern: RegExp,
  replacement: string | ((indent: string) => string),
  field: string
) => {
  let matched = false
  const nextContent = content.replace(pattern, (_match: string, indent: string | undefined) => {
    matched = true
    return typeof replacement === 'function' ? replacement(indent ?? '') : replacement
  })

  if (!matched) {
    throw new Error(`Winget template was not updated. Missing ${field}.`)
  }

  return nextContent
}

export const updateScoopManifest = (
  content: string,
  input: {
    installerSha256: string
    installerUrl: string
    version: string
  }
) => {
  const manifest = JSON.parse(content) as unknown
  if (!isRecord(manifest)) {
    throw new Error('Scoop manifest must be a JSON object.')
  }

  manifest.version = normalizeOneWorksVersion(input.version)
  manifest.url = input.installerUrl
  manifest.hash = input.installerSha256

  const autoupdate = manifest.autoupdate
  if (isRecord(autoupdate)) {
    autoupdate.url =
      'https://github.com/oneworks-ai/app/releases/download/pkg/oneworks/v$version/oneworks-windows-$version.zip'
  }

  return `${JSON.stringify(manifest, null, 2)}\n`
}

const readScoopManifestOrBuildInitial = async (
  manifestPath: string,
  input: { installerSha256: string; installerUrl: string; version: string }
) => {
  try {
    return await readFile(manifestPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return buildInitialScoopManifest(input)
  }
}

export const updateWingetPackageVersion = (content: string, version: string) => (
  replaceRequiredLine(
    content,
    /^PackageVersion: .+$/m,
    `PackageVersion: ${normalizeOneWorksVersion(version)}`,
    'PackageVersion'
  )
)

export const updateWingetInstallerTemplate = (
  content: string,
  input: {
    installerSha256: string
    installerUrl: string
    version: string
  }
) => {
  const version = normalizeOneWorksVersion(input.version)
  let nextContent = updateWingetPackageVersion(content, version)

  nextContent = replaceRequiredLine(
    nextContent,
    /^(\s*)InstallerUrl: .+$/m,
    indent => `${indent}InstallerUrl: ${input.installerUrl}`,
    'InstallerUrl'
  )
  nextContent = replaceRequiredLine(
    nextContent,
    /^(\s*)InstallerSha256: .+$/m,
    indent => `${indent}InstallerSha256: ${input.installerSha256}`,
    'InstallerSha256'
  )
  nextContent = replaceRequiredLine(
    nextContent,
    /^(\s*)ProductCode: .+$/m,
    indent => `${indent}ProductCode: '${buildStableWindowsMsiProductCode(version)}'`,
    'ProductCode'
  )
  assertWingetInstallerTemplate(nextContent, { installerSha256: input.installerSha256, version })

  return nextContent
}

export const runWindowsInstallSyncOneWorks = async (input: {
  version: string
  dryRun?: boolean
  cwd?: string
  scoopManifestPath?: string
  computeUrlSha256?: (url: string) => Promise<string>
  stdout?: Pick<NodeJS.WriteStream, 'write'>
  wingetInstallerSha256: string
  wingetInstallerUrl: string
  wingetLocaleManifestPath?: string
  wingetTemplatePath?: string
  wingetVersionManifestPath?: string
}) => {
  const cwd = input.cwd ?? process.cwd()
  const version = normalizeOneWorksVersion(input.version)
  const scoopManifestPath = path.resolve(cwd, input.scoopManifestPath ?? DEFAULT_SCOOP_MANIFEST_PATH)
  const wingetVersionManifestPath = path.resolve(
    cwd,
    input.wingetVersionManifestPath ?? DEFAULT_WINGET_VERSION_MANIFEST_PATH
  )
  const wingetLocaleManifestPath = path.resolve(
    cwd,
    input.wingetLocaleManifestPath ?? DEFAULT_WINGET_LOCALE_MANIFEST_PATH
  )
  const wingetTemplatePath = path.resolve(cwd, input.wingetTemplatePath ?? DEFAULT_WINGET_TEMPLATE_PATH)
  const scoopInstallerUrl = buildDefaultScoopInstallerUrl(version)
  const wingetInstallerUrl = input.wingetInstallerUrl
  const wingetInstallerSha256 = input.wingetInstallerSha256
  if (wingetInstallerUrl !== buildDefaultWingetInstallerUrl(version)) {
    throw new Error('Winget installer URL must be the canonical MSI URL for the release version.')
  }
  if (!/^[a-f0-9]{64}$/u.test(wingetInstallerSha256)) {
    throw new Error('Winget installer SHA-256 must be lowercase hexadecimal.')
  }
  const stdout = input.stdout ?? process.stdout
  const downloader = input.computeUrlSha256 ?? computeUrlSha256
  const scoopInstallerSha256 = await downloader(scoopInstallerUrl)
  const downloadedWingetSha256 = await downloader(wingetInstallerUrl)
  if (!/^[a-f0-9]{64}$/u.test(scoopInstallerSha256)) {
    throw new Error('Scoop installer SHA-256 must be lowercase hexadecimal.')
  }
  if (!/^[a-f0-9]{64}$/u.test(downloadedWingetSha256)) {
    throw new Error('Downloaded Winget installer SHA-256 must be lowercase hexadecimal.')
  }
  if (downloadedWingetSha256 !== wingetInstallerSha256) {
    throw new Error('Winget installer SHA-256 does not match downloaded MSI bytes.')
  }

  const scoopContent = await readScoopManifestOrBuildInitial(scoopManifestPath, {
    version,
    installerUrl: scoopInstallerUrl,
    installerSha256: scoopInstallerSha256
  })
  const nextScoopContent = updateScoopManifest(scoopContent, {
    version,
    installerUrl: scoopInstallerUrl,
    installerSha256: scoopInstallerSha256
  })

  const wingetVersionContent = await readFile(wingetVersionManifestPath, 'utf8')
  const nextWingetVersionContent = updateWingetPackageVersion(wingetVersionContent, version)

  const wingetLocaleContent = await readFile(wingetLocaleManifestPath, 'utf8')
  const nextWingetLocaleContent = updateWingetPackageVersion(wingetLocaleContent, version)

  const wingetInstallerContent = await readFile(wingetTemplatePath, 'utf8')
  const nextWingetInstallerContent = updateWingetInstallerTemplate(wingetInstallerContent, {
    version,
    installerUrl: wingetInstallerUrl,
    installerSha256: wingetInstallerSha256
  })

  if (input.dryRun === true) {
    stdout.write(`[windows-install] ${scoopManifestPath}\n`)
    stdout.write(`[windows-install] scoop installer ${scoopInstallerUrl}\n`)
    stdout.write(`[windows-install] scoop installer sha256 ${scoopInstallerSha256}\n`)
    stdout.write(`[windows-install] winget version ${wingetVersionManifestPath}\n`)
    stdout.write(`[windows-install] winget locale ${wingetLocaleManifestPath}\n`)
    stdout.write(`[windows-install] winget template ${wingetTemplatePath}\n`)
    stdout.write(`[windows-install] winget installer ${wingetInstallerUrl}\n`)
    stdout.write(`[windows-install] winget installer sha256 ${wingetInstallerSha256}\n`)
    stdout.write('[windows-install] dry run: files not written\n')
    return {
      scoopManifestPath,
      scoopInstallerSha256,
      scoopInstallerUrl,
      wingetInstallerSha256,
      wingetInstallerUrl,
      wingetLocaleManifestPath,
      wingetTemplatePath,
      wingetVersionManifestPath,
      written: false
    }
  }

  await mkdir(path.dirname(scoopManifestPath), { recursive: true })
  await mkdir(path.dirname(wingetVersionManifestPath), { recursive: true })
  await mkdir(path.dirname(wingetLocaleManifestPath), { recursive: true })
  await mkdir(path.dirname(wingetTemplatePath), { recursive: true })
  await writeFile(scoopManifestPath, nextScoopContent)
  await writeFile(wingetVersionManifestPath, nextWingetVersionContent)
  await writeFile(wingetLocaleManifestPath, nextWingetLocaleContent)
  await writeFile(wingetTemplatePath, nextWingetInstallerContent)

  stdout.write(`[windows-install] updated ${path.relative(cwd, scoopManifestPath)}\n`)
  stdout.write(`[windows-install] updated ${path.relative(cwd, wingetVersionManifestPath)}\n`)
  stdout.write(`[windows-install] updated ${path.relative(cwd, wingetLocaleManifestPath)}\n`)
  stdout.write(`[windows-install] updated ${path.relative(cwd, wingetTemplatePath)}\n`)
  stdout.write(`[windows-install] scoop installer ${scoopInstallerUrl}\n`)
  stdout.write(`[windows-install] scoop installer sha256 ${scoopInstallerSha256}\n`)
  stdout.write(`[windows-install] winget installer ${wingetInstallerUrl}\n`)
  stdout.write(`[windows-install] winget installer sha256 ${wingetInstallerSha256}\n`)

  return {
    scoopManifestPath,
    scoopInstallerSha256,
    scoopInstallerUrl,
    wingetInstallerSha256,
    wingetInstallerUrl,
    wingetLocaleManifestPath,
    wingetTemplatePath,
    wingetVersionManifestPath,
    written: true
  }
}
