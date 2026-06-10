import type { ChatMessageContent } from '@oneworks/core'
import type { TaskDetail } from '@oneworks/types'

import type { CliSessionResumeRecord } from '#~/session-cache.js'

export const RUN_OUTPUT_FORMATS = ['text', 'json', 'stream-json'] as const
export const RUN_INPUT_FORMATS = ['text', 'json', 'stream-json'] as const

export type RunOutputFormat = (typeof RUN_OUTPUT_FORMATS)[number]
export type RunInputFormat = (typeof RUN_INPUT_FORMATS)[number]

export interface RunOptions {
  print: boolean
  printIdleTimeout?: number
  model?: string
  effort?: 'low' | 'medium' | 'high' | 'max'
  adapter?: string
  account?: string
  systemPrompt?: string
  permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'dontAsk' | 'bypassPermissions'
  yolo?: boolean
  sessionId?: string
  resume?: string | boolean
  fork?: string | boolean
  spec?: string
  entity?: string
  workspace?: string
  outputFormat?: RunOutputFormat
  inputFormat?: RunInputFormat
  includeMcpServer?: string[]
  excludeMcpServer?: string[]
  includeTool?: string[]
  excludeTool?: string[]
  includeSkill?: string[]
  excludeSkill?: string[]
  injectDefaultSystemPrompt?: boolean
  defaultOneworksMcpServer?: boolean
  updateSkills?: boolean
}

export interface ActiveCliSessionRecord {
  resume: CliSessionResumeRecord
  detail: TaskDetail
}

export interface ExitControllableSession {
  kill(): void
  stop?(): void
  flushHooks?(): Promise<void>
}

export type CliInputControlEvent =
  | { type: 'message'; content: string | ChatMessageContent[] }
  | { type: 'interrupt' }
  | { type: 'stop' }
  | { type: 'submit_input'; interactionId?: string; data: string | string[] }

export interface CliInputSession {
  emit(
    event:
      | { type: 'message'; content: ChatMessageContent[] }
      | { type: 'interrupt' }
      | { type: 'stop' }
  ): void
}
