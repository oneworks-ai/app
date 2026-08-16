/* eslint-disable max-lines -- npm authentication, immutable package bytes, and provenance are one fail-closed release contract. */
import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import {
  createPublishPlan,
  defaultOptions,
  loadWorkspacePackages,
  stagePublishAliasManifest,
  validatePublishRepositoryMetadata
} from './publish-plan-core.mjs'

export const npmRegistryRoot = 'https://registry.npmjs.org'
export const npmOidcAudience = 'npm:registry.npmjs.org'
export const npmOidcExchangeRoot = `${npmRegistryRoot}/-/npm/v1/oidc/token/exchange/package/`
export const npmRegistryPropagationAttempts = 9
export const npmRegistryPropagationDelayMs = 15_000
export const npmPublishAuthModes = new Set(['oidc', 'new-identity-bootstrap', 'missing-trust-recovery'])
export const slsaProvenancePredicateType = 'https://slsa.dev/provenance/v1'
export const inTotoStatementType = 'https://in-toto.io/Statement/v1'
const requireValue = (value, message) => {
  if (!value) throw new Error(message)
  return value
}
const packageMetadataUrl = name => `${npmRegistryRoot}/${encodeURIComponent(name)}`
const sha512Integrity = bytes => `sha512-${createHash('sha512').update(bytes).digest('base64')}`
const sha512Hex = bytes => createHash('sha512').update(bytes).digest('hex')
const sha1Hex = bytes => createHash('sha1').update(bytes).digest('hex')
const npmPurl = (name, version) => `pkg:npm/${encodeURIComponent(name).replaceAll('%2F', '/')}@${version}`
export const redactNpmPublishSecrets = (value, secrets = []) =>
  secrets.reduce((result, secret) => secret ? result.split(secret).join('[REDACTED]') : result, String(value ?? ''))

export async function fetchNpmPackageMetadata(name, fetchImpl = fetch) {
  const response = await fetchImpl(packageMetadataUrl(name), {
    headers: { accept: 'application/vnd.npm.install-v1+json', 'cache-control': 'no-cache' }
  })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`${name} registry metadata returned HTTP ${response.status}`)
  return response.json()
}
const defaultSleep = delayMs => new Promise(resolve => setTimeout(resolve, delayMs))
export async function waitForNpmRegistryVersions({
  items,
  attempts = npmRegistryPropagationAttempts,
  delayMs = npmRegistryPropagationDelayMs,
  fetchImpl = fetch,
  sleep = defaultSleep
}) {
  if (!Number.isInteger(attempts) || attempts < 1 || !Number.isFinite(delayMs) || delayMs < 0) {
    throw new Error('npm registry propagation retry policy is invalid.')
  }
  let missing = items.map(item => `${item.name}@${item.version}`)
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const metadata = await Promise.all(items.map(item => fetchNpmPackageMetadata(item.name, fetchImpl)))
    missing = items.flatMap((item, index) =>
      metadata[index]?.versions?.[item.version] == null ? [`${item.name}@${item.version}`] : []
    )
    if (!missing.length) return { attemptsUsed: attempt }
    if (attempt < attempts) await sleep(delayMs)
  }
  throw new Error(`npm registry propagation timed out for: ${missing.join(', ')}`)
}

export async function loadNpmPublishSelection(
  { repoRoot = process.cwd(), packages = '', publishAll = false, fsOps } = {}
) {
  const requestedNames = String(packages).split(',').map(name => name.trim()).filter(Boolean)
  if (!requestedNames.length && !publishAll) {
    throw new Error('packages is empty. Set publish_all=true only for an intentional full public publish plan.')
  }
  const workspacePackages = await loadWorkspacePackages(repoRoot, fsOps)
  const plan = createPublishPlan(workspacePackages, { ...defaultOptions, packages: requestedNames })
  validatePublishRepositoryMetadata(plan, workspacePackages, repoRoot)
  return { plan, requestedNames, workspacePackages }
}

