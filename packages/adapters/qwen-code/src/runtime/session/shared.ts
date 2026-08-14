import process from 'node:process'

import type { AdapterCtx } from '@oneworks/types'

export { createQwenRuntimeRedactor } from '../redaction'

export const readQwenResumeSessionId = async (
  cache: Pick<AdapterCtx['cache'], 'get'>,
  type: 'create' | 'resume'
) => {
  if (type === 'create') return undefined
  const value = (await cache.get('adapter.qwen-code.session'))?.qwenSessionId
  const sessionId = typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
  if (type === 'resume' && sessionId == null) {
    throw new Error(
      'Qwen Code cannot resume because this One Works session has no valid cached native session id.'
    )
  }
  return sessionId
}

export const interruptProcess = (pid: number | undefined) => {
  if (pid == null) return
  try {
    if (process.platform === 'win32') {
      process.kill(pid, 'SIGINT')
    } else {
      process.kill(-pid, 'SIGINT')
    }
  } catch {
    try {
      process.kill(pid, 'SIGINT')
    } catch {
    }
  }
}
