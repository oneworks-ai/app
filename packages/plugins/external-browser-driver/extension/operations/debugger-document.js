import { detachCurrentDebuggerAttachment, getDebuggerAttachment, sendDebuggerCommand } from './debugger-state.js'
import { error } from './shared.js'

export const sameDebuggerDocument = (left, right) =>
  left?.main_frame_id === right?.main_frame_id &&
  left?.loader_id === right?.loader_id &&
  left?.isolate_id === right?.isolate_id

export async function readDebuggerDocumentIdentity(tabId) {
  const beforeFrame = (await sendDebuggerCommand(tabId, 'Page.getFrameTree'))?.frameTree?.frame
  const isolate = await sendDebuggerCommand(tabId, 'Runtime.getIsolateId')
  const afterFrame = (await sendDebuggerCommand(tabId, 'Page.getFrameTree'))?.frameTree?.frame
  const before = {
    isolate_id: isolate?.id,
    loader_id: beforeFrame?.loaderId,
    main_frame_id: beforeFrame?.id
  }
  const after = {
    isolate_id: isolate?.id,
    loader_id: afterFrame?.loaderId,
    main_frame_id: afterFrame?.id
  }
  if (!sameDebuggerDocument(before, after)) {
    throw error('TARGET_DOCUMENT_CHANGED', 'The debugger target document changed while its identity was sampled.')
  }
  return after
}

export async function verifyDebuggerDocumentIdentity(tabId, ownerId) {
  const expected = getDebuggerAttachment(tabId)
  if (
    expected?.owner_id !== ownerId ||
    expected.ready !== true ||
    expected.detaching === true
  ) {
    throw error(
      'TARGET_DOCUMENT_CHANGED',
      'The debugger attachment changed while its document identity was being verified.'
    )
  }
  let actual
  try {
    actual = await readDebuggerDocumentIdentity(tabId)
  } catch (identityError) {
    await detachCurrentDebuggerAttachment(tabId, ownerId)
    if (identityError?.code === 'TARGET_DOCUMENT_CHANGED') throw identityError
    throw error('TARGET_DOCUMENT_CHANGED', 'The debugger target document could not be verified.')
  }
  const current = getDebuggerAttachment(tabId)
  if (
    current?.owner_id !== ownerId ||
    current.ready !== true ||
    current.detaching === true ||
    !sameDebuggerDocument(expected, actual)
  ) {
    await detachCurrentDebuggerAttachment(tabId, ownerId)
    throw error('TARGET_DOCUMENT_CHANGED', 'The debugger target document changed during the guarded command.')
  }
  return actual
}
