/* eslint-disable max-lines -- the Responses normalization star remains colocated to keep semantics auditable. */
import { UnsupportedProtocolFeatureError, asArray, asNumber, asString, isJsonObject } from './protocol.js'
import type { JsonObject, JsonValue, ModelServiceApiProtocol } from './protocol.js'

export interface TranslateResponsesRequestOptions {
  target: Exclude<ModelServiceApiProtocol, 'gemini-interactions'>
  request: JsonObject
}

export interface TranslateResponseOptions {
  source: Exclude<ModelServiceApiProtocol, 'gemini-interactions'>
  response: JsonObject
  requestId?: string
  reasoningSummary?: string
}

interface NormalizedMessage {
  role: 'system' | 'developer' | 'user' | 'assistant'
  content: NormalizedPart[]
}
type NormalizedPart =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string }
  | { type: 'function_call'; callId: string; name: string; arguments: string }
  | { type: 'function_output'; callId: string; name: string; output: string }
  | { type: 'reasoning'; provider: 'anthropic' | 'gemini'; signature: string; text: string }

interface NormalizedRequest {
  model?: string
  instructions?: string
  messages: NormalizedMessage[]
  tools: JsonObject[]
  toolChoice?: JsonValue
  maxOutputTokens?: number
  reasoningEffort?: string
  reasoningSummary?: string
  textFormat?: JsonObject
  textVerbosity?: 'low' | 'medium' | 'high'
  stream: boolean
  store?: boolean
  parallelToolCalls?: boolean
  temperature?: number
  topP?: number
  chatControls: JsonObject
  unsupportedControls: string[]
}

const copy = <T extends JsonValue>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export interface ReasoningCarrier {
  provider: 'anthropic' | 'gemini'
  signature: string
  text: string
}

const REASONING_CARRIER_PREFIX = 'owmp:v1:'
export const encodeReasoningCarrier = (carrier: ReasoningCarrier) => (
  `${REASONING_CARRIER_PREFIX}${JSON.stringify(carrier)}`
)
const decodeReasoningCarrier = (value: string | undefined): ReasoningCarrier | undefined => {
  if (!value?.startsWith(REASONING_CARRIER_PREFIX)) return undefined
  try {
    const parsed: unknown = JSON.parse(value.slice(REASONING_CARRIER_PREFIX.length))
    if (
      !isJsonObject(parsed) ||
      (parsed.provider !== 'anthropic' && parsed.provider !== 'gemini') ||
      typeof parsed.signature !== 'string' ||
      typeof parsed.text !== 'string'
    ) return undefined
    return parsed as unknown as ReasoningCarrier
  } catch {
    return undefined
  }
}

const toText = (value: JsonValue | undefined, feature: string) => {
  if (typeof value === 'string') return value
  if (isJsonObject(value)) {
    const text = asString(value.text) ?? asString(value.value)
    if (text !== undefined) return text
  }
  throw new UnsupportedProtocolFeatureError(feature)
}

