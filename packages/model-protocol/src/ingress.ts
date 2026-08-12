/* eslint-disable max-lines -- the ingress star keeps call-id and content semantics auditable together. */
import { UnsupportedProtocolFeatureError, asArray, asNumber, asString, isJsonObject } from './protocol.js'
import type { JsonObject, JsonValue, ModelServiceApiProtocol } from './protocol.js'

type IngressProtocol = Exclude<ModelServiceApiProtocol, 'openai-responses' | 'gemini-interactions'>

export interface TranslateRequestToResponsesOptions {
  source: IngressProtocol
  request: JsonObject
}

export interface TranslateResponsesToResponseOptions {
  target: IngressProtocol
  response: JsonObject
  model?: string
}

const copy = <T extends JsonValue>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const requireObject = (value: JsonValue | undefined, feature: string) => {
  if (!isJsonObject(value)) throw new UnsupportedProtocolFeatureError(feature)
  return value
}

const requireString = (value: JsonValue | undefined, feature: string) => {
  const normalized = asString(value)
  if (normalized == null || normalized === '') throw new UnsupportedProtocolFeatureError(feature)
  return normalized
}

const appendMessage = (
  input: JsonValue[],
  role: 'developer' | 'user' | 'assistant',
  content: JsonValue[]
) => {
  if (content.length === 0) return
  input.push({ type: 'message', role, content })
}

const chatContent = (
  value: JsonValue | undefined,
  role: 'developer' | 'user' | 'assistant'
): JsonValue[] => {
  if (value == null) return []
  const textType = role === 'assistant' ? 'output_text' : 'input_text'
  if (typeof value === 'string') return value === '' ? [] : [{ type: textType, text: value }]
  return asArray(value).map((part) => {
    const item = requireObject(part, 'Chat message content item')
    const type = asString(item.type)
    if (type === 'text') return { type: textType, text: requireString(item.text, 'Chat text content') }
    if (type === 'image_url' && role === 'user') {
      const imageUrl = requireObject(item.image_url, 'Chat image_url content')
      return { type: 'input_image', image_url: requireString(imageUrl.url, 'Chat image URL') }
    }
    throw new UnsupportedProtocolFeatureError(`Chat content type ${type ?? 'missing'}`)
  })
}

