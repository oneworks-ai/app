import { ensureDebuggerAttached, sendGuardedDebuggerCommand, verifyDebuggerAttachment } from './debugger-attachment.js'
import {
  cleanDebuggerUrl,
  detachCurrentDebuggerAttachment,
  getBufferedDebuggerEvents,
  getDebuggerAttachment,
  sendDebuggerCommand
} from './debugger-state.js'
import { error } from './shared.js'
import { assertExpectedTarget } from './target-guard.js'

export { ensureDebuggerAttached, sendDebuggerCommand, verifyDebuggerAttachment }

async function establishDebuggerSession(args) {
  await verifyDebuggerAttachment(args.tab_id, undefined, () => assertExpectedTarget(args))
  const ownership = await ensureDebuggerAttached(args.tab_id, () => assertExpectedTarget(args))
  return ownership
}

export async function debugOperation(action, args) {
  if (action === 'status') {
    return {
      tab_id: args.tab_id,
      attached: getDebuggerAttachment(args.tab_id)?.ready === true,
      buffered_events: getBufferedDebuggerEvents(args.tab_id).length
    }
  }
  if (action === 'detach') {
    await detachCurrentDebuggerAttachment(args.tab_id)
    return { tab_id: args.tab_id, attached: false }
  }
  const ownership = await establishDebuggerSession(args)
  const verify = () => assertExpectedTarget(args)
  if (action === 'attach') {
    await verifyDebuggerAttachment(args.tab_id, ownership, verify)
    return { tab_id: args.tab_id, attached: true }
  }
  if (action === 'events') {
    await verifyDebuggerAttachment(args.tab_id, ownership, verify)
    const kinds = new Set(args.kinds ?? ['console', 'exception', 'network'])
    const entries = getBufferedDebuggerEvents(args.tab_id).filter(item =>
      item.cursor > (args.cursor ?? 0) && kinds.has(item.kind)
    ).slice(0, args.limit ?? 100)
    return { tab_id: args.tab_id, entries, next_cursor: entries.at(-1)?.cursor ?? args.cursor ?? 0 }
  }
  if (action === 'performance') {
    await sendGuardedDebuggerCommand(args.tab_id, ownership, verify, 'Performance.enable')
    const result = await sendGuardedDebuggerCommand(args.tab_id, ownership, verify, 'Performance.getMetrics')
    return { tab_id: args.tab_id, metrics: Object.fromEntries(result.metrics.map(item => [item.name, item.value])) }
  }
  if (action === 'dom_snapshot') {
    const result = await sendGuardedDebuggerCommand(args.tab_id, ownership, verify, 'DOMSnapshot.captureSnapshot', {
      computedStyles: [],
      includePaintOrder: false,
      includeDOMRects: true
    })
    return {
      tab_id: args.tab_id,
      documents: result.documents.map(document => ({
        url: cleanDebuggerUrl(result.strings[document.documentURL]),
        title: result.strings[document.title],
        node_count: document.nodes.nodeName.length,
        layout_count: document.layout.nodeIndex.length
      }))
    }
  }
  if (action === 'screenshot') {
    const result = await sendGuardedDebuggerCommand(args.tab_id, ownership, verify, 'Page.captureScreenshot', {
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
    const result = await sendGuardedDebuggerCommand(args.tab_id, ownership, verify, 'Page.printToPDF', {
      landscape: args.landscape === true,
      printBackground: args.print_background === true,
      transferMode: 'ReturnAsBase64'
    })
    return { tab_id: args.tab_id, mime_type: 'application/pdf', data_base64: result.data }
  }
  throw error('UNSUPPORTED_ACTION', `Unsupported debug action: ${action}`)
}