const responseInputToMessages = (input: JsonValue | undefined): NormalizedMessage[] => {
  if (typeof input === 'string') return [{ role: 'user', content: [{ type: 'text', text: input }] }]
  const entries = asArray(input)
  const functionNames = new Map<string, string>()
  for (const entry of entries) {
    if (!isJsonObject(entry) || entry.type !== 'function_call') continue
    const callId = asString(entry.call_id)
    const name = asString(entry.name)
    if (callId && name) functionNames.set(callId, name)
  }
  const messages = entries.map((entry): NormalizedMessage => {
    if (!isJsonObject(entry)) throw new UnsupportedProtocolFeatureError('non-object Responses input item')
    const type = asString(entry.type) ?? 'message'
    if (type === 'message') {
      const role = asString(entry.role) ?? 'user'
      if (!['system', 'developer', 'user', 'assistant'].includes(role)) {
        throw new UnsupportedProtocolFeatureError(`message role ${role}`)
      }
      const rawContent = entry.content
      const content = typeof rawContent === 'string'
        ? [{ type: 'text', text: rawContent } satisfies NormalizedPart]
        : asArray(rawContent).map((part): NormalizedPart => {
          if (!isJsonObject(part)) throw new UnsupportedProtocolFeatureError('non-object message content')
          const partType = asString(part.type)
          if (partType === 'input_text' || partType === 'output_text' || partType === 'text') {
            return { type: 'text', text: toText(part.text, partType) }
          }
          if (partType === 'input_image') {
            const url = asString(part.image_url) ??
              asString(isJsonObject(part.image_url) ? part.image_url.url : undefined)
            if (!url) throw new UnsupportedProtocolFeatureError('input image without image_url')
            return { type: 'image', url }
          }
          throw new UnsupportedProtocolFeatureError(`Responses content type ${partType ?? 'missing'}`)
        })
      return { role: role as NormalizedMessage['role'], content }
    }
    if (type === 'function_call') {
      const callId = asString(entry.call_id)
      const name = asString(entry.name)
      const args = asString(entry.arguments) ?? ''
      if (!callId || !name) throw new UnsupportedProtocolFeatureError('function call without call_id or name')
      return { role: 'assistant', content: [{ type: 'function_call', callId, name, arguments: args }] }
    }
    if (type === 'function_call_output') {
      const callId = asString(entry.call_id)
      if (!callId) throw new UnsupportedProtocolFeatureError('function output without call_id')
      const name = functionNames.get(callId)
      if (!name) throw new UnsupportedProtocolFeatureError('function output without a matching function call')
      return {
        role: 'user',
        content: [{
          type: 'function_output',
          callId,
          name,
          output: toText(entry.output, 'function_call_output')
        }]
      }
    }
    if (type === 'reasoning') {
      const carrier = decodeReasoningCarrier(asString(entry.encrypted_content))
      if (carrier == null) throw new UnsupportedProtocolFeatureError('foreign or missing reasoning carrier')
      return {
        role: 'assistant',
        content: [{ type: 'reasoning', ...carrier } satisfies NormalizedPart]
      }
    }
    throw new UnsupportedProtocolFeatureError(`Responses input item ${type}`)
  })
  return messages.reduce<NormalizedMessage[]>((merged, message) => {
    const previous = merged.at(-1)
    const adjacentAssistantTurn = previous?.role === 'assistant' && message.role === 'assistant'
    const adjacentToolResults = previous?.role === 'user' && message.role === 'user' &&
      previous.content.every(part => part.type === 'function_output') &&
      message.content.every(part => part.type === 'function_output')
    if (adjacentAssistantTurn || adjacentToolResults) previous!.content.push(...message.content)
    else merged.push(message)
    return merged
  }, [])
}

const normalize = (request: JsonObject): NormalizedRequest => {
  const normalizedKeys = new Set([
    'include',
    'input',
    'instructions',
    'max_output_tokens',
    'model',
    'parallel_tool_calls',
    'reasoning',
    'store',
    'stream',
    'temperature',
    'text',
    'tool_choice',
    'tools',
    'top_p'
  ])
  const chatControlKeys = new Set(['metadata', 'prompt_cache_key', 'safety_identifier', 'service_tier', 'user'])
  const unsupportedControls = Object.keys(request).filter(key => !normalizedKeys.has(key) && !chatControlKeys.has(key))
  const chatControls: JsonObject = {}
  for (const key of chatControlKeys) {
    const value = request[key]
    if (value !== undefined) chatControls[key] = copy(value)
  }
  if (request.include !== undefined) {
    const includes = asArray(request.include)
    if (includes.some(value => value !== 'reasoning.encrypted_content')) {
      unsupportedControls.push('include')
    }
  }
  const tools = asArray(request.tools).map((tool) => {
    if (!isJsonObject(tool) || asString(tool.type) !== 'function') {
      throw new UnsupportedProtocolFeatureError('non-function Responses tool')
    }
    if (!asString(tool.name)) throw new UnsupportedProtocolFeatureError('function tool without name')
    return copy(tool)
  })
  const reasoning = isJsonObject(request.reasoning) ? request.reasoning : undefined
  if (request.reasoning !== undefined && reasoning == null) unsupportedControls.push('reasoning')
  else if (reasoning) {
    for (const key of Object.keys(reasoning)) {
      if (key !== 'effort' && key !== 'summary') unsupportedControls.push(`reasoning.${key}`)
    }
  }
  const text = isJsonObject(request.text) ? request.text : undefined
  if (request.text !== undefined && text == null) unsupportedControls.push('text')
  else if (text) {
    for (const key of Object.keys(text)) {
      if (key !== 'format' && key !== 'verbosity') unsupportedControls.push(`text.${key}`)
    }
  }
  const format = text && isJsonObject(text.format) ? text.format : undefined
  if (text?.format !== undefined && format == null) unsupportedControls.push('text.format')
  else if (format) {
    for (const key of Object.keys(format)) {
      if (!['description', 'name', 'schema', 'strict', 'type'].includes(key)) {
        unsupportedControls.push(`text.format.${key}`)
      }
    }
  }
  if (format && asString(format.type) !== 'json_schema') {
    throw new UnsupportedProtocolFeatureError(`text format ${asString(format.type) ?? 'missing'}`)
  }
  const textVerbosity = text?.verbosity
  if (textVerbosity !== undefined && !['low', 'medium', 'high'].includes(asString(textVerbosity) ?? '')) {
    throw new UnsupportedProtocolFeatureError('text.verbosity')
  }
  return {
    model: asString(request.model),
    instructions: asString(request.instructions),
    messages: responseInputToMessages(request.input),
    tools,
    toolChoice: request.tool_choice,
    maxOutputTokens: asNumber(request.max_output_tokens),
    reasoningEffort: reasoning ? asString(reasoning.effort) : undefined,
    reasoningSummary: reasoning ? asString(reasoning.summary) : undefined,
    textFormat: format ? copy(format) : undefined,
    textVerbosity: asString(textVerbosity) as NormalizedRequest['textVerbosity'],
    stream: request.stream === true,
    store: Object.prototype.hasOwnProperty.call(request, 'store') && typeof request.store === 'boolean'
      ? request.store
      : undefined,
    parallelToolCalls: typeof request.parallel_tool_calls === 'boolean' ? request.parallel_tool_calls : undefined,
    temperature: asNumber(request.temperature),
    topP: asNumber(request.top_p),
    chatControls,
    unsupportedControls
  }
}