export function evaluateNpmPublishMode(
  {
    mode,
    requestedNames,
    publishAll,
    publishTag,
    tokenAvailable,
    targetProvenanceRequired,
    onboardingVersion,
    selectedItems,
    registryMetadata
  }
) {
  if (!npmPublishAuthModes.has(mode)) throw new Error(`Unsupported npm publish auth mode: ${mode}`)
  const names = selectedItems.map(item => item.name)
  const absent = names.filter(name => registryMetadata.get(name) == null)
  const existing = names.filter(name => registryMetadata.get(name) != null)
  const errors = []
  if (mode === 'oidc') {
    if (tokenAvailable) errors.push('oidc mode forbids NPM_TOKEN authentication.')
    if (absent.length) errors.push(`oidc mode requires every selected identity to exist: ${absent.join(', ')}`)
  } else if (mode === 'new-identity-bootstrap') {
    if (!requestedNames.length) errors.push('new-identity-bootstrap requires explicit nonempty packages.')
    if (publishAll) errors.push('new-identity-bootstrap requires publish_all=false.')
    if (!tokenAvailable) errors.push('new-identity-bootstrap requires NPM_TOKEN.')
    if (publishTag !== 'onboarding') errors.push('new-identity-bootstrap requires publish_tag=onboarding.')
    if (!onboardingVersion || selectedItems.some(item => item.version !== onboardingVersion)) {
      errors.push('new-identity-bootstrap must publish one exact selected-manifest onboarding version.')
    }
    if (existing.length) errors.push(`new-identity-bootstrap cannot mix existing identities: ${existing.join(', ')}`)
  } else {
    if (targetProvenanceRequired) {
      errors.push('missing-trust-recovery is forbidden when target-version provenance is required.')
    }
    if (!requestedNames.length || publishAll) {
      errors.push('missing-trust-recovery requires explicit packages and publish_all=false.')
    }
    if (!tokenAvailable) errors.push('missing-trust-recovery requires NPM_TOKEN.')
    if (absent.length) errors.push(`missing-trust-recovery requires existing identities: ${absent.join(', ')}`)
  }
  return errors
}

