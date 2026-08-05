/* eslint-disable max-lines -- stable selection and registry attestation form one fail-closed contract. */
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { createPublishPlan, defaultOptions, loadWorkspacePackages } from './publish-plan-core.mjs'

const REGISTRY_ROOT = 'https://registry.npmjs.org'
const sameNames = (left, right) => (
  JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort())
)
const parsePackageNames = value => [
  ...new Set(
    value.split(',').map(name => name.trim()).filter(Boolean)
  )
]
const sleep = delayMs => new Promise(resolve => setTimeout(resolve, delayMs))

export const evaluateStableNpmSelection = input => {
  const errors = []
  if (input.bootstrapWithToken) {
    if (input.publishAll) errors.push('Stable recovery must set publish_all=false.')
    if (input.requestedNames.length === 0) {
      errors.push('Stable recovery requires the reconciled missing package names.')
    }
    if (input.publishedNames.length === 0) {
      errors.push('Stable token recovery requires a mixed-result publish with existing target versions.')
    }
    if (input.missingNames.length === 0) {
      errors.push('Stable token recovery found no missing target versions.')
    }
    if (!sameNames(input.selectedNames, input.expectedRecoveryNames)) {
      errors.push('Stable recovery selection must resolve to exactly the missing identity closure.')
    }
  } else {
    if (!input.publishAll) errors.push('Initial stable publication requires publish_all=true.')
    if (input.requestedNames.length > 0) {
      errors.push('Initial stable publication requires an empty packages input.')
    }
    if (!sameNames(input.selectedNames, input.allNames)) {
      errors.push('Initial stable publication must contain the complete public identity plan.')
    }
  }

  if (!input.dryRun && input.githubRef !== input.expectedRef) {
    errors.push(`Stable publication must run from ${input.expectedRef}; received ${input.githubRef || 'none'}.`)
  }
  return errors
}

const mapInBatches = async (values, batchSize, callback) => {
  const results = []
  for (let index = 0; index < values.length; index += batchSize) {
    results.push(...await Promise.all(values.slice(index, index + batchSize).map(callback)))
  }
  return results
}

const fetchPackageMetadata = async (name, fetchImpl) => {
  const response = await fetchImpl(`${REGISTRY_ROOT}/${encodeURIComponent(name)}`, {
    headers: {
      accept: 'application/vnd.npm.install-v1+json',
      'cache-control': 'no-cache'
    }
  })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`${name} metadata returned HTTP ${response.status}`)
  return response.json()
}

const readPublishedNames = async (items, fetchImpl = fetch) => {
  const results = await mapInBatches(items, 8, async item => ({
    name: item.name,
    published: (await fetchPackageMetadata(item.name, fetchImpl))?.versions?.[item.version] != null
  }))
  return results.filter(result => result.published).map(result => result.name)
}

export const evaluateRegistryMetadata = (items, metadataByName) => {
  const mismatches = []
  const records = []
  for (const item of items) {
    const metadata = metadataByName.get(item.name)
    const versionRecord = metadata?.versions?.[item.version]
    if (versionRecord == null) {
      mismatches.push(`${item.name}@${item.version} is missing`)
      continue
    }
    if (metadata?.['dist-tags']?.latest !== item.version) {
      mismatches.push(`${item.name} latest does not point to ${item.version}`)
    }
    const dist = versionRecord.dist
    if (
      typeof dist?.integrity !== 'string' ||
      typeof dist?.shasum !== 'string' ||
      typeof dist?.tarball !== 'string'
    ) {
      mismatches.push(`${item.name}@${item.version} has incomplete distribution metadata`)
      continue
    }
    records.push({ name: item.name, version: item.version, dist })
  }
  return { mismatches, records }
}