const assertRequestControlsSupported = (source: NormalizedRequest, target: ModelServiceApiProtocol) => {
  if (source.unsupportedControls.length > 0) {
    throw new UnsupportedProtocolFeatureError(
      `Responses request controls: ${Array.from(new Set(source.unsupportedControls)).sort().join(', ')}`,
      target
    )
  }
  if (target === 'openai-chat-completions') return
  if (Object.keys(source.chatControls).length > 0) {
    throw new UnsupportedProtocolFeatureError(
      `Responses request controls: ${Object.keys(source.chatControls).sort().join(', ')}`,
      target
    )
  }
  if (source.store !== undefined) throw new UnsupportedProtocolFeatureError('store retention control', target)
  if (source.parallelToolCalls !== undefined) {
    throw new UnsupportedProtocolFeatureError('parallel_tool_calls control', target)
  }
  if (source.tools.some(tool => tool.strict === true)) {
    throw new UnsupportedProtocolFeatureError('strict function tool schema', target)
  }
  if (source.textVerbosity !== undefined) throw new UnsupportedProtocolFeatureError('text.verbosity', target)
}

const chatMessage = (message: NormalizedMessage): JsonObject => {
  if (message.content.some(part => part.type === 'reasoning')) {
    throw new UnsupportedProtocolFeatureError('signed reasoning replay', 'openai-chat-completions')
  }
  const text = message.content.filter((part) => part.type === 'text').map((part) => part.text).join('')
  const images = message.content.filter((part): part is Extract<NormalizedPart, { type: 'image' }> =>
    part.type === 'image'
  )
  const calls = message.content.filter((part): part is Extract<NormalizedPart, { type: 'function_call' }> =>
    part.type === 'function_call'
  )
  const outputs = message.content.filter((part): part is Extract<NormalizedPart, { type: 'function_output' }> =>
    part.type === 'function_output'
  )
  if (outputs.length) {
    if (message.role !== 'user' || message.content.length !== outputs.length) {
      throw new UnsupportedProtocolFeatureError('mixed function-call output message')
    }
    throw new UnsupportedProtocolFeatureError('function-call output expansion', 'openai-chat-completions')
  }
  if (calls.length) {
    if (message.role !== 'assistant' || images.length) {
      throw new UnsupportedProtocolFeatureError('mixed assistant function-call message')
    }
    return {
      role: 'assistant',
      content: text || null,
      tool_calls: calls.map((call, index) => ({
        id: call.callId,
        type: 'function',
        function: { name: call.name, arguments: call.arguments },
        index
      }))
    }
  }
  if (!images.length) return { role: message.role, content: text }
  return {
    role: message.role,
    content: [
      ...(text ? [{ type: 'text', text }] : []),
      ...images.map((image) => ({ type: 'image_url', image_url: { url: image.url } }))
    ]
  }
}