const chatRequestToResponses = (request: JsonObject): JsonObject => {
  const supported = new Set([
    'messages',
    'max_completion_tokens',
    'max_tokens',
    'model',
    'parallel_tool_calls',
    'reasoning',
    'reasoning_effort',
    'response_format',
    'stream',
    'stream_options',
    'tool_choice',
    'tools'
  ])
  const unsupported = Object.keys(request).filter(key => !supported.has(key))
  if (unsupported.length > 0) {
    throw new UnsupportedProtocolFeatureError(`Chat request controls: ${unsupported.sort().join(', ')}`)
  }

  const input: JsonValue[] = []
  const pendingCalls = new Map<string, string>()
  for (const rawMessage of asArray(request.messages)) {
    const message = requireObject(rawMessage, 'Chat message')
    const role = requireString(message.role, 'Chat message role')
    if (role === 'tool') {
      const callId = requireString(message.tool_call_id, 'Chat tool_call_id')
      if (!pendingCalls.has(callId)) throw new UnsupportedProtocolFeatureError('orphan Chat tool result')
      input.push({
        type: 'function_call_output',
        call_id: callId,
        output: requireString(message.content, 'Chat tool output')
      })
      pendingCalls.delete(callId)
      continue
    }
    if (role !== 'system' && role !== 'developer' && role !== 'user' && role !== 'assistant') {
      throw new UnsupportedProtocolFeatureError(`Chat message role ${role}`)
    }
    const responseRole = role === 'system' ? 'developer' : role
    appendMessage(input, responseRole, chatContent(message.content, responseRole))
    if (role !== 'assistant') continue
    for (const rawCall of asArray(message.tool_calls)) {
      const call = requireObject(rawCall, 'Chat tool call')
      if (asString(call.type) !== 'function') throw new UnsupportedProtocolFeatureError('non-function Chat tool call')
      const fn = requireObject(call.function, 'Chat function call')
      const callId = requireString(call.id, 'Chat function call id')
      if (pendingCalls.has(callId)) throw new UnsupportedProtocolFeatureError('duplicate Chat function call id')
      const name = requireString(fn.name, 'Chat function call name')
      input.push({
        type: 'function_call',
        call_id: callId,
        name,
        arguments: asString(fn.arguments) ?? ''
      })
      pendingCalls.set(callId, name)
    }
  }

  const tools = asArray(request.tools).map((rawTool) => {
    const tool = requireObject(rawTool, 'Chat tool')
    if (asString(tool.type) !== 'function') throw new UnsupportedProtocolFeatureError('non-function Chat tool')
    const fn = requireObject(tool.function, 'Chat function tool')
    return {
      type: 'function',
      name: requireString(fn.name, 'Chat function tool name'),
      ...(asString(fn.description) == null ? {} : { description: asString(fn.description) }),
      parameters: isJsonObject(fn.parameters) ? copy(fn.parameters) : { type: 'object', properties: {} },
      ...(typeof fn.strict === 'boolean' ? { strict: fn.strict } : {})
    }
  })
  const responseFormat = isJsonObject(request.response_format) ? request.response_format : undefined
  const text = responseFormat?.type === 'json_schema'
    ? {
      format: {
        type: 'json_schema',
        ...copy(requireObject(responseFormat.json_schema, 'Chat response_format.json_schema'))
      }
    }
    : responseFormat == null || responseFormat.type === 'text'
    ? undefined
    : (() => {
      throw new UnsupportedProtocolFeatureError(`Chat response format ${String(responseFormat.type)}`)
    })()
  const toolChoice = request.tool_choice
  const maxOutputTokens = asNumber(request.max_completion_tokens) ?? asNumber(request.max_tokens)
  const reasoning = isJsonObject(request.reasoning) ? request.reasoning : undefined
  if (request.reasoning !== undefined && reasoning == null) {
    throw new UnsupportedProtocolFeatureError('Chat reasoning control')
  }
  if (reasoning?.enabled !== undefined && typeof reasoning.enabled !== 'boolean') {
    throw new UnsupportedProtocolFeatureError('Chat reasoning enabled control')
  }
  const unsupportedReasoningControls = reasoning == null
    ? []
    : Object.keys(reasoning).filter(key => key !== 'effort' && key !== 'enabled')
  if (unsupportedReasoningControls.length > 0) {
    throw new UnsupportedProtocolFeatureError(
      `Chat reasoning controls: ${unsupportedReasoningControls.sort().join(', ')}`
    )
  }
  const reasoningEffort = reasoning?.enabled === false
    ? undefined
    : asString(request.reasoning_effort) ?? asString(reasoning?.effort)
  const normalizedToolChoice = isJsonObject(toolChoice) && toolChoice.type === 'function'
    ? {
      type: 'function',
      name: requireString(requireObject(toolChoice.function, 'Chat tool choice function').name, 'Chat tool choice name')
    }
    : toolChoice

  return {
    model: asString(request.model),
    input,
    stream: request.stream === true,
    ...(tools.length === 0 ? {} : { tools }),
    ...(normalizedToolChoice === undefined ? {} : { tool_choice: copy(normalizedToolChoice) }),
    ...(typeof request.parallel_tool_calls === 'boolean'
      ? { parallel_tool_calls: request.parallel_tool_calls }
      : {}),
    ...(reasoningEffort == null
      ? {}
      : { reasoning: { effort: reasoningEffort } }),
    ...(maxOutputTokens == null ? {} : { max_output_tokens: maxOutputTokens }),
    ...(text == null ? {} : { text })
  }
}

const anthropicContentToResponses = (content: JsonValue | undefined, role: 'user' | 'assistant') => {
  const input: JsonValue[] = []
  const messageParts: JsonValue[] = []
  const flushMessage = () => {
    appendMessage(input, role, messageParts.splice(0))
  }
  for (const rawPart of typeof content === 'string' ? [{ type: 'text', text: content }] : asArray(content)) {
    const part = requireObject(rawPart, 'Anthropic content block')
    const type = asString(part.type)
    if (type === 'text') {
      messageParts.push({
        type: role === 'assistant' ? 'output_text' : 'input_text',
        text: requireString(part.text, 'Anthropic text')
      })
      continue
    }
    if (type === 'image' && role === 'user') {
      const source = requireObject(part.source, 'Anthropic image source')
      if (source.type !== 'base64') throw new UnsupportedProtocolFeatureError('non-base64 Anthropic image')
      messageParts.push({
        type: 'input_image',
        image_url: `data:${requireString(source.media_type, 'Anthropic image media type')};base64,${
          requireString(source.data, 'Anthropic image data')
        }`
      })
      continue
    }
    if (type === 'tool_use' && role === 'assistant') {
      flushMessage()
      input.push({
        type: 'function_call',
        call_id: requireString(part.id, 'Anthropic tool_use id'),
        name: requireString(part.name, 'Anthropic tool_use name'),
        arguments: JSON.stringify(requireObject(part.input, 'Anthropic tool_use input'))
      })
      continue
    }
    if (type === 'tool_result' && role === 'user') {
      flushMessage()
      input.push({
        type: 'function_call_output',
        call_id: requireString(part.tool_use_id, 'Anthropic tool_result id'),
        output: typeof part.content === 'string' ? part.content : JSON.stringify(part.content ?? '')
      })
      continue
    }
    throw new UnsupportedProtocolFeatureError(`Anthropic content type ${type ?? 'missing'}`)
  }
  flushMessage()
  return input
}

