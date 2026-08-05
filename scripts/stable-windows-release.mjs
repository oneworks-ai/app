/* eslint-disable max-lines -- stable Windows release coordinates portable and MSI immutable release assets. */
import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
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

export const resolvePnpmInvocation = (
  platform = process.platform,
  comSpec = process.env.ComSpec ?? 'cmd.exe'
) => (platform === 'win32'
  ? { command: comSpec, prefixArgs: ['/d', '/s', '/c', 'pnpm.cmd'] }
  : { command: 'pnpm', prefixArgs: [] })

const runPnpm = (args, options = {}) => {
  const { command, prefixArgs } = resolvePnpmInvocation()
  return run(command, [...prefixArgs, ...args], options)
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

export const STABLE_WINDOWS_MSI_UPGRADE_CODE = '{79C27ECA-08D1-48C7-8094-E38CF4D62F43}'

const MSI_VERSION_LIMITS = [255, 255, 65535]
const PRODUCT_CODE_NAMESPACE = Buffer.from('6ba7b8119dad11d180b400c04fd430c8', 'hex')

export const assertStableWindowsMsiVersion = version => {
  const stableVersion = assertStableVersion(version)
  const segments = stableVersion.split('.').map(Number)
  if (segments.some((segment, index) => segment > MSI_VERSION_LIMITS[index])) {
    throw new Error(`Windows MSI version is outside Windows Installer limits: ${version}`)
  }
  return stableVersion
}

const formatGuid = bytes => {
  const hex = bytes.toString('hex').toUpperCase()
  return `{${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}}`
}

export const buildStableWindowsMsiProductCode = version => {
  const stableVersion = assertStableWindowsMsiVersion(version)
  const digest = createHash('sha1')
    .update(PRODUCT_CODE_NAMESPACE)
    .update(`OneWorks.OneWorks:${stableVersion}`)
    .digest()
    .subarray(0, 16)
  digest[6] = (digest[6] & 0x0F) | 0x50
  digest[8] = (digest[8] & 0x3F) | 0x80
  return formatGuid(digest)
}

export const buildStableWindowsMsiAssetNames = version => {
  const stableVersion = assertStableWindowsMsiVersion(version)
  return {
    checksumName: `oneworks-windows-${stableVersion}.msi.sha256`,
    installerName: `oneworks-windows-${stableVersion}.msi`,
    provenanceName: `oneworks-windows-${stableVersion}.msi.provenance.json`,
    releaseTag: `pkg/oneworks/v${stableVersion}`
  }
}

const escapeXmlAttribute = value =>
  value.replace(/[&"<>]/gu, char => ({
    '&': '&amp;',
    '"': '&quot;',
    '<': '&lt;',
    '>': '&gt;'
  }[char]))

export const buildStableWindowsMsiWxs = input => {
  const version = assertStableWindowsMsiVersion(input.version)
  const productCode = buildStableWindowsMsiProductCode(version)
  const payloadDir = escapeXmlAttribute(input.payloadDir.replaceAll('\\', '/'))
  return `<?xml version="1.0" encoding="UTF-8"?>
<Wix xmlns="http://wixtoolset.org/schemas/v4/wxs">
  <Package
    Name="One Works"
    Manufacturer="OneWorks AI"
    Version="${version}"
    ProductCode="${productCode}"
    UpgradeCode="${STABLE_WINDOWS_MSI_UPGRADE_CODE}"
    Scope="perMachine"
    InstallerVersion="500">
    <MajorUpgrade DowngradeErrorMessage="A newer version of One Works is already installed." />
    <MediaTemplate EmbedCab="yes" />
    <StandardDirectory Id="ProgramFiles64Folder">
      <Directory Id="INSTALLFOLDER" Name="OneWorks">
        <Component Id="OneWorksCli" Guid="{11EBCB55-8C41-4A92-9D2C-FE6E6A4C4B60}">
          <File Id="OneWorksCmd" Source="${payloadDir}/oneworks.cmd" />
          <File Id="OwCmd" Source="${payloadDir}/ow.cmd" />
          <File Id="OwoCmd" Source="${payloadDir}/owo.cmd" />
          <File Id="Readme" Source="${payloadDir}/README.txt" />
          <Environment
            Id="OneWorksPath"
            Name="PATH"
            Action="set"
            Part="last"
            System="yes"
            Value="[INSTALLFOLDER]" />
          <RegistryValue
            Root="HKLM"
            Key="Software\\OneWorks"
            Name="ProductSourceSha"
            Type="string"
            Value="${input.productSourceSha}"
            KeyPath="yes" />
        </Component>
      </Directory>
    </StandardDirectory>
    <Feature Id="Complete" Title="One Works CLI" Level="1">
      <ComponentRef Id="OneWorksCli" />
    </Feature>
  </Package>
</Wix>
`
}

