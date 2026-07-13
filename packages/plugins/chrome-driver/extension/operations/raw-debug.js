import { ensureDebuggerAttached, sendDebuggerCommand } from './debug.js'
import { requireAdvancedAccess } from './security.js'
import { error } from './shared.js'

const blockedHostMethods = new Set([
  'Browser.setDownloadBehavior',
  'DOM.getFileInfo',
  'DOM.setFileInputFiles',
  'Page.setDownloadBehavior'
])

function assertNoHostFileEscape(method, params) {
  if (blockedHostMethods.has(method) || method.startsWith('FileSystem.')) {
    throw error('HOST_FILE_ACCESS_BLOCKED', 'Raw CDP does not expose host file paths or Chrome file-system primitives.')
  }
  const inspect = value => {
    if (Array.isArray(value)) {
      for (const item of value) inspect(item)
      return
    }
    if (value == null || typeof value !== 'object') {
      if (typeof value === 'string' && /^file:/iu.test(value.trim())) {
        throw error('HOST_FILE_ACCESS_BLOCKED', 'Raw CDP cannot navigate to or read a local file URL.')
      }
      return
    }
    for (const [key, child] of Object.entries(value)) {
      if (/^(?:downloadPath|filePath|files)$/u.test(key)) {
        throw error('HOST_FILE_ACCESS_BLOCKED', `Raw CDP parameter ${key} would expose a host file path.`)
      }
      inspect(child)
    }
  }
  inspect(params)
}

async function requireExpectedOrigin(tabId, expectedOrigin) {
  const tab = await chrome.tabs.get(tabId)
  if (tab.url == null || !/^https?:/u.test(tab.url)) {
    throw error('RESTRICTED_PAGE', 'Raw debugger access requires an HTTP(S) page target.')
  }
  let actual
  let expected
  try {
    actual = new URL(tab.url).origin
    expected = new URL(expectedOrigin).origin
  } catch {
    throw error('INVALID_ARGUMENT', 'expected_origin must be a valid HTTP(S) origin.')
  }
  if (actual !== expected) {
    throw error('ORIGIN_CHANGED', 'The raw debugger target navigated away from expected_origin.', {
      actual_origin: actual,
      expected_origin: expected
    })
  }
  if (typeof tab.pendingUrl === 'string' && tab.pendingUrl !== '') {
    throw error(
      'NAVIGATION_IN_PROGRESS',
      'The raw debugger target is navigating. Wait for the target document to settle and retry.'
    )
  }
  return actual
}

export async function rawDebugOperation(action, args) {
  await requireAdvancedAccess('raw_debugger')
  const origin = await requireExpectedOrigin(args.tab_id, args.expected_origin)
  if (action === 'cdp_command') {
    if (typeof args.method !== 'string' || !/^[A-Za-z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9]*$/u.test(args.method)) {
      throw error('INVALID_ARGUMENT', 'Raw CDP method must use a Domain.command name.')
    }
    assertNoHostFileEscape(args.method, args.params ?? {})
  }
  await ensureDebuggerAttached(args.tab_id)
  await requireExpectedOrigin(args.tab_id, args.expected_origin)
  if (action === 'evaluate') {
    const result = await sendDebuggerCommand(args.tab_id, 'Runtime.evaluate', {
      expression: args.expression,
      awaitPromise: args.await_promise === true,
      returnByValue: args.return_by_value !== false,
      userGesture: args.user_gesture === true,
      ...(Number.isInteger(args.execution_context_id) ? { contextId: args.execution_context_id } : {})
    })
    return { tab_id: args.tab_id, expected_origin: origin, method: 'Runtime.evaluate', result }
  }
  if (action === 'cdp_command') {
    const result = await sendDebuggerCommand(args.tab_id, args.method, args.params ?? {})
    return { tab_id: args.tab_id, expected_origin: origin, method: args.method, result }
  }
  throw error('UNSUPPORTED_ACTION', `Unsupported raw debugger action: ${action}`)
}