const anthropicRequestToResponses = (request: JsonObject): JsonObject => {
  const supported = new Set([
    'max_tokens',
    'messages',
    'model',
    'stream',
    'system',
    'thinking',
    'tool_choice',
    'tools'
  ])
  const unsupported = Object.keys(request).filter(key => !supported.has(key))
  if (unsupported.length > 0) {
    throw new UnsupportedProtocolFeatureError(`Anthropic request controls: ${unsupported.sort().join(', ')}`)
  }
  const input: JsonValue[] = []
  const system = request.system
  if (typeof system === 'string' && system !== '') {
    input.push({ type: 'message', role: 'developer', content: [{ type: 'input_text', text: system }] })
  } else if (system !== undefined) {
    const parts = asArray(system).map(part => {
      const block = requireObject(part, 'Anthropic system block')
      if (block.type !== 'text') throw new UnsupportedProtocolFeatureError('non-text Anthropic system block')
      return { type: 'input_text', text: requireString(block.text, 'Anthropic system text') }
    })
    if (parts.length > 0) input.push({ type: 'message', role: 'developer', content: parts })
  }
  for (const rawMessage of asArray(request.messages)) {
    const message = requireObject(rawMessage, 'Anthropic message')
    const role = requireString(message.role, 'Anthropic message role')
    if (role !== 'user' && role !== 'assistant') throw new UnsupportedProtocolFeatureError(`Anthropic role ${role}`)
    input.push(...anthropicContentToResponses(message.content, role))
  }
  const tools = asArray(request.tools).map(rawTool => {
    const tool = requireObject(rawTool, 'Anthropic tool')
    return {
      type: 'function',
      name: requireString(tool.name, 'Anthropic tool name'),
      ...(asString(tool.description) == null ? {} : { description: asString(tool.description) }),
      parameters: copy(requireObject(tool.input_schema, 'Anthropic tool input_schema'))
    }
  })
  const choice = request.tool_choice
  const toolChoice = isJsonObject(choice) && choice.type === 'tool'
    ? { type: 'function', name: requireString(choice.name, 'Anthropic tool choice name') }
    : isJsonObject(choice) && choice.type === 'any'
    ? 'required'
    : isJsonObject(choice) && choice.type === 'auto'
    ? 'auto'
    : choice
  const thinking = isJsonObject(request.thinking) ? request.thinking : undefined
  const effort = thinking?.type === 'enabled' ? 'medium' : undefined
  return {
    model: asString(request.model),
    input,
    stream: request.stream === true,
    max_output_tokens: asNumber(request.max_tokens),
    ...(tools.length === 0 ? {} : { tools }),
    ...(toolChoice === undefined ? {} : { tool_choice: copy(toolChoice) }),
    ...(effort == null ? {} : { reasoning: { effort } })
  }
}