const sha256 = filePath => createHash('sha256').update(readFileSync(filePath)).digest('hex')

export const buildStableWindowsMsiProvenance = input => ({
  schemaVersion: 1,
  releaseTag: input.releaseTag,
  version: assertStableWindowsMsiVersion(input.version),
  productSourceSha: input.productSourceSha,
  builderWorkflowSha: input.builderWorkflowSha,
  productCode: buildStableWindowsMsiProductCode(input.version),
  installer: {
    name: input.installerName,
    sha256: input.installerSha256
  },
  launchers: input.launchers
})

export const assertStableWindowsMsiReleaseIntegrity = input => {
  const names = buildStableWindowsMsiAssetNames(input.version)
  const checksum = input.checksum.trim()
  const checksumMatch = checksum.match(/^([a-f0-9]{64}) {2}(.+)$/u)
  if (checksumMatch == null || checksumMatch[2] !== names.installerName) {
    throw new Error(`MSI checksum must contain only ${names.installerName}.`)
  }
  if (checksumMatch[1] !== input.installerSha256) {
    throw new Error('MSI checksum does not match the release installer.')
  }
  if (
    input.provenance?.installer?.name !== names.installerName ||
    input.provenance?.installer?.sha256 !== input.installerSha256
  ) {
    throw new Error('MSI provenance does not match the release installer.')
  }
}

