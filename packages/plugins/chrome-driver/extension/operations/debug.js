import { error } from './shared.js'

const protocolVersion = '1.3'
const attachedTabs = new Set()
const eventBuffers = new Map()
let cursor = 0

function cleanUrl(value) {
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

function target(tabId) {
  return { tabId }
}

function record(tabId, kind, method, params) {
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
      url: cleanUrl(params.exceptionDetails?.url),
      line: params.exceptionDetails?.lineNumber
    }
  }
  if (kind === 'network') {
    entry.summary = {
      request_id: params.requestId,
      method: params.request?.method,
      url: cleanUrl(params.request?.url),
      type: params.type
    }
  }
  entries.push(entry)
  if (entries.length > 1000) entries.splice(0, entries.length - 1000)
  eventBuffers.set(tabId, entries)
}

if (chrome.debugger != null) {
  chrome.debugger.onEvent.addListener((source, method, params) => {
    if (source.tabId == null) return
    if (method === 'Runtime.consoleAPICalled') record(source.tabId, 'console', method, params)
    else if (method === 'Runtime.exceptionThrown') record(source.tabId, 'exception', method, params)
    else if (method === 'Network.requestWillBeSent') record(source.tabId, 'network', method, params)
  })
  chrome.debugger.onDetach.addListener(source => {
    if (source.tabId != null) attachedTabs.delete(source.tabId)
  })
}

export async function ensureDebuggerAttached(tabId) {
  if (chrome.debugger == null) {
    throw error('MISSING_PERMISSION', 'Install the privileged extension flavor for bounded debugger operations.', {
      missing_permissions: ['debugger']
    })
  }
  if (attachedTabs.has(tabId)) return
  await chrome.debugger.attach(target(tabId), protocolVersion)
  attachedTabs.add(tabId)
  await chrome.debugger.sendCommand(target(tabId), 'Runtime.enable')
  await chrome.debugger.sendCommand(target(tabId), 'Network.enable', {
    maxTotalBufferSize: 1_000_000,
    maxResourceBufferSize: 100_000
  })
}

export function sendDebuggerCommand(tabId, method, params) {
  return chrome.debugger.sendCommand(target(tabId), method, params)
}

export async function debugOperation(action, args) {
  if (action === 'status') {
    return {
      tab_id: args.tab_id,
      attached: attachedTabs.has(args.tab_id),
      buffered_events: eventBuffers.get(args.tab_id)?.length ?? 0
    }
  }
  if (action === 'attach') {
    await ensureDebuggerAttached(args.tab_id)
    return { tab_id: args.tab_id, attached: true }
  }
  if (action === 'detach') {
    if (attachedTabs.has(args.tab_id)) await chrome.debugger.detach(target(args.tab_id))
    attachedTabs.delete(args.tab_id)
    return { tab_id: args.tab_id, attached: false }
  }
  await ensureDebuggerAttached(args.tab_id)
  if (action === 'events') {
    const kinds = new Set(args.kinds ?? ['console', 'exception', 'network'])
    const entries = (eventBuffers.get(args.tab_id) ?? []).filter(item =>
      item.cursor > (args.cursor ?? 0) && kinds.has(item.kind)
    ).slice(0, args.limit ?? 100)
    return { tab_id: args.tab_id, entries, next_cursor: entries.at(-1)?.cursor ?? args.cursor ?? 0 }
  }
  if (action === 'performance') {
    await sendDebuggerCommand(args.tab_id, 'Performance.enable')
    const result = await sendDebuggerCommand(args.tab_id, 'Performance.getMetrics')
    return { tab_id: args.tab_id, metrics: Object.fromEntries(result.metrics.map(item => [item.name, item.value])) }
  }
  if (action === 'dom_snapshot') {
    const result = await sendDebuggerCommand(args.tab_id, 'DOMSnapshot.captureSnapshot', {
      computedStyles: [],
      includePaintOrder: false,
      includeDOMRects: true
    })
    return {
      tab_id: args.tab_id,
      documents: result.documents.map(document => ({
        url: cleanUrl(result.strings[document.documentURL]),
        title: result.strings[document.title],
        node_count: document.nodes.nodeName.length,
        layout_count: document.layout.nodeIndex.length
      }))
    }
  }
  if (action === 'screenshot') {
    const result = await sendDebuggerCommand(args.tab_id, 'Page.captureScreenshot', {
      format: args.format ?? 'png',
      captureBeyondViewport: true,
      fromSurface: true
    })
    return {
      tab_id: args.tab_id,
      mime_type: args.format === 'jpeg' ? 'image/jpeg' : 'image/png',
      data_base64: result.data
    }
  }
  if (action === 'print_to_pdf') {
    const result = await sendDebuggerCommand(args.tab_id, 'Page.printToPDF', {
      landscape: args.landscape === true,
      printBackground: args.print_background === true,
      transferMode: 'ReturnAsBase64'
    })
    return { tab_id: args.tab_id, mime_type: 'application/pdf', data_base64: result.data }
  }
  throw error('UNSUPPORTED_ACTION', `Unsupported debug action: ${action}`)
}