const toChat = (source: NormalizedRequest): JsonObject => {
  const messages = source.messages.flatMap((message) => {
    const outputs = message.content.filter((part): part is Extract<NormalizedPart, { type: 'function_output' }> =>
      part.type === 'function_output'
    )
    if (outputs.length === 0) return [chatMessage(message)]
    if (message.role !== 'user' || message.content.length !== outputs.length) {
      throw new UnsupportedProtocolFeatureError('mixed function-call output message')
    }
    return outputs.map(output => ({ role: 'tool', tool_call_id: output.callId, content: output.output }))
  })
  if (source.instructions) messages.unshift({ role: 'system', content: source.instructions })
  const result: JsonObject = { ...source.chatControls, messages, stream: source.stream }
  if (source.model) result.model = source.model
  if (source.maxOutputTokens !== undefined) result.max_tokens = source.maxOutputTokens
  if (source.reasoningEffort) result.reasoning_effort = source.reasoningEffort
  if (source.tools.length) {
    result.tools = source.tools.map((tool) => ({
      type: 'function',
      function: { name: tool.name, description: tool.description, parameters: tool.parameters, strict: tool.strict }
    }))
  }
  if (source.toolChoice !== undefined) result.tool_choice = chatToolChoice(source.toolChoice)
  if (source.store !== undefined) result.store = source.store
  if (source.parallelToolCalls !== undefined) result.parallel_tool_calls = source.parallelToolCalls
  if (source.temperature !== undefined) result.temperature = source.temperature
  if (source.topP !== undefined) result.top_p = source.topP
  if (source.textVerbosity !== undefined) result.verbosity = source.textVerbosity
  if (source.stream) result.stream_options = { include_usage: true }
  if (source.textFormat) {
    result.response_format = {
      type: 'json_schema',
      json_schema: {
        name: asString(source.textFormat.name) ?? 'response',
        description: source.textFormat.description,
        schema: source.textFormat.schema ?? {},
        strict: source.textFormat.strict === true
      }
    }
  }
  return result
}

const chatToolChoice = (choice: JsonValue): JsonValue => {
  if (typeof choice === 'string') {
    if (['auto', 'none', 'required'].includes(choice)) return choice
    throw new UnsupportedProtocolFeatureError(`tool choice ${choice}`, 'openai-chat-completions')
  }
  if (isJsonObject(choice) && asString(choice.type) === 'function' && asString(choice.name)) {
    return { type: 'function', function: { name: asString(choice.name)! } }
  }
  throw new UnsupportedProtocolFeatureError('tool choice', 'openai-chat-completions')
}

const anthropicContent = (message: NormalizedMessage): JsonValue[] =>
  message.content.map((part): JsonValue => {
    if (part.type === 'text') return { type: 'text', text: part.text }
    if (part.type === 'function_call') {
      return { type: 'tool_use', id: part.callId, name: part.name, input: parseArguments(part.arguments) }
    }
    if (part.type === 'function_output') {
      return { type: 'tool_result', tool_use_id: part.callId, content: part.output }
    }
    if (part.type === 'reasoning') {
      if (part.provider !== 'anthropic') {
        throw new UnsupportedProtocolFeatureError('Gemini reasoning replay', 'anthropic-messages')
      }
      return { type: 'thinking', thinking: part.text, signature: part.signature }
    }
    const dataUrl = /^data:([^;,]+);base64,(.+)$/s.exec(part.url)
    if (dataUrl) {
      return { type: 'image', source: { type: 'base64', media_type: dataUrl[1], data: dataUrl[2] } }
    }
    return { type: 'image', source: { type: 'url', url: part.url } }
  })

const toAnthropic = (source: NormalizedRequest): JsonObject => {
  const messages = source.messages
    .filter((message) => message.role !== 'system' && message.role !== 'developer')
    .map((message) => ({ role: message.role, content: anthropicContent(message) }))
  const system = [
    source.instructions,
    ...source.messages.filter((message) => message.role === 'system' || message.role === 'developer').flatMap((
      message
    ) =>
      message.content.filter((part): part is Extract<NormalizedPart, { type: 'text' }> => part.type === 'text').map((
        part
      ) => part.text)
    )
  ].filter(Boolean).join('\n\n')
  const maxTokens = source.maxOutputTokens ?? 4096
  const result: JsonObject = { messages, stream: source.stream, max_tokens: maxTokens }
  if (source.model) result.model = source.model
  if (source.temperature !== undefined) result.temperature = source.temperature
  if (source.topP !== undefined) result.top_p = source.topP
  if (system) result.system = system
  if (source.tools.length) {
    result.tools = source.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters ?? { type: 'object', properties: {} }
    }))
  }
  if (source.toolChoice !== undefined) result.tool_choice = anthropicToolChoice(source.toolChoice)
  if (source.textFormat) {
    result.output_config = { format: { type: 'json_schema', schema: source.textFormat.schema ?? {} } }
  }
  if (source.reasoningEffort && source.reasoningEffort !== 'none') {
    const budgetTokens = reasoningBudget(source.reasoningEffort)
    if (budgetTokens >= maxTokens) {
      throw new UnsupportedProtocolFeatureError(
        'Anthropic reasoning budget greater than or equal to max_output_tokens',
        'anthropic-messages'
      )
    }
    result.thinking = { type: 'enabled', budget_tokens: budgetTokens }
    if (source.toolChoice !== undefined && source.toolChoice !== 'auto' && source.toolChoice !== 'none') {
      throw new UnsupportedProtocolFeatureError(
        'forced tool choice with Anthropic extended thinking',
        'anthropic-messages'
      )
    }
  }
  return result
}