const geminiRequestToResponses = (request: JsonObject): JsonObject => {
  const supported = new Set(['contents', 'generationConfig', 'systemInstruction', 'toolConfig', 'tools'])
  const unsupported = Object.keys(request).filter(key => !supported.has(key))
  if (unsupported.length > 0) {
    throw new UnsupportedProtocolFeatureError(`Gemini request controls: ${unsupported.sort().join(', ')}`)
  }
  const input: JsonValue[] = []
  const pushContent = (rawContent: JsonValue, forceRole?: 'developer') => {
    const content = requireObject(rawContent, 'Gemini content')
    const role = forceRole ?? (content.role === 'model' ? 'assistant' : 'user')
    const textParts: JsonValue[] = []
    const flushMessage = () => {
      appendMessage(input, role, textParts.splice(0))
    }
    for (const rawPart of asArray(content.parts)) {
      const part = requireObject(rawPart, 'Gemini part')
      if (typeof part.text === 'string') {
        textParts.push({ type: role === 'assistant' ? 'output_text' : 'input_text', text: part.text })
      } else if (isJsonObject(part.functionCall) && role === 'assistant') {
        flushMessage()
        const call = part.functionCall
        input.push({
          type: 'function_call',
          call_id: asString(call.id) ?? `call_${crypto.randomUUID()}`,
          name: requireString(call.name, 'Gemini functionCall name'),
          arguments: JSON.stringify(requireObject(call.args, 'Gemini functionCall args'))
        })
      } else if (isJsonObject(part.functionResponse) && role === 'user') {
        flushMessage()
        const response = part.functionResponse
        input.push({
          type: 'function_call_output',
          call_id: requireString(response.id, 'Gemini functionResponse id'),
          output: JSON.stringify(response.response ?? {})
        })
      } else if (isJsonObject(part.inlineData) && role === 'user') {
        const data = part.inlineData
        const mimeType = requireString(data.mimeType, 'Gemini inlineData mimeType')
        if (!mimeType.startsWith('image/')) throw new UnsupportedProtocolFeatureError('non-image Gemini inlineData')
        textParts.push({
          type: 'input_image',
          image_url: `data:${mimeType};base64,${requireString(data.data, 'Gemini inlineData data')}`
        })
      } else {
        throw new UnsupportedProtocolFeatureError('Gemini part')
      }
    }
    flushMessage()
  }
  if (request.systemInstruction !== undefined) pushContent(request.systemInstruction, 'developer')
  for (const content of asArray(request.contents)) pushContent(content)
  const tools = asArray(request.tools).flatMap(rawTool => {
    const tool = requireObject(rawTool, 'Gemini tool')
    return asArray(tool.functionDeclarations).map(rawDeclaration => {
      const declaration = requireObject(rawDeclaration, 'Gemini function declaration')
      return {
        type: 'function',
        name: requireString(declaration.name, 'Gemini function name'),
        ...(asString(declaration.description) == null ? {} : { description: asString(declaration.description) }),
        parameters: isJsonObject(declaration.parameters)
          ? copy(declaration.parameters)
          : { type: 'object', properties: {} }
      }
    })
  })
  const generation = isJsonObject(request.generationConfig) ? request.generationConfig : undefined
  const toolConfig = isJsonObject(request.toolConfig) ? request.toolConfig : undefined
  const functionConfig = toolConfig && isJsonObject(toolConfig.functionCallingConfig)
    ? toolConfig.functionCallingConfig
    : undefined
  const mode = asString(functionConfig?.mode)
  const toolChoice = mode === 'NONE' ? 'none' : mode === 'ANY' ? 'required' : mode === 'AUTO' ? 'auto' : undefined
  return {
    input,
    stream: false,
    ...(tools.length === 0 ? {} : { tools }),
    ...(toolChoice == null ? {} : { tool_choice: toolChoice }),
    ...(asNumber(generation?.maxOutputTokens) == null
      ? {}
      : { max_output_tokens: asNumber(generation?.maxOutputTokens) })
  }
}

export const translateRequestToResponses = ({ source, request }: TranslateRequestToResponsesOptions): JsonObject => {
  if (source === 'openai-chat-completions') return chatRequestToResponses(request)
  if (source === 'anthropic-messages') return anthropicRequestToResponses(request)
  return geminiRequestToResponses(request)
}

const responseOutput = (response: JsonObject) =>
  asArray(response.output).map(item => requireObject(item, 'Responses output'))

const assertResponseSucceeded = (response: JsonObject) => {
  if (response.status !== 'failed') return
  const error = isJsonObject(response.error) ? response.error : undefined
  throw new UnsupportedProtocolFeatureError(
    `failed Responses result${asString(error?.message) == null ? '' : `: ${asString(error?.message)}`}`
  )
}

const terminalFinishReason = (response: JsonObject, hasTools: boolean) => {
  if (response.status === 'incomplete') return 'length'
  return hasTools ? 'tool_calls' : 'stop'
}

const responseUsageToChat = (response: JsonObject) => {
  const usage = isJsonObject(response.usage) ? response.usage : undefined
  return usage == null
    ? undefined
    : {
      prompt_tokens: asNumber(usage.input_tokens) ?? 0,
      completion_tokens: asNumber(usage.output_tokens) ?? 0,
      total_tokens: asNumber(usage.total_tokens) ??
        (asNumber(usage.input_tokens) ?? 0) + (asNumber(usage.output_tokens) ?? 0)
    }
}

