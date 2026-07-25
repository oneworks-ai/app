const attachedTabs = new Map()
const eventBuffers = new Map()
let attachmentGeneration = 0
let cursor = 0

export function cleanDebuggerUrl(value) {
  try {
    const url = new URL(value)
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return String(value ?? '').slice(0, 240)
  }
}

export function debuggerTarget(tabId) {
  return { tabId }
}

export function nextDebuggerAttachmentOwner() {
  attachmentGeneration += 1
  return attachmentGeneration
}

export function getDebuggerAttachment(tabId) {
  return attachedTabs.get(tabId)
}

export function setDebuggerAttachment(tabId, attachment) {
  attachedTabs.set(tabId, attachment)
}

export function clearDebuggerState(tabId, ownerId) {
  if (ownerId != null && attachedTabs.get(tabId)?.owner_id !== ownerId) return false
  attachedTabs.delete(tabId)
  eventBuffers.delete(tabId)
  return true
}

export function clearBufferedDebuggerEvents(tabId) {
  eventBuffers.delete(tabId)
}

export function getBufferedDebuggerEvents(tabId) {
  return eventBuffers.get(tabId) ?? []
}

export function sendDebuggerCommand(tabId, method, params) {
  return chrome.debugger.sendCommand(debuggerTarget(tabId), method, params)
}

async function debuggerTargetAttachmentStatus(tabId) {
  if (typeof chrome.debugger.getTargets !== 'function') return undefined
  let targets
  try {
    targets = await chrome.debugger.getTargets()
  } catch {
    return undefined
  }
  if (!targets.some(candidate => candidate.tabId === tabId && candidate.attached === true)) return false
  try {
    await chrome.debugger.sendCommand(debuggerTarget(tabId), 'Runtime.getIsolateId')
    return true
  } catch {
    return false
  }
}

export async function confirmDebuggerTargetAttached(tabId, ownerId) {
  const attached = await debuggerTargetAttachmentStatus(tabId)
  const attachment = attachedTabs.get(tabId)
  if (attachment?.owner_id !== ownerId) return false
  if (attached === true) {
    attachment.detach_event_pending = false
    return true
  }
  return attached
}

export async function detachCurrentDebuggerAttachment(tabId, ownerId) {
  const attachment = attachedTabs.get(tabId)
  if (attachment == null || ownerId != null && attachment.owner_id !== ownerId) return false
  if (attachment.detach_promise != null) {
    await attachment.detach_promise
    return true
  }
  const attachmentOwnerId = attachment.owner_id
  attachment.ready = false
  attachment.detaching = true
  clearBufferedDebuggerEvents(tabId)
  attachment.detach_promise = chrome.debugger.detach(debuggerTarget(tabId)).catch(() => undefined)
  await attachment.detach_promise
  clearDebuggerState(tabId, attachmentOwnerId)
  return true
}

function record(tabId, kind, method, params) {
  if (attachedTabs.get(tabId)?.ready !== true) return
  const entries = eventBuffers.get(tabId) ?? []
  const entry = { cursor: ++cursor, at: new Date().toISOString(), kind, method }
  if (kind === 'console') {
    entry.summary = {
      type: params.type,
      text: params.args?.map(arg => arg.description || arg.type).join(' ').slice(0, 500)
    }
  }
  if (kind === 'exception') {
    entry.summary = {
      text: params.exceptionDetails?.text?.slice(0, 500),
      url: cleanDebuggerUrl(params.exceptionDetails?.url),
      line: params.exceptionDetails?.lineNumber
    }
  }
  if (kind === 'network') {
    entry.summary = {
      request_id: params.requestId,
      method: params.request?.method,
      url: cleanDebuggerUrl(params.request?.url),
      type: params.type
    }
  }
  entries.push(entry)
  if (entries.length > 1000) entries.splice(0, entries.length - 1000)
  eventBuffers.set(tabId, entries)
}

function invalidateCurrentAttachment(tabId) {
  const attachment = attachedTabs.get(tabId)
  if (attachment == null) return
  void detachCurrentDebuggerAttachment(tabId, attachment.owner_id)
}

async function reconcileDebuggerDetach(tabId, ownerId) {
  const attachment = attachedTabs.get(tabId)
  if (attachment?.owner_id !== ownerId) return
  if (attachment.physically_attached !== true) {
    attachment.detach_event_pending = true
    return
  }
  const attached = await debuggerTargetAttachmentStatus(tabId)
  if (attached === false) clearDebuggerState(tabId, ownerId)
  else if (attached === true && attachedTabs.get(tabId)?.owner_id === ownerId) {
    attachedTabs.get(tabId).detach_event_pending = false
  }
}

function invalidateForNavigation(tabId, method, params) {
  const attachment = attachedTabs.get(tabId)
  if (attachment == null) return false
  const topLevelNavigation = (method === 'Page.frameNavigated' && params.frame?.parentId == null) ||
    (method === 'Page.frameStartedLoading' &&
      (attachment.ready !== true || params.frameId === attachment.main_frame_id)) ||
    (method === 'Page.navigatedWithinDocument' && params.frameId === attachment.main_frame_id)
  if (!topLevelNavigation) return false
  invalidateCurrentAttachment(tabId)
  return true
}

if (chrome.debugger != null) {
  chrome.debugger.onEvent.addListener((source, method, params) => {
    if (source.tabId == null) return
    if (invalidateForNavigation(source.tabId, method, params)) return
    if (method === 'Runtime.consoleAPICalled') record(source.tabId, 'console', method, params)
    else if (method === 'Runtime.exceptionThrown') record(source.tabId, 'exception', method, params)
    else if (method === 'Network.requestWillBeSent') record(source.tabId, 'network', method, params)
  })
  chrome.debugger.onDetach.addListener(source => {
    if (source.tabId == null) return
    const ownerId = attachedTabs.get(source.tabId)?.owner_id
    if (ownerId == null) return
    void reconcileDebuggerDetach(source.tabId, ownerId)
  })
}
