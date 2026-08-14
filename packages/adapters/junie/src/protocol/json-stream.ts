import type { Buffer } from 'node:buffer'

import { createJunieCliStreamEventProjector } from './stream-event-projector'
import type { JunieJsonStreamParserOptions, JunieJsonStreamParserResult } from './types'

export type { JunieJsonStreamParserOptions, JunieJsonStreamParserResult, JunieProtocolDiagnostic } from './types'

export const createJunieJsonStreamParser = (options: JunieJsonStreamParserOptions) => {
  let buffer = ''
  let lineNumber = 0
  const projector = createJunieCliStreamEventProjector(options)

  const handleLine = (line: string) => {
    lineNumber += 1
    const trimmed = line.trim()
    if (trimmed === '') return
    try {
      projector.handle(JSON.parse(trimmed) as unknown, lineNumber)
    } catch (error) {
      projector.failInvalidJson({
        error,
        line: lineNumber,
        raw: trimmed
      })
    }
  }

  const push = (chunk: string | Buffer) => {
    buffer += chunk.toString()
    let newlineIndex = buffer.indexOf('\n')
    while (newlineIndex >= 0) {
      handleLine(buffer.slice(0, newlineIndex))
      buffer = buffer.slice(newlineIndex + 1)
      newlineIndex = buffer.indexOf('\n')
    }
  }

  const finish = (): JunieJsonStreamParserResult => {
    if (buffer.trim() !== '') {
      const finalLine = buffer
      buffer = ''
      handleLine(finalLine)
    }
    return projector.result()
  }

  return { finish, push }
}
