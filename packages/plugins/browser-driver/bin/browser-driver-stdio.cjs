const process = require('node:process')
const readline = require('node:readline')

const isRecord = value => value != null && typeof value === 'object' && !Array.isArray(value)

module.exports = function createStdioServer(options) {
  const writeResponse = payload => process.stdout.write(`${JSON.stringify(payload)}\n`)

  async function handleRequest(request) {
    if (!isRecord(request) || request.jsonrpc !== '2.0' || typeof request.method !== 'string' || request.id == null) {
      return
    }
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
      try {
        const result = await options.callTool(
          request.params?.name,
          isRecord(request.params?.arguments) ? request.params.arguments : {}
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
      }
      return
    }
    writeResponse({
      jsonrpc: '2.0',
      id: request.id,
      error: { code: -32601, message: `Method not found: ${request.method}` }
    })
  }

  function start() {
    const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
    input.on('line', line => {
      if (!line.trim()) return
      try {
        void handleRequest(JSON.parse(line))
      } catch (error) {
        process.stderr.write(`[browser-driver] ${error instanceof Error ? error.message : String(error)}\n`)
      }
    })
  }

  return { handleRequest, start }
}
