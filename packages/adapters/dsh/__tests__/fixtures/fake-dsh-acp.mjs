#!/usr/bin/env node
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Readable, Writable } from 'node:stream'

import { AgentSideConnection, PROTOCOL_VERSION, ndJsonStream } from '@agentclientprotocol/sdk'

const configFlag = process.argv.indexOf('--config')
const configPath = configFlag >= 0 ? process.argv[configFlag + 1] : undefined
const composition = configPath == null ? [] : JSON.parse(await readFile(configPath, 'utf8'))

class FakeDshAgent {
  constructor(connection) {
    this.connection = connection
    this.sessions = new Set()
    this.promptCount = 0
  }

  async initialize() {
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentInfo: { name: 'fixture-dsh-acp', version: '0.1.0-test' },
      agentCapabilities: { loadSession: false, promptCapabilities: { image: false, audio: false } }
    }
  }

  async newSession(params) {
    if (params.mcpServers.length !== 0) throw new Error('fixture only accepts empty MCP input')
    const sessionId = `fake-dsh-${randomUUID()}`
    this.sessions.add(sessionId)
    return { sessionId }
  }

  async authenticate() {
    return {}
  }

  async prompt(params) {
    if (!this.sessions.has(params.sessionId)) throw new Error('unknown fixture session')
    this.promptCount += 1
    const permission = await this.connection.requestPermission({
      sessionId: params.sessionId,
      toolCall: { toolCallId: 'fixture-tool' },
      options: [
        { kind: 'allow_once', name: 'Allow once', optionId: 'native-allow-once' },
        { kind: 'reject_once', name: 'Reject once', optionId: 'native-reject-once' },
        { kind: 'allow_always', name: 'Allow persistently', optionId: 'native-allow-always' }
      ]
    })
    const text = params.prompt.map(part => part.type === 'text' ? part.text : '').join('')
    const response = JSON.stringify({
      composition: composition.map(plugin => plugin.name),
      processCwd: process.cwd(),
      dshHome: process.env.DSH_HOME,
      apiKeyEcho: process.env.DEEPSEEK_API_KEY,
      baseUrlEcho: process.env.DEEPSEEK_BASE_URL,
      hasApiKey: Boolean(process.env.DEEPSEEK_API_KEY),
      nodeOptions: process.env.NODE_OPTIONS,
      permission: permission.outcome,
      prompt: text
    })
    const splitAt = Math.floor(response.length / 2)
    for (const chunk of [response.slice(0, splitAt), response.slice(splitAt)]) {
      await this.connection.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: chunk }
        }
      })
    }
    return { stopReason: 'end_turn' }
  }

  async cancel() {}
}

const stream = ndJsonStream(
  Writable.toWeb(process.stdout),
  Readable.toWeb(process.stdin)
)
const connection = new AgentSideConnection(agentConnection => new FakeDshAgent(agentConnection), stream)
void connection
