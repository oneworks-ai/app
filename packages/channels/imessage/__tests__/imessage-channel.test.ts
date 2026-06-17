import { describe, expect, it, vi } from 'vitest'

import { channelDefinition } from '#~/index.js'
import { createChannelConnection } from '#~/connection.js'
import { sendImessageMessage } from '#~/send.js'
import type { AppleScriptRunner } from '#~/send.js'
import type { ImessageChannelConfig } from '#~/types.js'

const config: ImessageChannelConfig = {
  type: 'imessage'
}

describe('imessage channel', () => {
  it('declares an outbound-only channel definition', () => {
    expect(channelDefinition).toMatchObject({
      type: 'imessage',
      label: 'iMessage'
    })
    expect(channelDefinition.configSchema.parse({
      type: 'imessage',
      serviceType: 'iMessage',
      inboundMode: 'disabled'
    })).toMatchObject({
      type: 'imessage',
      serviceType: 'iMessage',
      inboundMode: 'disabled'
    })
  })

  it('sends to a participant handle through Messages AppleScript', async () => {
    const runner = vi.fn<AppleScriptRunner>().mockResolvedValue({
      stderr: '',
      stdout: ''
    })

    await expect(sendImessageMessage(config, {
      receiveId: '+15555550123',
      receiveIdType: 'handle',
      text: 'hello'
    }, runner)).resolves.toBeUndefined()

    expect(runner).toHaveBeenCalledTimes(1)
    const [script, args, options] = runner.mock.calls[0]
    expect(script).toContain('tell application "Messages"')
    expect(script).toContain('send messageText to targetParticipant')
    expect(args).toEqual([
      '+15555550123',
      'hello',
      'participant',
      '',
      'iMessage'
    ])
    expect(options).toEqual({
      osascriptPath: undefined,
      timeoutMs: undefined
    })
  })

  it('can target a Messages chat id and configured account/service', async () => {
    const runner = vi.fn<AppleScriptRunner>().mockResolvedValue({
      stderr: '',
      stdout: ''
    })

    await sendImessageMessage({
      type: 'imessage',
      accountId: 'account-guid',
      osascriptPath: '/usr/bin/osascript',
      sendTimeoutMs: 5000,
      serviceType: 'RCS'
    }, {
      receiveId: 'chat-guid',
      receiveIdType: 'chat',
      text: 'hello group'
    }, runner)

    expect(runner).toHaveBeenCalledWith(expect.any(String), [
      'chat-guid',
      'hello group',
      'chat',
      'account-guid',
      'RCS'
    ], {
      osascriptPath: '/usr/bin/osascript',
      timeoutMs: 5000
    })
  })

  it('treats generic chat_id receives as handle by default for manual CLI sends', async () => {
    const runner = vi.fn<AppleScriptRunner>().mockResolvedValue({
      stderr: '',
      stdout: ''
    })

    await sendImessageMessage(config, {
      receiveId: 'user@example.com',
      receiveIdType: 'chat_id',
      text: 'hello'
    }, runner)

    expect(runner.mock.calls[0][1]).toEqual([
      'user@example.com',
      'hello',
      'participant',
      '',
      'iMessage'
    ])
  })

  it('announces that inbound receiving is disabled', async () => {
    const logger = {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      trace: vi.fn(),
      warn: vi.fn()
    }
    const connection = await createChannelConnection(config, { logger })

    await connection.startReceiving?.({
      channelKey: 'local',
      handlers: {
        message: vi.fn()
      }
    })

    expect(connection.handleWebhook).toBeUndefined()
    expect(logger.info).toHaveBeenCalledWith({
      channelKey: 'local',
      channelType: 'imessage'
    }, '[imessage] outbound-only macOS Messages bridge ready; inbound receiving is not enabled')
  })
})
