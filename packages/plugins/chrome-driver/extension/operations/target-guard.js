import { error } from './shared.js'

const fingerprintPattern = /^[a-f0-9]{64}$/u
const guardedPageActions = new Set([
  'print',
  'print_to_pdf',
  'save_mhtml',
  'screenshot',
  'snapshot',
  'snapshot_sensitive',
  'type_sensitive'
])

const canonicalTargetUrl = value => {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) return undefined
    return url.toString()
  } catch {
    return undefined
  }
}

export async function fingerprintTargetUrl(value) {
  const canonical = canonicalTargetUrl(value)
  if (canonical == null) return undefined
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

async function readFrameIdentity(tabId, frameId) {
  let frame
  if (typeof chrome.webNavigation?.getFrame === 'function') {
    frame = await chrome.webNavigation.getFrame({ tabId, frameId })
  } else {
    frame = (await chrome.webNavigation?.getAllFrames?.({ tabId }) ?? [])
      .find(candidate => candidate.frameId === frameId)
  }
  if (frame == null || typeof frame.documentId !== 'string' || frame.documentId === '') {
    throw error('TARGET_DOCUMENT_CHANGED', 'The Chrome target document changed after OneWorks bound the operation.')
  }
  return {
    document_id: frame.documentId,
    frame_id: frame.frameId,
    url_sha256: await fingerprintTargetUrl(frame.url)
  }
}

export function documentIdentityForFrame(frame) {
  if (frame == null || typeof frame.documentId !== 'string' || frame.documentId === '') {
    throw error('TARGET_DOCUMENT_CHANGED', 'The Chrome target document is missing a stable document identity.')
  }
  return {
    document_id: frame.documentId,
    frame_id: frame.frameId
  }
}

export async function bindExpectedDocumentTarget(args, frameId = 0) {
  if (typeof args.document_id !== 'string' || args.document_id === '') {
    throw error('DOCUMENT_ID_REQUIRED', 'This operation requires the main document_id returned by frame discovery.')
  }
  const [, identity] = await Promise.all([
    assertExpectedTarget(args),
    readFrameIdentity(args.tab_id, frameId)
  ])
  if (identity.document_id !== args.document_id) {
    throw error('TARGET_DOCUMENT_CHANGED', 'The Chrome target document changed after OneWorks bound the operation.', {
      tab_id: args.tab_id
    })
  }
  return identity
}

export async function assertExpectedDocumentTarget(args, expected) {
  const [, actual] = await Promise.all([
    assertExpectedTarget(args),
    readFrameIdentity(args.tab_id, expected.frame_id)
  ])
  if (
    actual.document_id !== expected.document_id ||
    expected.url_sha256 != null && actual.url_sha256 !== expected.url_sha256
  ) {
    throw error('TARGET_DOCUMENT_CHANGED', 'The Chrome target document changed after OneWorks bound the operation.', {
      tab_id: args.tab_id
    })
  }
  return actual
}

const expectedGuardFor = (expectedTargets, tabId) => {
  if (!Array.isArray(expectedTargets)) return undefined
  return expectedTargets.find(target => target?.tab_id === tabId)
}

export function operationRequiresExpectedTargets(op) {
  if (typeof op !== 'string') return false
  const [module, action] = op.split('.')
  if (module === 'raw') return true
  if (module === 'debug') return !new Set(['detach', 'status']).has(action)
  return module === 'page' && guardedPageActions.has(action)
}

export async function assertExpectedTarget(args) {
  const expected = expectedGuardFor(args.expected_targets, args.tab_id)
  if (expected == null) return
  if (typeof expected.url_sha256 !== 'string' || !fingerprintPattern.test(expected.url_sha256)) {
    throw error('INVALID_TARGET_GUARD', 'The Chrome execution target guard requires a SHA-256 URL fingerprint.', {
      tab_id: args.tab_id
    })
  }
  const tab = await chrome.tabs.get(args.tab_id)
  if (typeof tab.pendingUrl === 'string' && tab.pendingUrl !== '') {
    throw error(
      'NAVIGATION_IN_PROGRESS',
      'The Chrome target started navigating after OneWorks bound the operation target.'
    )
  }
  const actualFingerprint = await fingerprintTargetUrl(tab.url)
  if (actualFingerprint !== expected.url_sha256) {
    throw error('TARGET_URL_CHANGED', 'The Chrome target URL changed after OneWorks bound the operation target.', {
      ...(actualFingerprint == null ? {} : { actual_fingerprint: actualFingerprint.slice(0, 12) }),
      expected_fingerprint: expected.url_sha256.slice(0, 12),
      tab_id: args.tab_id
    })
  }
  return { url_sha256: actualFingerprint }
}

export async function assertExpectedTargets(expectedTargets) {
  if (expectedTargets == null) return
  if (!Array.isArray(expectedTargets)) {
    throw error('INVALID_TARGET_GUARD', 'Expected Chrome target guards must be a typed array.')
  }
  for (const expected of expectedTargets) {
    if (
      expected == null ||
      !Number.isInteger(expected.tab_id) ||
      typeof expected.url_sha256 !== 'string' ||
      !fingerprintPattern.test(expected.url_sha256)
    ) {
      throw error(
        'INVALID_TARGET_GUARD',
        'Each expected Chrome target guard requires a tab_id and SHA-256 URL fingerprint.'
      )
    }
    await assertExpectedTarget({ expected_targets: expectedTargets, tab_id: expected.tab_id })
  }
}

export async function assertCommandExpectedTargets(op, expectedTargets) {
  if (op === 'debug.detach') return
  if (operationRequiresExpectedTargets(op) && (!Array.isArray(expectedTargets) || expectedTargets.length === 0)) {
    throw error(
      'INVALID_TARGET_GUARD',
      'This Chrome operation requires an execution target guard from a compatible OneWorks bridge.'
    )
  }
  await assertExpectedTargets(expectedTargets)
}