const responsesToChat = (response: JsonObject, model?: string): JsonObject => {
  assertResponseSucceeded(response)
  let text = ''
  const toolCalls: JsonValue[] = []
  for (const item of responseOutput(response)) {
    if (item.type === 'message') {
      for (const rawPart of asArray(item.content)) {
        const part = requireObject(rawPart, 'Responses message part')
        if (part.type === 'output_text') text += asString(part.text) ?? ''
      }
    } else if (item.type === 'function_call') {
      toolCalls.push({
        id: requireString(item.call_id, 'Responses function call id'),
        type: 'function',
        function: {
          name: requireString(item.name, 'Responses function call name'),
          arguments: asString(item.arguments) ?? ''
        }
      })
    }
  }
  const usage = responseUsageToChat(response)
  return {
    id: asString(response.id) ?? `chatcmpl_${crypto.randomUUID()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: model ?? asString(response.model) ?? '',
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: text === '' ? null : text,
        ...(toolCalls.length === 0 ? {} : { tool_calls: toolCalls })
      },
      finish_reason: terminalFinishReason(response, toolCalls.length > 0)
    }],
    ...(usage == null ? {} : { usage })
  }
}

const responsesToAnthropic = (response: JsonObject, model?: string): JsonObject => {
  assertResponseSucceeded(response)
  const content: JsonValue[] = []
  for (const item of responseOutput(response)) {
    if (item.type === 'message') {
      for (const rawPart of asArray(item.content)) {
        const part = requireObject(rawPart, 'Responses message part')
        if (part.type === 'output_text' && typeof part.text === 'string') {
          content.push({ type: 'text', text: part.text })
        }
      }
    } else if (item.type === 'function_call') {
      const args = asString(item.arguments) ?? '{}'
      let input: unknown
      try {
        input = JSON.parse(args)
      } catch {
        throw new UnsupportedProtocolFeatureError('malformed Responses function arguments')
      }
      if (!isJsonObject(input as JsonValue)) {
        throw new UnsupportedProtocolFeatureError('non-object Responses function arguments')
      }
      content.push({
        type: 'tool_use',
        id: requireString(item.call_id, 'Responses function call id'),
        name: requireString(item.name, 'Responses function call name'),
        input: input as JsonObject
      })
    }
  }
  const usage = isJsonObject(response.usage) ? response.usage : undefined
  const hasTools = content.some(item => isJsonObject(item) && item.type === 'tool_use')
  return {
    id: asString(response.id) ?? `msg_${crypto.randomUUID()}`,
    type: 'message',
    role: 'assistant',
    model: model ?? asString(response.model) ?? '',
    content,
    stop_reason: hasTools ? 'tool_use' : response.status === 'incomplete' ? 'max_tokens' : 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: asNumber(usage?.input_tokens) ?? 0,
      output_tokens: asNumber(usage?.output_tokens) ?? 0
    }
  }
}

const responsesToGemini = (response: JsonObject): JsonObject => {
  assertResponseSucceeded(response)
  const parts: JsonValue[] = []
  for (const item of responseOutput(response)) {
    if (item.type === 'message') {
      for (const rawPart of asArray(item.content)) {
        const part = requireObject(rawPart, 'Responses message part')
        if (part.type === 'output_text' && typeof part.text === 'string') parts.push({ text: part.text })
      }
    } else if (item.type === 'function_call') {
      const args = asString(item.arguments) ?? '{}'
      let parsed: unknown
      try {
        parsed = JSON.parse(args)
      } catch {
        throw new UnsupportedProtocolFeatureError('malformed Responses function arguments')
      }
      if (!isJsonObject(parsed as JsonValue)) {
        throw new UnsupportedProtocolFeatureError('non-object Responses function arguments')
      }
      parts.push({
        functionCall: {
          id: requireString(item.call_id, 'Responses function call id'),
          name: requireString(item.name, 'Responses function call name'),
          args: parsed as JsonObject
        }
      })
    }
  }
  const usage = isJsonObject(response.usage) ? response.usage : undefined
  return {
    candidates: [{
      content: { role: 'model', parts },
      finishReason: response.status === 'completed' ? 'STOP' : 'OTHER'
    }],
    usageMetadata: {
      promptTokenCount: asNumber(usage?.input_tokens) ?? 0,
      candidatesTokenCount: asNumber(usage?.output_tokens) ?? 0,
      totalTokenCount: asNumber(usage?.total_tokens) ?? 0
    }
  }
}

export const translateResponsesToResponse = ({
  target,
  response,
  model
}: TranslateResponsesToResponseOptions): JsonObject => {
  if (target === 'openai-chat-completions') return responsesToChat(response, model)
  if (target === 'anthropic-messages') return responsesToAnthropic(response, model)
  return responsesToGemini(response)
}
