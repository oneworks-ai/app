import type { JunieJsonStreamParserOptions } from './types'

const asString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const asText = (value: unknown) => (
  typeof value === 'string' && value !== '' ? value : undefined
)

const uniqueText = (...values: Array<string | undefined>) => (
  Array.from(new Set(values.filter((value): value is string => value != null))).join('\n')
)

export const projectJunieStep = (input: {
  createdAt: number
  event: Record<string, unknown>
  eventCount: number
  emitAssistantText: (id: string, content: string, createdAt: number) => void
  options: JunieJsonStreamParserOptions
}) => {
  const name = asString(input.event.name)
  const message = asText(input.event.message)
  const details = asText(input.event.details)
  const output = asText(input.event.output)
  const id = `junie-step-${input.createdAt}-${input.eventCount}`

  if (name == null) {
    input.emitAssistantText(id, uniqueText(message, details, output), input.createdAt)
    return
  }
  input.options.onEvent({
    type: 'message',
    data: {
      id,
      role: 'assistant',
      content: [{
        type: 'tool_use',
        id,
        name: `adapter:junie:${name}`,
        input: { ...(message == null ? {} : { message }), ...(details == null ? {} : { details }) }
      }],
      createdAt: input.createdAt
    }
  })
  if (output != null) {
    input.options.onEvent({
      type: 'message',
      data: {
        id: `${id}:result`,
        role: 'assistant',
        content: [{ type: 'tool_result', tool_use_id: id, content: output }],
        createdAt: input.createdAt
      }
    })
  }
}