const anthropicToolChoice = (choice: JsonValue): JsonValue => {
  if (choice === 'auto') return { type: 'auto' }
  if (choice === 'required') return { type: 'any' }
  if (choice === 'none') throw new UnsupportedProtocolFeatureError('tool_choice none', 'anthropic-messages')
  if (isJsonObject(choice) && asString(choice.type) === 'function' && asString(choice.name)) {
    return { type: 'tool', name: asString(choice.name)! }
  }
  throw new UnsupportedProtocolFeatureError('tool choice', 'anthropic-messages')
}

const geminiParts = (message: NormalizedMessage): JsonValue[] => {
  let pendingReasoning: Extract<NormalizedPart, { type: 'reasoning' }> | undefined
  return message.content.flatMap((part): JsonValue[] => {
    if (part.type === 'reasoning') {
      if (part.provider !== 'gemini') {
        throw new UnsupportedProtocolFeatureError('Anthropic reasoning replay', 'gemini-generate-content')
      }
      if (part.text) {
        pendingReasoning = undefined
        return [{ text: part.text, thought: true, thoughtSignature: part.signature }]
      }
      pendingReasoning = part
      return []
    }
    const thoughtSignature = pendingReasoning?.signature
    pendingReasoning = undefined
    if (part.type === 'text') return [{ text: part.text, ...(thoughtSignature ? { thoughtSignature } : {}) }]
    if (part.type === 'function_call') {
      return [{
        functionCall: { name: part.name, args: parseArguments(part.arguments), id: part.callId },
        ...(thoughtSignature ? { thoughtSignature } : {})
      }]
    }
    if (part.type === 'function_output') {
      return [{ functionResponse: { id: part.callId, name: part.name, response: { output: part.output } } }]
    }
    const dataUrl = /^data:([^;,]+);base64,(.+)$/s.exec(part.url)
    if (dataUrl) return [{ inlineData: { mimeType: dataUrl[1], data: dataUrl[2] } }]
    return [{ fileData: { mimeType: 'image/*', fileUri: part.url } }]
  })
}

const toGemini = (source: NormalizedRequest): JsonObject => {
  const systemParts: JsonValue[] = []
  if (source.instructions) systemParts.push({ text: source.instructions })
  const contents = source.messages.flatMap((message) => {
    if (message.role === 'system' || message.role === 'developer') {
      systemParts.push(...geminiParts(message))
      return []
    }
    return [{ role: message.role === 'assistant' ? 'model' : 'user', parts: geminiParts(message) }]
  })
  const generationConfig: JsonObject = {}
  if (source.maxOutputTokens !== undefined) generationConfig.maxOutputTokens = source.maxOutputTokens
  if (source.temperature !== undefined) generationConfig.temperature = source.temperature
  if (source.topP !== undefined) generationConfig.topP = source.topP
  if (source.textFormat) {
    generationConfig.responseMimeType = 'application/json'
    generationConfig.responseJsonSchema = source.textFormat.schema ?? {}
  }
  if (source.reasoningEffort) {
    const thinkingBudget = reasoningBudget(source.reasoningEffort)
    if (thinkingBudget > 0) {
      generationConfig.thinkingConfig = {
        includeThoughts: source.reasoningSummary !== 'none',
        thinkingBudget
      }
    }
  }
  const result: JsonObject = { contents, generationConfig }
  if (systemParts.length) result.systemInstruction = { parts: systemParts }
  if (source.tools.length) {
    result.tools = [{
      functionDeclarations: source.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parametersJsonSchema: tool.parameters ?? { type: 'object', properties: {} }
      }))
    }]
  }
  if (source.toolChoice !== undefined) {
    result.toolConfig = { functionCallingConfig: geminiToolChoice(source.toolChoice) }
  }
  return result
}

const geminiToolChoice = (choice: JsonValue): JsonValue => {
  if (choice === 'auto') return { mode: 'AUTO' }
  if (choice === 'required') return { mode: 'ANY' }
  if (choice === 'none') return { mode: 'NONE' }
  if (isJsonObject(choice) && asString(choice.type) === 'function' && asString(choice.name)) {
    return { mode: 'ANY', allowedFunctionNames: [asString(choice.name)!] }
  }
  throw new UnsupportedProtocolFeatureError('tool choice', 'gemini-generate-content')
}

