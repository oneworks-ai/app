#!/usr/bin/env node
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const process = require('node:process')

const { validateExtensionArchive } = require('./validate-extension-package.cjs')

const defaultApiRoot = 'https://chromewebstore.googleapis.com'
const acceptedPublishStates = new Set(['PENDING_REVIEW', 'PUBLISHED', 'PUBLISHED_TO_TESTERS', 'STAGED'])

const delay = (milliseconds) => new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds))

const responseJson = async (response, label) => {
  const body = await response.text()
  if (!response.ok) {
    throw new Error(`${label} failed with HTTP ${response.status}: ${body.slice(0, 1_000)}`)
  }
  try {
    return JSON.parse(body)
  } catch {
    throw new Error(`${label} returned invalid JSON`)
  }
}

const publishChromeWebStore = async ({
  accessToken,
  apiRoot = defaultApiRoot,
  archivePath,
  extensionId,
  fetchImpl = fetch,
  pollAttempts = 24,
  pollIntervalMs = 5_000,
  publisherId,
  requestTimeoutMs = 30_000,
  sleep = delay
}) => {
  if (!accessToken || !publisherId || !extensionId) {
    throw new Error('Chrome Web Store access token, publisher ID, and extension ID are required')
  }
  const packageResult = validateExtensionArchive({ archivePath, flavor: 'privileged' })
  if (extensionId !== packageResult.extension_id) {
    throw new Error(
      `Chrome Web Store extension ID ${extensionId} does not match packaged identity ${packageResult.extension_id}`
    )
  }
  const itemName = `publishers/${encodeURIComponent(publisherId)}/items/${encodeURIComponent(extensionId)}`
  const authorization = { Authorization: `Bearer ${accessToken}` }

  const uploadResponse = await fetchImpl(`${apiRoot}/upload/v2/${itemName}:upload`, {
    body: readFileSync(archivePath),
    headers: {
      ...authorization,
      'Content-Type': 'application/zip'
    },
    method: 'POST',
    signal: AbortSignal.timeout(requestTimeoutMs)
  })
  const upload = await responseJson(uploadResponse, 'Chrome Web Store upload')
  let uploadState = upload.uploadState
  for (let attempt = 0; uploadState === 'IN_PROGRESS' && attempt < pollAttempts; attempt += 1) {
    await sleep(pollIntervalMs)
    const statusResponse = await fetchImpl(`${apiRoot}/v2/${itemName}:fetchStatus`, {
      headers: authorization,
      signal: AbortSignal.timeout(requestTimeoutMs)
    })
    const status = await responseJson(statusResponse, 'Chrome Web Store upload status')
    uploadState = status.lastAsyncUploadState
  }
  if (uploadState !== 'SUCCEEDED') {
    throw new Error(`Chrome Web Store upload did not succeed; final state: ${String(uploadState)}`)
  }

  const publishResponse = await fetchImpl(`${apiRoot}/v2/${itemName}:publish`, {
    body: JSON.stringify({
      blockOnWarnings: true,
      publishType: 'DEFAULT_PUBLISH',
      skipReview: false
    }),
    headers: {
      ...authorization,
      'Content-Type': 'application/json'
    },
    method: 'POST',
    signal: AbortSignal.timeout(requestTimeoutMs)
  })
  const publication = await responseJson(publishResponse, 'Chrome Web Store publish')
  if (!acceptedPublishStates.has(publication.state)) {
    throw new Error(`Chrome Web Store publish returned unexpected state: ${String(publication.state)}`)
  }

  return {
    extension_id: extensionId,
    manifest_version: packageResult.manifest_version,
    package_sha256: packageResult.sha256,
    publish_state: publication.state,
    upload_state: uploadState
  }
}

const main = async () => {
  const archiveIndex = process.argv.indexOf('--archive')
  const archivePath = archiveIndex >= 0 ? process.argv[archiveIndex + 1] : undefined
  if (!archivePath) throw new Error('Usage: publish-chrome-web-store.cjs --archive <developer-extension.zip>')
  const result = await publishChromeWebStore({
    accessToken: process.env.CHROME_WEB_STORE_ACCESS_TOKEN,
    archivePath: resolve(archivePath),
    extensionId: process.env.CHROME_WEB_STORE_EXTENSION_ID,
    publisherId: process.env.CHROME_WEB_STORE_PUBLISHER_ID
  })
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}

module.exports = { publishChromeWebStore }
