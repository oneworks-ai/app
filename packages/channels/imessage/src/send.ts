import type { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'

import type { ChannelSendResult } from '@oneworks/core/channel'

import type { ImessageChannelConfig, ImessageChannelMessage } from '#~/types.js'

const DEFAULT_OSASCRIPT_PATH = 'osascript'
const DEFAULT_SEND_TIMEOUT_MS = 30000
const MAX_CAPTURED_OUTPUT_LENGTH = 8192

export interface AppleScriptRunOptions {
  osascriptPath?: string
  timeoutMs?: number
}

export type AppleScriptRunner = (
  script: string,
  args: readonly string[],
  options?: AppleScriptRunOptions
) => Promise<{
  stderr: string
  stdout: string
}>

const SEND_MESSAGE_APPLESCRIPT = `
on run argv
  set targetId to item 1 of argv
  set messageText to item 2 of argv
  set targetKind to item 3 of argv
  set configuredAccountId to item 4 of argv
  set configuredServiceType to item 5 of argv

  tell application "Messages"
    if configuredAccountId is not "" then
      set targetAccount to account id configuredAccountId
    else
      if configuredServiceType is "SMS" then
        set targetAccount to 1st account whose service type = SMS
      else if configuredServiceType is "RCS" then
        set targetAccount to 1st account whose service type = RCS
      else
        set targetAccount to 1st account whose service type = iMessage
      end if
    end if

    if targetKind is "chat" then
      set targetChat to 1st chat whose id is targetId
      send messageText to targetChat
    else
      set targetParticipant to participant targetId of targetAccount
      send messageText to targetParticipant
    end if
  end tell
end run
`.trim()

const truncateProcessOutput = (value: string) =>
  value.length <= MAX_CAPTURED_OUTPUT_LENGTH
    ? value
    : `${value.slice(0, MAX_CAPTURED_OUTPUT_LENGTH)}…`

const appendOutput = (current: string, chunk: Buffer) => truncateProcessOutput(`${current}${chunk.toString('utf8')}`)

const resolveTargetKind = (
  config: ImessageChannelConfig,
  message: ImessageChannelMessage
) => {
  if (message.receiveIdType === 'chat') return 'chat'
  if (message.receiveIdType === 'chat_id') return config.defaultReceiveIdType ?? 'handle'
  return message.receiveIdType ?? config.defaultReceiveIdType ?? 'handle'
}

export const runAppleScript: AppleScriptRunner = async (script, args, options) => {
  const osascriptPath = options?.osascriptPath ?? DEFAULT_OSASCRIPT_PATH
  const timeoutMs = options?.timeoutMs ?? DEFAULT_SEND_TIMEOUT_MS

  return await new Promise((resolve, reject) => {
    const child = spawn(osascriptPath, ['-e', script, ...args], {
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      reject(new Error(`iMessage send timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = appendOutput(stdout, chunk)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = appendOutput(stderr, chunk)
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code === 0) {
        resolve({ stderr, stdout })
        return
      }

      const details = stderr.trim() || stdout.trim() ||
        `exit code ${code ?? 'unknown'}${signal == null ? '' : `, signal ${signal}`}`
      reject(new Error(`iMessage send failed: ${details}`))
    })
  })
}

export const sendImessageMessage = async (
  config: ImessageChannelConfig,
  message: ImessageChannelMessage,
  runner: AppleScriptRunner = runAppleScript
): Promise<ChannelSendResult | undefined> => {
  const targetKind = resolveTargetKind(config, message)
  if (targetKind !== 'handle' && targetKind !== 'participant' && targetKind !== 'chat') {
    throw new Error(`Unsupported iMessage receiveIdType: ${message.receiveIdType ?? targetKind}`)
  }

  await runner(SEND_MESSAGE_APPLESCRIPT, [
    message.receiveId,
    message.text,
    targetKind === 'chat' ? 'chat' : 'participant',
    config.accountId ?? '',
    config.serviceType ?? 'iMessage'
  ], {
    osascriptPath: config.osascriptPath,
    timeoutMs: config.sendTimeoutMs
  })

  return undefined
}