export const translateResponsesRequest = ({ target, request }: TranslateResponsesRequestOptions): JsonObject => {
  if (target === 'openai-responses') return copy(request)
  const source = normalize(request)
  assertRequestControlsSupported(source, target)
  if (target === 'openai-chat-completions') return toChat(source)
  if (target === 'anthropic-messages') return toAnthropic(source)
  if (target === 'gemini-generate-content') return toGemini(source)
  throw new UnsupportedProtocolFeatureError('Gemini Interactions conversion', target)
}

const parseArguments = (args: string): JsonObject => {
  try {
    const parsed: unknown = JSON.parse(args)
    if (isJsonObject(parsed)) return parsed
  } catch {}
  throw new UnsupportedProtocolFeatureError('non-object function arguments')
}

const reasoningBudget = (effort: string) => {
  const budget = ({
    none: 0,
    minimal: 1024,
    low: 1024,
    medium: 1024,
    high: 2048,
    xhigh: 4096,
    max: 4096
  } as Record<string, number>)[effort]
  if (budget == null) throw new UnsupportedProtocolFeatureError(`reasoning effort ${effort}`)
  return budget
}
const responseId = (value?: string) => value?.startsWith('resp_') ? value : `resp_${value ?? crypto.randomUUID()}`
const usage = (
  input: number | undefined,
  output: number | undefined,
  total?: number,
  inputDetails?: JsonObject,
  outputDetails?: JsonObject
): JsonObject | undefined =>
  input === undefined && output === undefined
    ? undefined
    : {
      input_tokens: input ?? 0,
      output_tokens: output ?? 0,
      total_tokens: total ?? (input ?? 0) + (output ?? 0),
      ...(inputDetails ? { input_tokens_details: inputDetails } : {}),
      ...(outputDetails ? { output_tokens_details: outputDetails } : {})
    }
const terminalResponse = (
  id: string,
  output: JsonValue[],
  usageValue: JsonObject | undefined,
  status: 'completed' | 'incomplete' | 'failed' = 'completed',
  detail?: string
): JsonObject => {
  const projectedOutput = status === 'completed'
    ? output
    : output.map(item => isJsonObject(item) && typeof item.status === 'string' ? { ...item, status } : item)
  return {
    id,
    object: 'response',
    status,
    output: projectedOutput,
    ...(status === 'incomplete' ? { incomplete_details: { reason: detail ?? 'max_output_tokens' } } : {}),
    ...(status === 'failed'
      ? { error: { code: 'upstream_safety_or_protocol_stop', message: detail ?? 'Upstream generation failed.' } }
      : {}),
    ...(usageValue ? { usage: usageValue } : {})
  }
}

const reasoningOutput = (
  id: string,
  text: string,
  carrier?: ReasoningCarrier,
  includeSummary = true
): JsonObject => ({
  id: `rs_${id}`,
  type: 'reasoning',
  status: 'completed',
  summary: includeSummary && text ? [{ type: 'summary_text', text }] : [],
  ...(carrier ? { encrypted_content: encodeReasoningCarrier(carrier) } : {})
})

const chatResponse = (response: JsonObject, id: string, includeReasoningSummary = true): JsonObject => {
  const choices = asArray(response.choices)
  if (choices.length !== 1) throw new UnsupportedProtocolFeatureError('Chat response choice count')
  const choice = choices[0]
  if (!isJsonObject(choice) || !isJsonObject(choice.message)) {
    throw new UnsupportedProtocolFeatureError('Chat response without choice message')
  }
  const message = choice.message
  const output: JsonValue[] = []
  const reasoningContent = asString(message.reasoning_content)
  if (reasoningContent !== undefined) {
    output.push(reasoningOutput(id, reasoningContent, undefined, includeReasoningSummary))
  }
  const messageContent = asString(message.content)
  if (message.content != null && messageContent === undefined) {
    throw new UnsupportedProtocolFeatureError('Chat response content shape')
  }
  if (messageContent) {
    output.push({
      id: `msg_${id}`,
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: messageContent }]
    })
  }
  const finishReason = asString(choice.finish_reason)
  const status = finishReason == null || finishReason === 'stop' || finishReason === 'tool_calls'
    ? 'completed'
    : finishReason === 'length'
    ? 'incomplete'
    : 'failed'
  const calls = asArray(message.tool_calls)
  calls.forEach((raw, index) => {
    if (!isJsonObject(raw) || !isJsonObject(raw.function) || !asString(raw.function.name)) {
      throw new UnsupportedProtocolFeatureError('Chat tool call')
    }
    const argumentsValue = asString(raw.function.arguments) ?? ''
    if (status === 'completed') parseArguments(argumentsValue)
    output.push({
      type: 'function_call',
      id: asString(raw.id) ?? `fc_${index}`,
      call_id: asString(raw.id) ?? `call_${index}`,
      name: asString(raw.function.name)!,
      arguments: argumentsValue,
      status
    })
  })
  const rawUsage = isJsonObject(response.usage) ? response.usage : undefined
  const promptDetails = isJsonObject(rawUsage?.prompt_tokens_details) ? rawUsage.prompt_tokens_details : undefined
  const completionDetails = isJsonObject(rawUsage?.completion_tokens_details)
    ? rawUsage.completion_tokens_details
    : undefined
  return terminalResponse(
    id,
    output,
    usage(
      asNumber(rawUsage?.prompt_tokens),
      asNumber(rawUsage?.completion_tokens),
      asNumber(rawUsage?.total_tokens),
      promptDetails && asNumber(promptDetails.cached_tokens) !== undefined
        ? { cached_tokens: asNumber(promptDetails.cached_tokens)! }
        : undefined,
      completionDetails && asNumber(completionDetails.reasoning_tokens) !== undefined
        ? { reasoning_tokens: asNumber(completionDetails.reasoning_tokens)! }
        : undefined
    ),
    status,
    finishReason
  )
}