export const verifyTarballBytes = (bytes, dist) => {
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`
  const shasum = createHash('sha1').update(bytes).digest('hex')
  return {
    integrity,
    integrityMatches: integrity === dist.integrity,
    shasum,
    shasumMatches: shasum === dist.shasum
  }
}

const loadPublicPlan = async () => {
  const packages = await loadWorkspacePackages(process.cwd())
  const plan = createPublishPlan(packages, { ...defaultOptions, packages: [] })
  return { packages, items: plan.items }
}

const validateSelection = async () => {
  const { packages, items } = await loadPublicPlan()
  const requestedNames = parsePackageNames(process.env.PACKAGES ?? '')
  const selectedItems = createPublishPlan(packages, {
    ...defaultOptions,
    packages: requestedNames
  }).items
  const bootstrapWithToken = process.env.BOOTSTRAP_WITH_TOKEN === 'true'
  const publishedNames = bootstrapWithToken ? await readPublishedNames(items) : []
  const publishedSet = new Set(publishedNames)
  const missingNames = items.filter(item => !publishedSet.has(item.name)).map(item => item.name)
  const expectedRecoveryNames = missingNames.length === 0
    ? []
    : createPublishPlan(packages, { ...defaultOptions, packages: missingNames }).items.map(item => item.name)
  const version = JSON.parse(await readFile('apps/bootstrap/package.json', 'utf8')).version
  const expectedRef = `refs/tags/pkg/oneworks/v${version}`
  const errors = evaluateStableNpmSelection({
    allNames: items.map(item => item.name),
    bootstrapWithToken,
    dryRun: process.env.DRY_RUN === 'true',
    expectedRecoveryNames,
    expectedRef,
    githubRef: process.env.GITHUB_REF ?? '',
    missingNames,
    publishAll: process.env.PUBLISH_ALL === 'true',
    publishedNames,
    requestedNames,
    selectedNames: selectedItems.map(item => item.name)
  })
  const result = {
    ok: errors.length === 0,
    identityCount: items.length,
    selectedCount: selectedItems.length,
    publishedCount: publishedNames.length,
    missingCount: missingNames.length,
    expectedRef,
    errors
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (errors.length > 0) process.exitCode = 1
}

const verifyRegistry = async (fetchImpl = fetch) => {
  const { items } = await loadPublicPlan()
  let evaluation
  const retryDelays = [0, 2_000, 5_000, 10_000, 20_000, 30_000]
  for (const retryDelay of retryDelays) {
    if (retryDelay > 0) await sleep(retryDelay)
    const metadataResults = await mapInBatches(items, 8, async item => {
      try {
        return { name: item.name, metadata: await fetchPackageMetadata(item.name, fetchImpl) }
      } catch (error) {
        return {
          name: item.name,
          metadata: null,
          error: error instanceof Error ? error.message : String(error)
        }
      }
    })
    evaluation = evaluateRegistryMetadata(
      items,
      new Map(metadataResults.map(result => [result.name, result.metadata]))
    )
    evaluation.mismatches.unshift(...metadataResults.flatMap(result => result.error ?? []))
    if (evaluation.mismatches.length === 0) break
  }
  if (evaluation == null || evaluation.mismatches.length > 0) {
    throw new Error(`Stable registry reconciliation failed: ${evaluation?.mismatches.join('; ') ?? 'unknown'}`)
  }

  let verifiedBytes = 0
  const tarballResults = await mapInBatches(evaluation.records, 6, async record => {
    const response = await fetchImpl(record.dist.tarball, { headers: { 'cache-control': 'no-cache' } })
    if (!response.ok) throw new Error(`${record.name} tarball returned HTTP ${response.status}`)
    const bytes = Buffer.from(await response.arrayBuffer())
    verifiedBytes += bytes.length
    return { name: record.name, ...verifyTarballBytes(bytes, record.dist) }
  })
  const mismatches = tarballResults.filter(result => !result.integrityMatches || !result.shasumMatches)
  const result = {
    ok: mismatches.length === 0,
    identityCount: items.length,
    exactVersionCount: evaluation.records.length,
    exactLatestTagCount: evaluation.records.length,
    verifiedTarballCount: tarballResults.length,
    verifiedBytes,
    mismatches
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (mismatches.length > 0) process.exitCode = 1
}

if (process.argv[1] != null && fileURLToPath(import.meta.url) === process.argv[1]) {
  const command = process.argv[2]
  if (command === 'validate-selection') await validateSelection()
  else if (command === 'verify-registry') await verifyRegistry()
  else throw new Error(`Unknown stable npm release command: ${command ?? ''}`)
}
