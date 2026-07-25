import {
  readDebuggerDocumentIdentity,
  sameDebuggerDocument,
  verifyDebuggerDocumentIdentity
} from './debugger-document.js'
import {
  clearDebuggerState,
  confirmDebuggerTargetAttached,
  debuggerTarget,
  detachCurrentDebuggerAttachment,
  getDebuggerAttachment,
  nextDebuggerAttachmentOwner,
  sendDebuggerCommand,
  setDebuggerAttachment
} from './debugger-state.js'
import { error } from './shared.js'

const protocolVersion = '1.3'
const targetIdentityErrorCodes = new Set([
  'NAVIGATION_IN_PROGRESS',
  'ORIGIN_CHANGED',
  'TARGET_DOCUMENT_CHANGED',
  'TARGET_URL_CHANGED'
])

function requireDebuggerAttachmentOwner(tabId, ownerId, message) {
  const attachment = getDebuggerAttachment(tabId)
  if (attachment?.owner_id !== ownerId || attachment.detaching === true) {
    throw error('TARGET_DOCUMENT_CHANGED', message)
  }
  return attachment
}

function requireReadyDebuggerAttachment(tabId, ownerId) {
  const attachment = getDebuggerAttachment(tabId)
  if (
    attachment?.owner_id !== ownerId ||
    attachment.ready !== true ||
    attachment.detaching === true
  ) {
    throw error(
      'TARGET_DOCUMENT_CHANGED',
      'The debugger attachment changed while the execution target was being verified.'
    )
  }
  return attachment
}

export async function ensureDebuggerAttached(tabId, verifyAfterAttach) {
  if (chrome.debugger == null) {
    throw error('MISSING_PERMISSION', 'Install the privileged extension flavor for bounded debugger operations.', {
      missing_permissions: ['debugger']
    })
  }
  const existing = getDebuggerAttachment(tabId)
  if (existing?.ready === true) return { newly_attached: false, owner_id: existing.owner_id }
  if (existing != null) {
    throw error('DEBUGGER_INITIALIZING', 'The debugger target is already initializing. Retry the operation.')
  }
  const ownerId = nextDebuggerAttachmentOwner()
  setDebuggerAttachment(tabId, {
    main_frame_id: undefined,
    owner_id: ownerId,
    ready: false,
    url_sha256: undefined
  })
  let physicallyAttached = false
  try {
    await chrome.debugger.attach(debuggerTarget(tabId), protocolVersion)
    physicallyAttached = true
    const physicallyAttachedState = requireDebuggerAttachmentOwner(
      tabId,
      ownerId,
      'The debugger target detached during attachment initialization.'
    )
    physicallyAttachedState.physically_attached = true
    const stillAttached = await confirmDebuggerTargetAttached(tabId, ownerId)
    if (stillAttached === false) {
      throw error('TARGET_DOCUMENT_CHANGED', 'The debugger target detached during attachment initialization.')
    }
    let verification = await verifyAfterAttach?.()
    if (typeof verification?.url_sha256 !== 'string') {
      throw error('INVALID_TARGET_GUARD', 'Debugger attachment requires an exact execution-target fingerprint.')
    }
    const initialAttachment = requireDebuggerAttachmentOwner(
      tabId,
      ownerId,
      'The debugger target detached during attachment initialization.'
    )
    initialAttachment.url_sha256 = verification.url_sha256
    await sendDebuggerCommand(tabId, 'Runtime.enable')
    requireDebuggerAttachmentOwner(tabId, ownerId, 'The debugger target navigated while Runtime was enabling.')
    verification = await verifyAfterAttach?.()
    requireDebuggerAttachmentOwner(tabId, ownerId, 'The debugger target navigated after Runtime was enabled.')
    await sendDebuggerCommand(tabId, 'Network.enable', {
      maxTotalBufferSize: 1_000_000,
      maxResourceBufferSize: 100_000
    })
    requireDebuggerAttachmentOwner(tabId, ownerId, 'The debugger target navigated while Network was enabling.')
    verification = await verifyAfterAttach?.()
    requireDebuggerAttachmentOwner(tabId, ownerId, 'The debugger target navigated after Network was enabled.')
    await sendDebuggerCommand(tabId, 'Page.enable')
    requireDebuggerAttachmentOwner(tabId, ownerId, 'The debugger target navigated while Page was enabling.')
    const initialDocument = await readDebuggerDocumentIdentity(tabId)
    const provisional = requireDebuggerAttachmentOwner(
      tabId,
      ownerId,
      'The debugger target navigated while the attachment was initializing.'
    )
    provisional.isolate_id = initialDocument.isolate_id
    provisional.loader_id = initialDocument.loader_id
    provisional.main_frame_id = initialDocument.main_frame_id
    verification = await verifyAfterAttach?.()
    if (typeof verification?.url_sha256 !== 'string') {
      throw error('INVALID_TARGET_GUARD', 'Debugger attachment requires an exact execution-target fingerprint.')
    }
    const confirmedDocument = await readDebuggerDocumentIdentity(tabId)
    const confirmedAttachment = getDebuggerAttachment(tabId)
    if (
      confirmedAttachment?.owner_id !== ownerId ||
      confirmedAttachment.detaching === true ||
      !sameDebuggerDocument(initialDocument, confirmedDocument)
    ) {
      throw error('TARGET_DOCUMENT_CHANGED', 'The debugger target document changed during attachment initialization.')
    }
    setDebuggerAttachment(tabId, {
      isolate_id: confirmedDocument.isolate_id,
      loader_id: confirmedDocument.loader_id,
      main_frame_id: confirmedDocument.main_frame_id,
      owner_id: ownerId,
      physically_attached: true,
      ready: true,
      url_sha256: verification.url_sha256
    })
    return { newly_attached: true, owner_id: ownerId }
  } catch (attachError) {
    const currentAttachment = getDebuggerAttachment(tabId)
    if (currentAttachment?.owner_id === ownerId) {
      if (currentAttachment.detaching === true) {
        await currentAttachment.detach_promise
      } else if (physicallyAttached) {
        await detachCurrentDebuggerAttachment(tabId, ownerId)
      } else {
        clearDebuggerState(tabId)
      }
    }
    throw attachError
  }
}

