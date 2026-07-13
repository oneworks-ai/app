const process = require('node:process')
const readline = require('node:readline')

const isRecord = value => value != null && typeof value === 'object' && !Array.isArray(value)

module.exports = function createStdioServer(options) {
  const activeRequests = new Map()
  const writeResponse = payload => process.stdout.write(`${JSON.stringify(payload)}\n`)

  async function cancelAll() {
    const active = [...activeRequests.entries()]
    active.forEach(([, controller]) => controller.abort())
    await Promise.allSettled(active.map(async ([requestId]) => await options.onCancel?.({ requestId })))
  }

  async function handleRequest(request) {
    if (!isRecord(request) || request.jsonrpc !== '2.0' || typeof request.method !== 'string') return
    if (request.method === 'notifications/cancelled') {
      const requestId = request.params?.requestId
      const controller = activeRequests.get(String(requestId))
      if (controller == null) return
      controller.abort()
      await options.onCancel?.({ requestId })
      return
    }
    if (request.id == null) return
    if (request.method === 'initialize') {
      writeResponse({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          protocolVersion: request.params?.protocolVersion ?? '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: options.serverInfo
        }
      })
      return
    }
    if (request.method === 'ping') {
      writeResponse({ jsonrpc: '2.0', id: request.id, result: {} })
      return
    }
    if (request.method === 'tools/list') {
      writeResponse({ jsonrpc: '2.0', id: request.id, result: { tools: options.tools } })
      return
    }
    if (request.method === 'tools/call') {
      const requestKey = String(request.id)
      const controller = new AbortController()
      activeRequests.set(requestKey, controller)
      try {
        const result = await options.callTool(
          request.params?.name,
          isRecord(request.params?.arguments) ? request.params.arguments : {},
          { requestId: request.id, signal: controller.signal }
        )
        writeResponse({ jsonrpc: '2.0', id: request.id, result })
      } catch (error) {
        writeResponse({
          jsonrpc: '2.0',
          id: request.id,
          result: {
            content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
            isError: true,
            structuredContent: { code: error?.code || 'BROWSER_TOOL_FAILED' }
          }
        })
      } finally {
        if (activeRequests.get(requestKey) === controller) activeRequests.delete(requestKey)
      }
      return
    }
    writeResponse({
      jsonrpc: '2.0',
      id: request.id,
      error: { code: -32601, message: `Method not found: ${request.method}` }
    })
  }

  function start(inputStream = process.stdin) {
    const input = readline.createInterface({ input: inputStream, crlfDelay: Infinity })
    input.on('line', line => {
      if (!line.trim()) return
      try {
        void handleRequest(JSON.parse(line))
      } catch (error) {
        process.stderr.write(`[browser-driver] ${error instanceof Error ? error.message : String(error)}\n`)
      }
    })
    input.once('close', () => {
      void (async () => {
        await cancelAll()
        await options.onClose?.()
      })().catch(error => {
        process.stderr.write(`[browser-driver] ${error instanceof Error ? error.message : String(error)}\n`)
      })
    })
  }

  return { cancelAll, handleRequest, start }
}