export async function requestGitHubActionsIdToken({ requestToken, requestUrl, fetchImpl = fetch } = {}) {
  const url = new URL(requireValue(requestUrl, 'GitHub Actions ID-token request URL is unavailable.'))
  url.searchParams.set('audience', npmOidcAudience)
  const response = await fetchImpl(url, {
    headers: {
      authorization: `Bearer ${requireValue(requestToken, 'GitHub Actions ID-token request token is unavailable.')}`
    }
  })
  if (!response.ok) throw new Error(`GitHub Actions ID-token request returned HTTP ${response.status}`)
  return requireValue((await response.json())?.value, 'GitHub Actions ID-token response did not contain a token.')
}
export async function exchangeNpmOidcToken({ name, idToken, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(
    `${npmOidcExchangeRoot}${
      encodeURIComponent(requireValue(name, 'npm package name is required for OIDC exchange.'))
    }`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${requireValue(idToken, 'GitHub Actions ID token is required for npm OIDC exchange.')}`
      }
    }
  )
  if (response.status !== 201) throw new Error(`${name} npm OIDC exchange returned HTTP ${response.status}`)
  requireValue((await response.json())?.token, `${name} npm OIDC exchange returned an empty package token.`)
}
export async function proveOidcExchangesBeforePublish({ selectedItems, requestToken, requestUrl, fetchImpl = fetch }) {
  const idToken = await requestGitHubActionsIdToken({ requestToken, requestUrl, fetchImpl })
  for (const item of selectedItems) await exchangeNpmOidcToken({ name: item.name, idToken, fetchImpl })
  return { exchangedIdentityCount: selectedItems.length }
}

const defaultPackPackage = async ({ item, outputDir }) => {
  const restore = stagePublishAliasManifest(item)
  try {
    const result = spawnSync('pnpm', ['pack', '--json', '--pack-destination', outputDir], {
      cwd: item.dir,
      encoding: 'utf8',
      stdio: 'pipe'
    })
    if (result.status !== 0) throw new Error(`${item.name} local pack failed.`)
    const output = JSON.parse(String(result.stdout))
    const filename = Array.isArray(output) ? output[0]?.filename : output?.filename
    if (!filename) throw new Error(`${item.name} local pack did not return a filename.`)
    const filePath = path.isAbsolute(filename) ? filename : path.join(outputDir, filename)
    return { bytes: await readFile(filePath), filePath }
  } finally {
    restore?.()
  }
}
const defaultRunCommand = (command, args, options) =>
  spawnSync(command, args, {
    encoding: 'utf8',
    ...options
  })
export function preparePublishWorkspaceDependencies({
  items,
  repoRoot = process.cwd(),
  runCommand = defaultRunCommand
}) {
  const sourceNames = Array.from(new Set(items.map(item => item.publishAliasFor ?? item.name)))
  if (!sourceNames.length) throw new Error('npm publish dependency preparation requires at least one package.')
  const args = sourceNames.flatMap(name => ['--filter', `${name}^...`])
  args.push('--workspace-concurrency=1', '--if-present', 'run', 'build')
  const result = runCommand('pnpm', args, { cwd: repoRoot, stdio: 'pipe' })
  if (result.status !== 0) {
    throw new Error('npm publish workspace dependency build failed before local packing.')
  }
  return { sourceNames }
}
export async function freezeApprovedTarballs({ items, outputDir, packPackage = defaultPackPackage }) {
  const ownedOutput = outputDir == null
  const packDirectory = outputDir ?? await mkdtemp(path.join(tmpdir(), 'oneworks-npm-pack-'))
  await mkdir(packDirectory, { recursive: true })
  try {
    const entries = []
    for (const item of items) {
      const packed = await packPackage({ item, outputDir: packDirectory })
      const bytes = Buffer.isBuffer(packed) ? packed : packed.bytes
      const filePath = Buffer.isBuffer(packed) ? undefined : packed.filePath
      entries.push([item.name, {
        version: item.version,
        filePath,
        integrity: sha512Integrity(bytes),
        sha512: sha512Hex(bytes),
        shasum: sha1Hex(bytes)
      }])
    }
    return new Map(entries)
  } finally {
    if (ownedOutput) await rm(packDirectory, { recursive: true, force: true })
  }
}
export async function assertTargetsStillUnpublished({ items, preflightMetadata, fetchImpl = fetch }) {
  for (const item of items) {
    if (preflightMetadata.get(item.name)?.versions?.[item.version] != null) {
      throw new Error(`${item.name}@${item.version} already existed in the initial preflight snapshot.`)
    }
    if ((await fetchNpmPackageMetadata(item.name, fetchImpl))?.versions?.[item.version] != null) {
      throw new Error(`${item.name}@${item.version} appeared after preflight; refusing --skip-existing.`)
    }
  }
}

export async function executeFrozenPublish({
  items,
  approvedTarballs,
  publishTag,
  preflightMetadata,
  dryRun = false,
  fetchImpl = fetch,
  runCommand = defaultRunCommand,
  stdout = process.stdout,
  stderr = process.stderr,
  secrets = []
}) {
  const attempts = []
  await assertTargetsStillUnpublished({
    items,
    preflightMetadata,
    fetchImpl
  })
  for (const item of items) {
    await assertTargetsStillUnpublished({
      items: [item],
      preflightMetadata,
      fetchImpl
    })
    const approved = approvedTarballs.get(item.name)
    if (!approved?.filePath || approved.version !== item.version) {
      throw new Error(`${item.name} is missing its exact-version frozen tarball file.`)
    }
    const bytes = await readFile(approved.filePath)
    if (sha512Integrity(bytes) !== approved.integrity || sha1Hex(bytes) !== approved.shasum) {
      throw new Error(`${item.name} frozen tarball bytes changed before publish.`)
    }
    const args = [
      'publish',
      approved.filePath,
      '--access',
      'public',
      '--tag',
      publishTag,
      '--no-git-checks'
    ]
    if (dryRun) args.push('--dry-run')
    const result = runCommand('pnpm', args, { stdio: 'pipe' })
    const output = redactNpmPublishSecrets(result.stdout ?? '', secrets)
    const errorOutput = redactNpmPublishSecrets(result.stderr ?? '', secrets)
    if (output) stdout.write(output)
    if (errorOutput) stderr.write(errorOutput)
    const status = result.status ?? 1
    attempts.push({ name: item.name, status })
    if (status !== 0) throw new Error(`${item.name} frozen tarball publish failed with status ${status}.`)
  }
  return { attempts }
}

const parseDsseStatement = record => {
  const payload = record?.bundle?.dsseEnvelope?.payload
  if (typeof payload !== 'string' || !/^[a-z0-9+/]+={0,2}$/i.test(payload) || payload.length % 4 !== 0) {
    throw new Error('SLSA provenance DSSE payload is malformed.')
  }
  try {
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'))
  } catch {
    throw new Error('SLSA provenance DSSE payload is not JSON.')
  }
}
export function verifySlsaProvenance(
  {
    attestationDocument,
    name,
    version,
    sha512,
    githubRepository,
    githubWorkflowPath,
    githubRef,
    githubSha,
    githubRunId,
    githubRunAttempt
  }
) {
  for (
    const [key, value] of Object.entries({
      name,
      version,
      sha512,
      githubRepository,
      githubWorkflowPath,
      githubRef,
      githubSha,
      githubRunId,
      githubRunAttempt
    })
  ) requireValue(value, `Missing required provenance expectation: ${key}.`)
  const records = attestationDocument?.attestations
  if (!Array.isArray(records)) throw new Error('npm attestation response does not contain attestations.')
  const matches = records.filter(record => record?.predicateType === slsaProvenancePredicateType)
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one SLSA provenance attestation; received ${matches.length}.`)
  }
  const statement = parseDsseStatement(matches[0])
  if (statement?._type !== inTotoStatementType || statement?.predicateType !== slsaProvenancePredicateType) {
    throw new Error('SLSA provenance statement type is invalid.')
  }
  if (
    !Array.isArray(statement.subject) || statement.subject.length !== 1 ||
    statement.subject[0]?.name !== npmPurl(name, version) || statement.subject[0]?.digest?.sha512 !== sha512
  ) throw new Error('SLSA provenance subject does not match the approved package bytes.')
  const workflow = statement?.predicate?.buildDefinition?.externalParameters?.workflow
  if (
    workflow?.repository !== `https://github.com/${githubRepository}` || workflow?.path !== githubWorkflowPath ||
    workflow?.ref !== githubRef
  ) throw new Error('SLSA provenance workflow binding does not match exactly.')
  const sources =
    statement?.predicate?.buildDefinition?.resolvedDependencies?.filter(dep =>
      dep?.uri === `git+https://github.com/${githubRepository}@${githubRef}`
    ) ?? []
  if (sources.length !== 1 || sources[0]?.digest?.gitCommit !== githubSha) {
    throw new Error('SLSA provenance source gitCommit does not match exactly.')
  }
  if (
    statement?.predicate?.runDetails?.metadata?.invocationId !==
      `https://github.com/${githubRepository}/actions/runs/${githubRunId}/attempts/${githubRunAttempt}`
  ) throw new Error('SLSA provenance invocationId does not match exactly.')
  return statement
}
export async function verifyNpmPublishPostflight(
  {
    mode,
    items,
    publishTag,
    latestBefore,
    approvedTarballs,
    githubRepository,
    githubWorkflowPath,
    githubRef,
    githubSha,
    githubRunId,
    githubRunAttempt,
    fetchImpl = fetch
  }
) {
  const failures = []
  let completeCount = 0
  for (const item of items) {
    try {
      const metadata = await fetchNpmPackageMetadata(item.name, fetchImpl)
      const record = metadata?.versions?.[item.version]
      if (!record) throw new Error(`${item.name}@${item.version} is missing`)
      if (metadata?.['dist-tags']?.[publishTag] !== item.version) {
        throw new Error(`${item.name} ${publishTag} does not point to ${item.version}`)
      }
      const before = latestBefore.get(item.name)
      const after = metadata?.['dist-tags']?.latest ?? null
      if (mode === 'new-identity-bootstrap') {
        if (before !== null || after !== item.version) {
          throw new Error(`${item.name} bootstrap latest must transition exactly null -> ${item.version}`)
        }
      } else if (publishTag !== 'latest' && before !== after) {
        throw new Error(`${item.name} non-latest publication changed latest.`)
      }
      const approved = approvedTarballs.get(item.name)
      if (!approved || approved.version !== item.version) {
        throw new Error(`${item.name} is missing approved local tarball bytes.`)
      }
      if (
        record?.dist?.integrity !== approved.integrity || record?.dist?.shasum !== approved.shasum ||
        !record?.dist?.tarball
      ) throw new Error(`${item.name} registry dist metadata differs from approved local bytes.`)
      const response = await fetchImpl(record.dist.tarball, { headers: { 'cache-control': 'no-cache' } })
      if (!response.ok) throw new Error(`${item.name} tarball returned HTTP ${response.status}`)
      const bytes = Buffer.from(await response.arrayBuffer())
      if (
        sha512Integrity(bytes) !== approved.integrity || sha512Hex(bytes) !== approved.sha512 ||
        sha1Hex(bytes) !== approved.shasum
      ) throw new Error(`${item.name} registry tarball differs from approved local bytes.`)
      if (mode === 'oidc') {
        const url = record?.dist?.attestations?.url
        if (!url) throw new Error(`${item.name}@${item.version} is missing SLSA provenance`)
        const provenance = await fetchImpl(url, {
          headers: { accept: 'application/json', 'cache-control': 'no-cache' }
        })
        if (!provenance.ok) throw new Error(`${item.name} provenance returned HTTP ${provenance.status}`)
        verifySlsaProvenance({
          attestationDocument: await provenance.json(),
          name: item.name,
          version: item.version,
          sha512: approved.sha512,
          githubRepository,
          githubWorkflowPath,
          githubRef,
          githubSha,
          githubRunId,
          githubRunAttempt
        })
      }
      completeCount += 1
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error))
    }
  }
  return {
    complete: failures.length === 0 && completeCount === items.length,
    identityCount: items.length,
    completeCount,
    failures,
    provenanceVerified: mode === 'oidc'
  }
}
export async function runNpmPublishPreflight(
  {
    mode,
    packages,
    publishAll,
    publishTag,
    tokenAvailable,
    targetProvenanceRequired = true,
    repoRoot = process.cwd(),
    requestToken,
    requestUrl,
    fetchImpl = fetch,
    fsOps,
    prepareWorkspaceDependencies = preparePublishWorkspaceDependencies,
    packPackage,
    tarballDirectory
  } = {}
) {
  const selection = await loadNpmPublishSelection({ repoRoot, packages, publishAll, fsOps })
  const registryMetadata = new Map(
    await Promise.all(
      selection.plan.items.map(async item => [item.name, await fetchNpmPackageMetadata(item.name, fetchImpl)])
    )
  )
  const versions = new Set(selection.plan.items.map(item => item.version))
  const errors = evaluateNpmPublishMode({
    mode,
    requestedNames: selection.requestedNames,
    publishAll,
    publishTag,
    tokenAvailable,
    targetProvenanceRequired,
    onboardingVersion: versions.size === 1 ? selection.plan.items[0]?.version : '',
    selectedItems: selection.plan.items,
    registryMetadata
  })
  if (errors.length) throw new Error(`npm publish guard rejected dispatch: ${errors.join('; ')}`)
  await prepareWorkspaceDependencies({ items: selection.plan.items, repoRoot })
  const approvedTarballs = await freezeApprovedTarballs({
    items: selection.plan.items,
    outputDir: tarballDirectory,
    packPackage
  })
  const oidc = mode === 'oidc'
    ? await proveOidcExchangesBeforePublish({
      selectedItems: selection.plan.items,
      requestToken,
      requestUrl,
      fetchImpl
    })
    : null
  return {
    ...selection,
    approvedTarballs,
    preflightMetadata: registryMetadata,
    latestBefore: new Map(
      selection.plan.items.map(item => [item.name, registryMetadata.get(item.name)?.['dist-tags']?.latest ?? null])
    ),
    oidc
  }
}
const cliInput = () => ({
  mode: process.env.PUBLISH_AUTH_MODE ?? 'oidc',
  packages: process.env.PACKAGES ?? '',
  publishAll: process.env.PUBLISH_ALL === 'true',
  publishTag: process.env.PUBLISH_TAG ?? 'alpha',
  targetProvenanceRequired: process.env.TARGET_PROVENANCE_REQUIRED !== 'false',
  dryRun: process.env.DRY_RUN === 'true',
  tokenAvailable: Boolean(process.env.NODE_AUTH_TOKEN)
})
const runCli = async command => {
  const input = cliInput()
  const snapshotPath = requireValue(process.env.NPM_PUBLISH_GUARD_SNAPSHOT, 'NPM_PUBLISH_GUARD_SNAPSHOT is required.')
  if (command === 'preflight') {
    const result = await runNpmPublishPreflight({
      ...input,
      requestToken: process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
      requestUrl: process.env.ACTIONS_ID_TOKEN_REQUEST_URL,
      tarballDirectory: requireValue(
        process.env.NPM_PUBLISH_TARBALL_DIRECTORY,
        'NPM_PUBLISH_TARBALL_DIRECTORY is required.'
      )
    })
    await writeFile(
      snapshotPath,
      JSON.stringify({
        latestBefore: Object.fromEntries(result.latestBefore),
        preflightMetadata: Object.fromEntries(result.preflightMetadata),
        approvedTarballs: Object.fromEntries(result.approvedTarballs)
      }),
      { encoding: 'utf8', mode: 0o600 }
    )
    process.stdout.write(
      `${
        JSON.stringify({
          ok: true,
          mode: input.mode,
          identityCount: result.plan.items.length,
          oidcExchangeCount: result.oidc?.exchangedIdentityCount ?? 0
        })
      }\n`
    )
    return
  }
  const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'))
  const selection = await loadNpmPublishSelection({ packages: input.packages, publishAll: input.publishAll })
  if (command === 'prepublish') {
    await assertTargetsStillUnpublished({
      items: selection.plan.items,
      preflightMetadata: new Map(Object.entries(snapshot.preflightMetadata))
    })
    process.stdout.write(`${JSON.stringify({ ok: true, identityCount: selection.plan.items.length })}\n`)
    return
  }
  if (command === 'publish') {
    const result = await executeFrozenPublish({
      items: selection.plan.items,
      approvedTarballs: new Map(Object.entries(snapshot.approvedTarballs)),
      publishTag: input.publishTag,
      dryRun: input.dryRun,
      preflightMetadata: new Map(Object.entries(snapshot.preflightMetadata)),
      secrets: [process.env.NODE_AUTH_TOKEN]
    })
    process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`)
    return
  }
  if (command === 'postflight') {
    await waitForNpmRegistryVersions({ items: selection.plan.items })
    const result = await verifyNpmPublishPostflight({
      mode: input.mode,
      items: selection.plan.items,
      publishTag: input.publishTag,
      latestBefore: new Map(Object.entries(snapshot.latestBefore)),
      approvedTarballs: new Map(Object.entries(snapshot.approvedTarballs)),
      githubRepository: process.env.GITHUB_REPOSITORY,
      githubWorkflowPath: '.github/workflows/npm-publish-alpha.yml',
      githubRef: process.env.GITHUB_REF,
      githubSha: process.env.GITHUB_SHA,
      githubRunId: process.env.GITHUB_RUN_ID,
      githubRunAttempt: process.env.GITHUB_RUN_ATTEMPT
    })
    process.stdout.write(`${JSON.stringify({ mode: input.mode, ...result })}\n`)
    if (!result.complete) process.exitCode = 1
    return
  }
  throw new Error(`Unknown npm publish guard command: ${command ?? ''}`)
}
if (process.argv[1] != null && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await runCli(process.argv[2])
  } catch (error) {
    process.stderr.write(
      `${
        redactNpmPublishSecrets(error instanceof Error ? error.message : error, [
          process.env.NODE_AUTH_TOKEN,
          process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
        ])
      }\n`
    )
    process.exitCode = 1
  }
}