export async function verifyDebuggerAttachment(tabId, ownership, verify) {
  const expectedOwnerId = ownership?.owner_id ?? getDebuggerAttachment(tabId)?.owner_id
  try {
    const verification = await verify()
    const attachment = expectedOwnerId == null
      ? getDebuggerAttachment(tabId)
      : requireReadyDebuggerAttachment(tabId, expectedOwnerId)
    if (
      attachment?.ready === true &&
      typeof verification?.url_sha256 === 'string' &&
      attachment.url_sha256 !== verification.url_sha256
    ) {
      await detachCurrentDebuggerAttachment(tabId, attachment.owner_id)
      throw error('TARGET_URL_CHANGED', 'The persistent debugger attachment no longer matches the execution target.', {
        actual_fingerprint: verification.url_sha256.slice(0, 12),
        expected_fingerprint: attachment.url_sha256.slice(0, 12),
        tab_id: tabId
      })
    }
    if (attachment?.ready === true) {
      await verifyDebuggerDocumentIdentity(tabId, attachment.owner_id)
    }
    return verification
  } catch (verificationError) {
    if (ownership?.newly_attached === true) {
      await detachCurrentDebuggerAttachment(tabId, ownership.owner_id)
    } else if (expectedOwnerId != null && targetIdentityErrorCodes.has(verificationError?.code)) {
      await detachCurrentDebuggerAttachment(tabId, expectedOwnerId)
    }
    throw verificationError
  }
}

export async function sendGuardedDebuggerCommand(tabId, ownership, verify, method, params) {
  await verifyDebuggerAttachment(tabId, ownership, verify)
  requireReadyDebuggerAttachment(tabId, ownership.owner_id)
  const result = await sendDebuggerCommand(tabId, method, params)
  await verifyDebuggerAttachment(tabId, ownership, verify)
  return result
}