const anthropicResponse = (response: JsonObject, id: string): JsonObject => {
  const output: JsonValue[] = []
  const textContent: JsonValue[] = []
  const reasoningContent: string[] = []
  let reasoningSignature: string | undefined
  asArray(response.content).forEach((raw, index) => {
    if (!isJsonObject(raw)) throw new UnsupportedProtocolFeatureError('Anthropic content block')
    if (raw.type === 'text') {
      const text = asString(raw.text)
      if (text == null) throw new UnsupportedProtocolFeatureError('Anthropic text block without text')
      textContent.push({ type: 'output_text', text })
    } else if (raw.type === 'thinking') {
      const thinking = asString(raw.thinking)
      const signature = asString(raw.signature)
      if (thinking == null || signature == null) {
        throw new UnsupportedProtocolFeatureError('Anthropic thinking block without thinking or signature')
      }
      reasoningContent.push(thinking)
      reasoningSignature = signature
    } else if (raw.type === 'tool_use') {
      const toolId = asString(raw.id)
      const toolName = asString(raw.name)
      if (toolId == null || toolName == null || !isJsonObject(raw.input)) {
        throw new UnsupportedProtocolFeatureError('Anthropic tool_use without id, name, or object input')
      }
      output.push({
        type: 'function_call',
        id: toolId,
        call_id: toolId,
        name: toolName,
        arguments: JSON.stringify(raw.input),
        status: 'completed'
      })
    } else throw new UnsupportedProtocolFeatureError(`Anthropic content ${asString(raw.type) ?? 'missing'}`)
  })
  if (textContent.length > 0) {
    output.unshift({ id: `msg_${id}`, type: 'message', role: 'assistant', status: 'completed', content: textContent })
  }
  if (reasoningContent.length > 0 || reasoningSignature) {
    const text = reasoningContent.join('')
    output.unshift(reasoningOutput(
      id,
      text,
      reasoningSignature ? { provider: 'anthropic', signature: reasoningSignature, text } : undefined
    ))
  }
  const rawUsage = isJsonObject(response.usage) ? response.usage : undefined
  const stopReason = asString(response.stop_reason)
  const status =
    stopReason == null || stopReason === 'end_turn' || stopReason === 'stop_sequence' || stopReason === 'tool_use'
      ? 'completed'
      : stopReason === 'max_tokens'
      ? 'incomplete'
      : 'failed'
  const baseInputTokens = asNumber(rawUsage?.input_tokens) ?? 0
  const cacheCreationTokens = asNumber(rawUsage?.cache_creation_input_tokens) ?? 0
  const cacheReadTokens = asNumber(rawUsage?.cache_read_input_tokens) ?? 0
  return terminalResponse(
    id,
    output,
    usage(
      baseInputTokens + cacheCreationTokens + cacheReadTokens,
      asNumber(rawUsage?.output_tokens),
      undefined,
      cacheCreationTokens > 0 || cacheReadTokens > 0
        ? { cached_tokens: cacheReadTokens, cache_creation_tokens: cacheCreationTokens }
        : undefined
    ),
    status,
    stopReason
  )
}