const writeOutput = (name, value) => {
  if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required.')
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`)
}

const assertCommitSha = (name, value) => {
  if (!/^[a-f0-9]{40}$/u.test(value)) throw new Error(`${name} must be a full lowercase Git commit SHA.`)
  return value
}

const assertLauncherPayload = (payloadDir, version) => {
  for (const command of ['oneworks', 'ow', 'owo']) {
    const launcherPath = path.join(payloadDir, `${command}.cmd`)
    if (!existsSync(launcherPath)) throw new Error(`Missing Windows launcher payload: ${launcherPath}`)
    const expected = `--package "oneworks@${version}" ${command} %*`
    if (!readFileSync(launcherPath, 'utf8').includes(expected)) {
      throw new Error(`Windows launcher is not pinned to oneworks@${version}: ${launcherPath}`)
    }
  }
  if (!existsSync(path.join(payloadDir, 'README.txt'))) {
    throw new Error(`Missing Windows launcher README: ${payloadDir}`)
  }
}

const readReleaseAssets = releaseTag => {
  const release = run('gh', ['release', 'view', releaseTag, '--json', 'assets'])
  return JSON.parse(release).assets.map(asset => asset.name)
}

const assertByteIdenticalReleaseAssets = (releaseTag, assets) => {
  const releaseAssets = readReleaseAssets(releaseTag)
  for (const asset of assets) {
    const name = path.basename(asset)
    if (!releaseAssets.includes(name)) {
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

const buildMsi = () => {
  const version = assertStableWindowsMsiVersion(process.env.VERSION ?? '')
  const productSourceSha = assertCommitSha('PRODUCT_SOURCE_SHA', process.env.PRODUCT_SOURCE_SHA ?? '')
  const builderWorkflowSha = assertCommitSha(
    'BUILDER_WORKFLOW_SHA',
    process.env.BUILDER_WORKFLOW_SHA ?? ''
  )
  const names = buildStableWindowsMsiAssetNames(version)
  const releaseTag = process.env.RELEASE_TAG ?? names.releaseTag
  if (releaseTag !== names.releaseTag) throw new Error(`Unexpected MSI release tag: ${releaseTag}`)

  const outputRoot = process.env.RUNNER_TEMP ?? tmpdir()
  const payloadDir = path.join(outputRoot, `oneworks-windows-${version}-msi-payload`)
  const buildDir = path.join(outputRoot, `oneworks-windows-${version}-msi-build`)
  const installer = path.join(outputRoot, names.installerName)
  const checksum = path.join(outputRoot, names.checksumName)
  const provenance = path.join(outputRoot, names.provenanceName)
  mkdirSync(buildDir, { recursive: true })
  runPnpm([
    'tools',
    'windows-install',
    'package-oneworks',
    '--version',
    version,
    '--out-dir',
    payloadDir
  ], { stdio: 'inherit' })
  assertLauncherPayload(payloadDir, version)

  const wxsPath = path.join(buildDir, 'oneworks.wxs')
  writeFileSync(wxsPath, buildStableWindowsMsiWxs({ productSourceSha, payloadDir, version }))
  run(process.env.WIX_EXE ?? 'wix', ['build', '-arch', 'x64', '-out', installer, wxsPath], { stdio: 'inherit' })
  const installerSha256 = sha256(installer)
  writeFileSync(checksum, `${installerSha256}  ${names.installerName}\n`)
  const launchers = Object.fromEntries(
    ['oneworks', 'ow', 'owo'].map(command => [`${command}.cmd`, sha256(path.join(payloadDir, `${command}.cmd`))])
  )
  writeFileSync(
    provenance,
    `${
      JSON.stringify(
        buildStableWindowsMsiProvenance({
          builderWorkflowSha,
          installerName: names.installerName,
          installerSha256,
          launchers,
          productSourceSha,
          releaseTag,
          version
        }),
        null,
        2
      )
    }\n`
  )

  writeOutput('checksum', checksum)
  writeOutput('installer', installer)
  writeOutput('product_code', buildStableWindowsMsiProductCode(version))
  writeOutput('provenance', provenance)
  writeOutput('release_tag', releaseTag)
  writeOutput('version', version)
}

const prepareMsi = () => {
  const version = assertStableWindowsMsiVersion(process.env.VERSION ?? '')
  const productSourceSha = assertCommitSha('PRODUCT_SOURCE_SHA', process.env.PRODUCT_SOURCE_SHA ?? '')
  const builderWorkflowSha = assertCommitSha(
    'BUILDER_WORKFLOW_SHA',
    process.env.BUILDER_WORKFLOW_SHA ?? ''
  )
  const names = buildStableWindowsMsiAssetNames(version)
  const releaseTag = process.env.RELEASE_TAG ?? names.releaseTag
  if (releaseTag !== names.releaseTag) throw new Error(`Unexpected MSI release tag: ${releaseTag}`)
  const releaseAssets = readReleaseAssets(releaseTag)
  const expectedAssets = [names.installerName, names.checksumName, names.provenanceName]
  const foundAssets = expectedAssets.filter(name => releaseAssets.includes(name))
  if (foundAssets.length === 0) {
    writeOutput('should_build', 'true')
    return
  }
  if (foundAssets.length !== expectedAssets.length) {
    throw new Error(`MSI release assets are incomplete: found ${foundAssets.join(', ')}`)
  }

  const existingDir = mkdtempSync(path.join(tmpdir(), `oneworks-msi-${version}-`))
  for (const assetName of expectedAssets) {
    run('gh', ['release', 'download', releaseTag, '--pattern', assetName, '--dir', existingDir])
  }
  const provenance = JSON.parse(readFileSync(path.join(existingDir, names.provenanceName), 'utf8'))
  assertStableWindowsMsiReleaseIntegrity({
    checksum: readFileSync(path.join(existingDir, names.checksumName), 'utf8'),
    installerSha256: sha256(path.join(existingDir, names.installerName)),
    provenance,
    version
  })
  const expected = buildStableWindowsMsiProvenance({
    builderWorkflowSha,
    installerName: names.installerName,
    installerSha256: provenance?.installer?.sha256,
    launchers: provenance?.launchers,
    productSourceSha,
    releaseTag,
    version
  })
  for (const key of ['releaseTag', 'version', 'productSourceSha', 'builderWorkflowSha', 'productCode']) {
    if (provenance[key] !== expected[key]) throw new Error(`Existing MSI provenance differs for ${key}.`)
  }
  if (!/^[a-f0-9]{64}$/u.test(provenance?.installer?.sha256 ?? '')) {
    throw new Error('Existing MSI provenance is missing installer SHA-256.')
  }
  writeOutput('should_build', 'false')
}

const publishMsi = () => {
  const version = assertStableWindowsMsiVersion(process.env.VERSION ?? '')
  const names = buildStableWindowsMsiAssetNames(version)
  const releaseTag = process.env.RELEASE_TAG ?? names.releaseTag
  const installer = process.env.INSTALLER
  const checksum = process.env.CHECKSUM
  const provenance = process.env.PROVENANCE
  if (!installer || !checksum || !provenance) throw new Error('MSI asset paths are required.')
  assertByteIdenticalReleaseAssets(releaseTag, [installer, checksum, provenance])
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
  runPnpm([
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

  const releaseView = spawnSync('gh', ['release', 'view', releaseTag, '--json', 'assets'], { encoding: 'utf8' })
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

  assertByteIdenticalReleaseAssets(releaseTag, [archive, checksum])
}

if (process.argv[1] != null && fileURLToPath(import.meta.url) === process.argv[1]) {
  const command = process.argv[2]
  if (command === 'build') build()
  else if (command === 'publish') publish()
  else if (command === 'build-msi') buildMsi()
  else if (command === 'prepare-msi') prepareMsi()
  else if (command === 'publish-msi') publishMsi()
  else throw new Error(`Unknown stable Windows release command: ${command ?? ''}`)
}
