#!/usr/bin/env node
const process = require('node:process')
const readline = require('node:readline')

const { finalizeRecording, renderScreenshotVideo } = require('./evidence-runtime.cjs')

const serverInfo = { name: 'oneworks-cua-evidence', version: '0.1.0' }
function isRecord(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

const tools = [{
  name: 'finalize_recording',
  description:
    'Validate a completed CUA trajectory, preserve its final screenshot, and guarantee a playable MP4. The tool renders a deterministic video from per-turn screenshots and reuses the nearest prior frame when the upstream driver omits a screenshot for an otherwise valid action.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['output_dir'],
    properties: {
      output_dir: {
        type: 'string',
        description: 'Absolute directory previously passed to set_recording.'
      },
      final_screenshot: {
        type: 'string',
        description:
          'Optional absolute screenshot path to preserve as final-screenshot.png. Defaults to the last recorded turn.'
      },
      frame_duration_ms: {
        type: 'number',
        minimum: 250,
        maximum: 5000,
        description: 'Duration of each trajectory frame when the zero-frame fallback is needed. Default 1200.'
      },
      expected_state_text: {
        type: 'array',
        items: { type: 'string', minLength: 1 },
        description:
          'Optional text fragments that must appear in the semantic state associated with the final screenshot. Use this for textual outcomes such as expressions, totals, labels, and statuses.'
      }
    }
  }
}]

function writeResponse(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

function handleRequest(request) {
  if (!isRecord(request) || request.jsonrpc !== '2.0' || typeof request.method !== 'string') return
  if (request.id == null) return

  if (request.method === 'initialize') {
    writeResponse({
      jsonrpc: '2.0',
      id: request.id,
      result: {
        protocolVersion: request.params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo
      }
    })
    return
  }
  if (request.method === 'ping') {
    writeResponse({ jsonrpc: '2.0', id: request.id, result: {} })
    return
  }
  if (request.method === 'tools/list') {
    writeResponse({ jsonrpc: '2.0', id: request.id, result: { tools } })
    return
  }
  if (request.method === 'tools/call') {
    try {
      if (request.params?.name !== 'finalize_recording') throw new Error(`Unknown tool: ${request.params?.name}`)
      const result = finalizeRecording(request.params?.arguments ?? {})
      writeResponse({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result
        }
      })
    } catch (error) {
      writeResponse({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
          isError: true
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

function startServer() {
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
  input.on('line', line => {
    if (line.trim() === '') return
    try {
      handleRequest(JSON.parse(line))
    } catch (error) {
      process.stderr.write(`[cua-evidence] ${error instanceof Error ? error.message : String(error)}\n`)
    }
  })
}

module.exports = {
  finalizeRecording,
  handleRequest,
  renderScreenshotVideo
}

if (require.main === module) startServer()