const geminiResponse = (response: JsonObject, id: string): JsonObject => {
  const candidate = asArray(response.candidates)[0]
  const promptFeedback = isJsonObject(response.promptFeedback) ? response.promptFeedback : undefined
  const blockReason = asString(promptFeedback?.blockReason)
  const output: JsonValue[] = []
  const textContent: JsonValue[] = []
  const reasoningContent: string[] = []
  let reasoningSignature: string | undefined
  let visibleSignature: string | undefined
  if (isJsonObject(candidate) && isJsonObject(candidate.content)) {
    asArray(candidate.content.parts).forEach((raw, index) => {
      if (!isJsonObject(raw)) throw new UnsupportedProtocolFeatureError('Gemini part')
      const thoughtSignature = asString(raw.thoughtSignature) ?? asString(raw.thought_signature)
      if (asString(raw.text) !== undefined && raw.thought === true) {
        reasoningContent.push(asString(raw.text)!)
        reasoningSignature = thoughtSignature ?? reasoningSignature
      } else if (asString(raw.text) !== undefined) {
        textContent.push({ type: 'output_text', text: asString(raw.text)! })
        visibleSignature = thoughtSignature ?? visibleSignature
      } else if (isJsonObject(raw.functionCall) && asString(raw.functionCall.name)) {
        const args = raw.functionCall.args ?? {}
        if (!isJsonObject(args)) {
          throw new UnsupportedProtocolFeatureError('Gemini functionCall without object args')
        }
        if (thoughtSignature) {
          output.push(reasoningOutput(
            `${id}_tool_${index}`,
            '',
            { provider: 'gemini', signature: thoughtSignature, text: '' },
            false
          ))
        }
        output.push({
          type: 'function_call',
          id: asString(raw.functionCall.id) ?? `fc_${index}`,
          call_id: asString(raw.functionCall.id) ?? `call_${index}`,
          name: asString(raw.functionCall.name)!,
          arguments: JSON.stringify(args),
          status: 'completed'
        })
      } else throw new UnsupportedProtocolFeatureError('Gemini response part')
    })
  }
  const prefix: JsonValue[] = []
  if (reasoningContent.length > 0 || reasoningSignature) {
    const text = reasoningContent.join('')
    prefix.push(reasoningOutput(
      id,
      text,
      reasoningSignature ? { provider: 'gemini', signature: reasoningSignature, text } : undefined
    ))
  }
  if (visibleSignature) {
    prefix.push(reasoningOutput(
      `${id}_visible`,
      '',
      { provider: 'gemini', signature: visibleSignature, text: '' },
      false
    ))
  }
  if (textContent.length > 0) {
    prefix.push({ id: `msg_${id}`, type: 'message', role: 'assistant', status: 'completed', content: textContent })
  }
  output.unshift(...prefix)
  const rawUsage = isJsonObject(response.usageMetadata) ? response.usageMetadata : undefined
  const candidates = asNumber(rawUsage?.candidatesTokenCount)
  const thoughts = asNumber(rawUsage?.thoughtsTokenCount) ?? 0
  const finishReason = isJsonObject(candidate) ? asString(candidate.finishReason) : undefined
  const hasUsableContent = isJsonObject(candidate) && isJsonObject(candidate.content) &&
    asArray(candidate.content.parts).length > 0
  const status = blockReason != null || !hasUsableContent
    ? 'failed'
    : finishReason === 'MAX_TOKENS'
    ? 'incomplete'
    : finishReason != null && finishReason !== 'STOP'
    ? 'failed'
    : 'completed'
  return terminalResponse(
    id,
    output,
    usage(
      asNumber(rawUsage?.promptTokenCount),
      candidates == null ? (thoughts || undefined) : candidates + thoughts,
      asNumber(rawUsage?.totalTokenCount),
      asNumber(rawUsage?.cachedContentTokenCount) !== undefined
        ? { cached_tokens: asNumber(rawUsage?.cachedContentTokenCount)! }
        : undefined,
      thoughts > 0 ? { reasoning_tokens: thoughts } : undefined
    ),
    status,
    blockReason ?? finishReason ?? (!hasUsableContent ? 'Gemini returned no usable candidate content.' : undefined)
  )
}

export const translateResponseToResponses = (
  { source, response, requestId, reasoningSummary }: TranslateResponseOptions
): JsonObject => {
  if (source === 'openai-responses') return copy(response)
  const id = responseId(requestId ?? asString(response.id))
  if (source === 'openai-chat-completions') return chatResponse(response, id, reasoningSummary !== 'none')
  if (source === 'anthropic-messages') {
    const translated = anthropicResponse(response, id)
    if (reasoningSummary === 'none') {
      for (const item of asArray(translated.output)) {
        if (isJsonObject(item) && item.type === 'reasoning') item.summary = []
      }
    }
    return translated
  }
  if (source === 'gemini-generate-content') {
    const translated = geminiResponse(response, id)
    if (reasoningSummary === 'none') {
      for (const item of asArray(translated.output)) {
        if (isJsonObject(item) && item.type === 'reasoning') item.summary = []
      }
    }
    return translated
  }
  throw new UnsupportedProtocolFeatureError('Gemini Interactions conversion', source)
}
