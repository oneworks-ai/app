/* eslint-disable max-lines -- one request-scoped stream state machine owns the complete Responses lifecycle. */
import { UnsupportedProtocolFeatureError, asArray, asNumber, asString, isJsonObject } from './protocol.js'
import type { JsonObject, JsonValue, ModelServiceApiProtocol } from './protocol.js'
import { encodeReasoningCarrier } from './responses.js'
import type { ReasoningCarrier } from './responses.js'

export interface ResponseStreamTranslatorOptions {
  source: Exclude<ModelServiceApiProtocol, 'openai-responses' | 'gemini-interactions'>
  requestId?: string
  reasoningSummary?: string
  maxInputBytes?: number
}

interface ToolState {
  id: string
  callId: string
  name: string
  arguments: string
  added: boolean
  outputIndex?: number
}

interface DetachedReasoningState {
  id: string
  outputIndex: number
  encryptedContent: string
}

interface AnthropicUsageState {
  input: number
  cacheCreation: number
  cacheRead: number
  output: number
}

const frame = (event: string, data: JsonValue) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
const idFor = (value?: string) => value?.startsWith('resp_') ? value : `resp_${value ?? crypto.randomUUID()}`

/**
 * Translates one upstream SSE response to a Responses SSE lifecycle. Instances
 * intentionally retain no module state, so two proxy requests cannot cross-talk.
 */
export class ResponseStreamTranslator {
  readonly #source: ResponseStreamTranslatorOptions['source']
  readonly #id: string
  readonly #messageId: string
  readonly #includeReasoningSummary: boolean
  readonly #maxInputBytes: number
  #buffer = ''
  #eventType = ''
  #dataLines: string[] = []
  #started = false
  #completed = false
  #textAdded = false
  #textOutputIndex?: number
  #nextOutputIndex = 0
  #text = ''
  #reasoningAdded = false
  #reasoningOutputIndex?: number
  #reasoning = ''
  #reasoningSignature?: string
  #reasoningProvider?: ReasoningCarrier['provider']
  #usage?: JsonObject
  #anthropicUsage: AnthropicUsageState = { input: 0, cacheCreation: 0, cacheRead: 0, output: 0 }
  #tools = new Map<number, ToolState>()
  #anthropicBlocks = new Map<number, ToolState | 'reasoning' | 'text'>()
  #detachedReasoning: DetachedReasoningState[] = []
  #sequenceNumber = 0
  #inputBytes = 0
  #terminalStatus: 'completed' | 'incomplete' | 'failed' = 'completed'
  #terminalDetail?: string
  #geminiSawContent = false

  constructor(options: ResponseStreamTranslatorOptions) {
    this.#source = options.source
    this.#id = idFor(options.requestId)
    this.#messageId = `msg_${this.#id}`
    this.#includeReasoningSummary = options.reasoningSummary !== 'none'
    this.#maxInputBytes = options.maxInputBytes ?? 16 * 1024 * 1024
  }

  #startFrames(): string[] {
    if (this.#started) return []
    this.#started = true
    const response = { id: this.#id, object: 'response', status: 'in_progress', output: [] }
    return [
      frame('response.created', { type: 'response.created', response }),
      frame('response.in_progress', { type: 'response.in_progress', response })
    ]
  }

  start(): string[] {
    return this.#sequenceFrames(this.#startFrames())
  }

  push(chunk: string): string[] {
    const emitted = this.#startFrames()
    this.#inputBytes += new TextEncoder().encode(chunk).byteLength
    if (this.#inputBytes > this.#maxInputBytes) {
      throw new UnsupportedProtocolFeatureError('upstream SSE exceeds the configured byte limit', this.#source)
    }
    // Normalize after concatenation so a CRLF split across transport chunks is
    // still recognized as one SSE line ending.
    this.#buffer = `${this.#buffer}${chunk}`.replace(/\r\n/g, '\n')
    if (this.#buffer.length > this.#maxInputBytes) {
      throw new UnsupportedProtocolFeatureError('upstream SSE frame exceeds the configured byte limit', this.#source)
    }
    while (true) {
      const boundary = this.#buffer.indexOf('\n\n')
      if (boundary < 0) break
      const raw = this.#buffer.slice(0, boundary)
      this.#buffer = this.#buffer.slice(boundary + 2)
      emitted.push(...this.#parseSseBlock(raw))
    }
    return this.#sequenceFrames(emitted)
  }

  finish(): string[] {
    const emitted = this.#startFrames()
    if (this.#buffer.trim()) emitted.push(...this.#parseSseBlock(this.#buffer))
    this.#buffer = ''
    if (this.#source === 'gemini-generate-content' && !this.#completed && !this.#geminiSawContent) {
      this.#terminalStatus = 'failed'
      this.#terminalDetail ??= 'Gemini returned no usable candidate content.'
    }
    emitted.push(...this.#complete())
    return this.#sequenceFrames(emitted)
  }

  fail(message: string, code = 'protocol_conversion_error'): string[] {
    return this.#sequenceFrames(this.#failed(message, code))
  }

  #sequenceFrames(frames: string[]): string[] {
    return frames.map((raw) => {
      const match = /^event: ([^\n]+)\ndata: ([\s\S]+)\n\n$/.exec(raw)
      if (!match) return raw
      const parsed: unknown = JSON.parse(match[2]!)
      if (!isJsonObject(parsed)) return raw
      parsed.sequence_number = this.#sequenceNumber++
      return frame(match[1]!, parsed)
    })
  }

  #parseSseBlock(raw: string): string[] {
    let event = ''
    const data: string[] = []
    for (const line of raw.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
    }
    const joined = data.join('\n')
    if (!joined || joined === '[DONE]') return joined === '[DONE]' ? this.#complete() : []
    let payload: unknown
    try {
      payload = JSON.parse(joined)
    } catch {
      throw new UnsupportedProtocolFeatureError('malformed upstream SSE JSON', this.#source)
    }
    if (!isJsonObject(payload)) throw new UnsupportedProtocolFeatureError('non-object upstream SSE JSON', this.#source)
    if (this.#source === 'openai-chat-completions') return this.#onChat(payload)
    if (this.#source === 'anthropic-messages') return this.#onAnthropic(event, payload)
    return this.#onGemini(payload)
  }

  #messageAdded(): string[] {
    this.#textOutputIndex ??= this.#nextOutputIndex++
    return [
      frame('response.output_item.added', {
        type: 'response.output_item.added',
        output_index: this.#textOutputIndex,
        item: { id: this.#messageId, type: 'message', role: 'assistant', status: 'in_progress', content: [] }
      })
    ]
  }

  #textDelta(delta: string): string[] {
    if (!delta) return []
    const emitted: string[] = []
    if (!this.#textAdded) {
      this.#textAdded = true
      emitted.push(...this.#messageAdded())
      emitted.push(
        frame('response.content_part.added', {
          type: 'response.content_part.added',
          item_id: this.#messageId,
          output_index: this.#textOutputIndex!,
          content_index: 0,
          part: { type: 'output_text', text: '' }
        })
      )
    }
    this.#text += delta
    emitted.push(
      frame('response.output_text.delta', {
        type: 'response.output_text.delta',
        item_id: this.#messageId,
        output_index: this.#textOutputIndex!,
        content_index: 0,
        delta
      })
    )
    return emitted
  }

  #reasoningDelta(delta: string): string[] {
    const emitted: string[] = []
    if (!this.#reasoningAdded) {
      this.#reasoningAdded = true
      this.#reasoningOutputIndex = this.#nextOutputIndex++
      emitted.push(frame('response.output_item.added', {
        type: 'response.output_item.added',
        output_index: this.#reasoningOutputIndex,
        item: { id: `rs_${this.#id}`, type: 'reasoning', status: 'in_progress', summary: [] }
      }))
      if (this.#includeReasoningSummary) {
        emitted.push(frame('response.reasoning_summary_part.added', {
          type: 'response.reasoning_summary_part.added',
          item_id: `rs_${this.#id}`,
          output_index: this.#reasoningOutputIndex,
          summary_index: 0,
          part: { type: 'summary_text', text: '' }
        }))
      }
    }
    if (delta) {
      this.#reasoning += delta
      if (this.#includeReasoningSummary) {
        emitted.push(frame('response.reasoning_summary_text.delta', {
          type: 'response.reasoning_summary_text.delta',
          item_id: `rs_${this.#id}`,
          output_index: this.#reasoningOutputIndex!,
          summary_index: 0,
          delta
        }))
      }
    }
    return emitted
  }

  #detachedReasoningCarrier(carrier: ReasoningCarrier): string[] {
    const outputIndex = this.#nextOutputIndex++
    const id = `rs_${this.#id}_detached_${this.#detachedReasoning.length}`
    const encryptedContent = encodeReasoningCarrier(carrier)
    this.#detachedReasoning.push({ id, outputIndex, encryptedContent })
    return [
      frame('response.output_item.added', {
        type: 'response.output_item.added',
        output_index: outputIndex,
        item: { id, type: 'reasoning', status: 'in_progress', summary: [] }
      }),
      frame('response.output_item.done', {
        type: 'response.output_item.done',
        output_index: outputIndex,
        item: { id, type: 'reasoning', status: 'completed', summary: [], encrypted_content: encryptedContent }
      })
    ]
  }

  #toolDelta(index: number, id: string | undefined, name: string | undefined, delta: string): string[] {
    let tool = this.#tools.get(index)
    if (!tool) {
      tool = { id: id ?? `fc_${index}`, callId: id ?? `call_${index}`, name: name ?? '', arguments: '', added: false }
      this.#tools.set(index, tool)
    }
    if (id) {
      tool.id = id
      tool.callId = id
    }
    if (name) tool.name = name
    const emitted: string[] = []
    if (!tool.added && tool.name) {
      tool.added = true
      tool.outputIndex = this.#nextOutputIndex++
      emitted.push(
        frame('response.output_item.added', {
          type: 'response.output_item.added',
          output_index: tool.outputIndex,
          item: {
            id: tool.id,
            type: 'function_call',
            status: 'in_progress',
            call_id: tool.callId,
            name: tool.name,
            arguments: ''
          }
        })
      )
      if (tool.arguments) {
        emitted.push(
          frame('response.function_call_arguments.delta', {
            type: 'response.function_call_arguments.delta',
            item_id: tool.id,
            output_index: tool.outputIndex,
            delta: tool.arguments
          })
        )
      }
    }
    if (delta) {
      tool.arguments += delta
      if (tool.added) {
        emitted.push(
          frame('response.function_call_arguments.delta', {
            type: 'response.function_call_arguments.delta',
            item_id: tool.id,
            output_index: tool.outputIndex!,
            delta
          })
        )
      }
    }
    return emitted
  }

  #onChat(payload: JsonObject): string[] {
    if (isJsonObject(payload.error)) {
      return this.#failed(asString(payload.error.message) ?? 'Upstream Chat Completions error')
    }
    const emitted: string[] = []
    const rawUsage = isJsonObject(payload.usage) ? payload.usage : undefined
    if (rawUsage) {
      const promptDetails = isJsonObject(rawUsage.prompt_tokens_details) ? rawUsage.prompt_tokens_details : undefined
      const completionDetails = isJsonObject(rawUsage.completion_tokens_details)
        ? rawUsage.completion_tokens_details
        : undefined
      this.#usage = usage(
        asNumber(rawUsage.prompt_tokens),
        asNumber(rawUsage.completion_tokens),
        asNumber(rawUsage.total_tokens),
        promptDetails && asNumber(promptDetails.cached_tokens) !== undefined
          ? { cached_tokens: asNumber(promptDetails.cached_tokens)! }
          : undefined,
        completionDetails && asNumber(completionDetails.reasoning_tokens) !== undefined
          ? { reasoning_tokens: asNumber(completionDetails.reasoning_tokens)! }
          : undefined
      )
    }
    const choices = asArray(payload.choices)
    if (choices.length > 1) throw new UnsupportedProtocolFeatureError('Chat stream choice count', this.#source)
    for (const choice of choices) {
      if (!isJsonObject(choice)) throw new UnsupportedProtocolFeatureError('Chat stream choice', this.#source)
      const finishReason = asString(choice.finish_reason)
      if (finishReason === 'length') {
        this.#terminalStatus = 'incomplete'
        this.#terminalDetail = finishReason
      } else if (finishReason != null && finishReason !== 'stop' && finishReason !== 'tool_calls') {
        this.#terminalStatus = 'failed'
        this.#terminalDetail = finishReason
      }
      const delta = isJsonObject(choice.delta) ? choice.delta : undefined
      if (delta) {
        const reasoningContent = asString(delta.reasoning_content)
        if (reasoningContent !== undefined) emitted.push(...this.#reasoningDelta(reasoningContent))
        const content = asString(delta.content)
        if (delta.content != null && content === undefined) {
          throw new UnsupportedProtocolFeatureError('Chat stream content shape', this.#source)
        }
        emitted.push(...this.#textDelta(content ?? ''))
        for (const rawTool of asArray(delta.tool_calls)) {
          if (!isJsonObject(rawTool)) throw new UnsupportedProtocolFeatureError('Chat stream tool call', this.#source)
          const fn = isJsonObject(rawTool.function) ? rawTool.function : undefined
          emitted.push(
            ...this.#toolDelta(
              asNumber(rawTool.index) ?? 0,
              asString(rawTool.id),
              asString(fn?.name),
              asString(fn?.arguments) ?? ''
            )
          )
        }
      }
      // A usage-only frame can arrive after finish_reason. Wait for [DONE] (or
      // finish()) so response.completed contains the final token accounting.
    }
    return emitted
  }

  #onAnthropic(event: string, payload: JsonObject): string[] {
    if (event === 'error') {
      return this.#failed(
        asString(isJsonObject(payload.error) ? payload.error.message : undefined) ?? 'Upstream Anthropic error'
      )
    }
    const emitted: string[] = []
    if (event === 'message_start' && isJsonObject(payload.message) && isJsonObject(payload.message.usage)) {
      const u = payload.message.usage
      this.#anthropicUsage = {
        input: asNumber(u.input_tokens) ?? 0,
        cacheCreation: asNumber(u.cache_creation_input_tokens) ?? 0,
        cacheRead: asNumber(u.cache_read_input_tokens) ?? 0,
        output: asNumber(u.output_tokens) ?? 0
      }
      this.#usage = anthropicUsage(this.#anthropicUsage)
    }
    if (event === 'message_delta' && isJsonObject(payload.usage)) {
      const u = payload.usage
      this.#anthropicUsage.output = asNumber(u.output_tokens) ?? this.#anthropicUsage.output
      this.#usage = anthropicUsage(this.#anthropicUsage)
    }
    if (event === 'message_delta') {
      const stopReason = asString(payload.stop_reason)
      if (stopReason === 'max_tokens') {
        this.#terminalStatus = 'incomplete'
        this.#terminalDetail = stopReason
      } else if (
        stopReason != null &&
        stopReason !== 'end_turn' &&
        stopReason !== 'stop_sequence' &&
        stopReason !== 'tool_use'
      ) {
        this.#terminalStatus = 'failed'
        this.#terminalDetail = stopReason
      }
    }
    const index = asNumber(payload.index) ?? 0
    if (event === 'content_block_start' && isJsonObject(payload.content_block)) {
      const block = payload.content_block
      if (block.type === 'text') this.#anthropicBlocks.set(index, 'text')
      else if (block.type === 'thinking') {
        this.#anthropicBlocks.set(index, 'reasoning')
        this.#reasoningSignature = asString(block.signature)
        this.#reasoningProvider = 'anthropic'
        return this.#reasoningDelta(asString(block.thinking) ?? '')
      } else if (block.type === 'tool_use') {
        const blockId = asString(block.id)
        const blockName = asString(block.name)
        if (!blockName) throw new UnsupportedProtocolFeatureError('Anthropic stream tool name', this.#source)
        const initialInput = isJsonObject(block.input) && Object.keys(block.input).length > 0
          ? JSON.stringify(block.input)
          : ''
        emitted.push(...this.#toolDelta(index, blockId, blockName, initialInput))
        const current = this.#tools.get(index)
        if (current) this.#anthropicBlocks.set(index, current)
      } else {
        throw new UnsupportedProtocolFeatureError(
          `Anthropic stream content ${asString(block.type) ?? 'missing'}`,
          this.#source
        )
      }
      return emitted
    }
    if (event === 'content_block_delta' && isJsonObject(payload.delta)) {
      const delta = payload.delta
      const block = this.#anthropicBlocks.get(index)
      if (delta.type === 'text_delta' && block === 'text') return this.#textDelta(asString(delta.text) ?? '')
      if (delta.type === 'thinking_delta' && block === 'reasoning') {
        return this.#reasoningDelta(asString(delta.thinking) ?? '')
      }
      if (delta.type === 'signature_delta' && block === 'reasoning') {
        this.#reasoningSignature = asString(delta.signature) ?? this.#reasoningSignature
        this.#reasoningProvider = 'anthropic'
        return emitted
      }
      if (delta.type === 'input_json_delta' && block && block !== 'text' && block !== 'reasoning') {
        const translated = this.#toolDelta(index, block.id, block.name, asString(delta.partial_json) ?? '')
        const current = this.#tools.get(index)
        if (current) this.#anthropicBlocks.set(index, current)
        return translated
      }
      throw new UnsupportedProtocolFeatureError('Anthropic stream delta', this.#source)
    }
    if (event === 'message_stop') return this.#complete()
    return emitted
  }

  #onGemini(payload: JsonObject): string[] {
    if (isJsonObject(payload.error)) return this.#failed(asString(payload.error.message) ?? 'Upstream Gemini error')
    const promptFeedback = isJsonObject(payload.promptFeedback) ? payload.promptFeedback : undefined
    const blockReason = asString(promptFeedback?.blockReason)
    if (blockReason != null) {
      const detail = asString(promptFeedback?.blockReasonMessage)
      return this.#failed(detail ? `${blockReason}: ${detail}` : blockReason)
    }
    const emitted: string[] = []
    const rawUsage = isJsonObject(payload.usageMetadata) ? payload.usageMetadata : undefined
    if (rawUsage) {
      const candidates = asNumber(rawUsage.candidatesTokenCount)
      const thoughts = asNumber(rawUsage.thoughtsTokenCount) ?? 0
      this.#usage = usage(
        asNumber(rawUsage.promptTokenCount),
        candidates == null ? (thoughts || undefined) : candidates + thoughts,
        asNumber(rawUsage.totalTokenCount),
        asNumber(rawUsage.cachedContentTokenCount) !== undefined
          ? { cached_tokens: asNumber(rawUsage.cachedContentTokenCount)! }
          : undefined,
        thoughts > 0 ? { reasoning_tokens: thoughts } : undefined
      )
    }
    const candidate = asArray(payload.candidates)[0]
    if (isJsonObject(candidate) && isJsonObject(candidate.content)) {
      asArray(candidate.content.parts).forEach((part, index) => {
        if (!isJsonObject(part)) throw new UnsupportedProtocolFeatureError('Gemini stream part', this.#source)
        const text = asString(part.text)
        const thoughtSignature = asString(part.thoughtSignature) ?? asString(part.thought_signature)
        if (text !== undefined) {
          this.#geminiSawContent = true
          if (part.thought === true) {
            this.#reasoningSignature = thoughtSignature ?? this.#reasoningSignature
            this.#reasoningProvider = 'gemini'
            emitted.push(...this.#reasoningDelta(text))
            return
          }
          if (thoughtSignature) {
            emitted.push(...this.#detachedReasoningCarrier({
              provider: 'gemini',
              signature: thoughtSignature,
              text: ''
            }))
          }
          emitted.push(...this.#textDelta(text))
          return
        }
        if (isJsonObject(part.functionCall) && asString(part.functionCall.name)) {
          this.#geminiSawContent = true
          if (thoughtSignature) {
            emitted.push(...this.#detachedReasoningCarrier({
              provider: 'gemini',
              signature: thoughtSignature,
              text: ''
            }))
          }
          const rawArgs = part.functionCall.args ?? {}
          if (!isJsonObject(rawArgs)) {
            throw new UnsupportedProtocolFeatureError('Gemini functionCall without object args', this.#source)
          }
          const args = JSON.stringify(rawArgs)
          const previous = this.#tools.get(index)?.arguments ?? ''
          emitted.push(
            ...this.#toolDelta(
              index,
              asString(part.functionCall.id),
              asString(part.functionCall.name),
              args.startsWith(previous) ? args.slice(previous.length) : args
            )
          )
          return
        }
        throw new UnsupportedProtocolFeatureError('Gemini stream response part', this.#source)
      })
    }
    const finishReason = isJsonObject(candidate) ? asString(candidate.finishReason) : undefined
    if (finishReason === 'MAX_TOKENS') {
      this.#terminalStatus = 'incomplete'
      this.#terminalDetail = finishReason
    } else if (finishReason != null && finishReason !== 'STOP') {
      this.#terminalStatus = 'failed'
      this.#terminalDetail = finishReason
    } else if (finishReason != null && !this.#geminiSawContent) {
      this.#terminalStatus = 'failed'
      this.#terminalDetail = 'Gemini returned no usable candidate content.'
    }
    if (isJsonObject(candidate) && candidate.finishReason !== undefined) emitted.push(...this.#complete())
    return emitted
  }

  #complete(): string[] {
    if (this.#completed) return []
    this.#completed = true
    const emitted: string[] = []
    if (this.#reasoningAdded) {
      if (this.#includeReasoningSummary) {
        emitted.push(frame('response.reasoning_summary_text.done', {
          type: 'response.reasoning_summary_text.done',
          item_id: `rs_${this.#id}`,
          output_index: this.#reasoningOutputIndex!,
          summary_index: 0,
          text: this.#reasoning
        }))
        emitted.push(frame('response.reasoning_summary_part.done', {
          type: 'response.reasoning_summary_part.done',
          item_id: `rs_${this.#id}`,
          output_index: this.#reasoningOutputIndex!,
          summary_index: 0,
          part: { type: 'summary_text', text: this.#reasoning }
        }))
      }
      const encryptedContent = this.#reasoningSignature && this.#reasoningProvider
        ? encodeReasoningCarrier({
          provider: this.#reasoningProvider,
          signature: this.#reasoningSignature,
          text: this.#reasoning
        })
        : undefined
      emitted.push(frame('response.output_item.done', {
        type: 'response.output_item.done',
        output_index: this.#reasoningOutputIndex!,
        item: {
          id: `rs_${this.#id}`,
          type: 'reasoning',
          status: this.#terminalStatus === 'completed' ? 'completed' : this.#terminalStatus,
          summary: this.#includeReasoningSummary ? [{ type: 'summary_text', text: this.#reasoning }] : [],
          ...(encryptedContent ? { encrypted_content: encryptedContent } : {})
        }
      }))
    }
    if (this.#textAdded) {
      if (this.#terminalStatus === 'completed') {
        emitted.push(
          frame('response.output_text.done', {
            type: 'response.output_text.done',
            item_id: this.#messageId,
            output_index: this.#textOutputIndex!,
            content_index: 0,
            text: this.#text
          })
        )
        emitted.push(
          frame('response.content_part.done', {
            type: 'response.content_part.done',
            item_id: this.#messageId,
            output_index: this.#textOutputIndex!,
            content_index: 0,
            part: { type: 'output_text', text: this.#text }
          })
        )
      }
      emitted.push(
        frame('response.output_item.done', {
          type: 'response.output_item.done',
          output_index: this.#textOutputIndex!,
          item: {
            id: this.#messageId,
            type: 'message',
            role: 'assistant',
            status: this.#terminalStatus === 'completed' ? 'completed' : this.#terminalStatus,
            content: [{ type: 'output_text', text: this.#text }]
          }
        })
      )
    }
    for (const [index, tool] of this.#tools) {
      if (!tool.added) continue
      if (this.#terminalStatus === 'completed') {
        try {
          const parsed: unknown = JSON.parse(tool.arguments)
          if (!isJsonObject(parsed)) throw new Error('non-object')
        } catch {
          throw new UnsupportedProtocolFeatureError('incomplete function arguments', this.#source)
        }
        emitted.push(
          frame('response.function_call_arguments.done', {
            type: 'response.function_call_arguments.done',
            item_id: tool.id,
            output_index: tool.outputIndex!,
            arguments: tool.arguments
          })
        )
      }
      emitted.push(
        frame('response.output_item.done', {
          type: 'response.output_item.done',
          output_index: tool.outputIndex!,
          item: {
            id: tool.id,
            type: 'function_call',
            status: this.#terminalStatus === 'completed' ? 'completed' : this.#terminalStatus,
            call_id: tool.callId,
            name: tool.name,
            arguments: tool.arguments
          }
        })
      )
    }
    const outputEntries: Array<[number, JsonValue]> = []
    if (this.#reasoningAdded) {
      outputEntries.push([this.#reasoningOutputIndex!, {
        id: `rs_${this.#id}`,
        type: 'reasoning',
        status: this.#terminalStatus === 'completed' ? 'completed' : this.#terminalStatus,
        summary: this.#includeReasoningSummary ? [{ type: 'summary_text', text: this.#reasoning }] : [],
        ...(this.#reasoningSignature && this.#reasoningProvider
          ? {
            encrypted_content: encodeReasoningCarrier({
              provider: this.#reasoningProvider,
              signature: this.#reasoningSignature,
              text: this.#reasoning
            })
          }
          : {})
      }])
    }
    for (const item of this.#detachedReasoning) {
      outputEntries.push([item.outputIndex, {
        id: item.id,
        type: 'reasoning',
        status: 'completed',
        summary: [],
        encrypted_content: item.encryptedContent
      }])
    }
    if (this.#textAdded) {
      outputEntries.push([this.#textOutputIndex!, {
        id: this.#messageId,
        type: 'message',
        role: 'assistant',
        status: this.#terminalStatus === 'completed' ? 'completed' : this.#terminalStatus,
        content: [{ type: 'output_text', text: this.#text }]
      }])
    }
    for (const [, tool] of this.#tools) {
      if (tool.outputIndex != null) {
        outputEntries.push([tool.outputIndex, {
          id: tool.id,
          type: 'function_call',
          status: this.#terminalStatus === 'completed' ? 'completed' : this.#terminalStatus,
          call_id: tool.callId,
          name: tool.name,
          arguments: tool.arguments
        }])
      }
    }
    const output = outputEntries.sort(([left], [right]) => left - right).map(([, item]) => item)
    const terminalEvent = this.#terminalStatus === 'completed'
      ? 'response.completed'
      : this.#terminalStatus === 'incomplete'
      ? 'response.incomplete'
      : 'response.failed'
    emitted.push(
      frame(terminalEvent, {
        type: terminalEvent,
        response: {
          id: this.#id,
          object: 'response',
          status: this.#terminalStatus,
          output,
          ...(this.#terminalStatus === 'incomplete'
            ? { incomplete_details: { reason: 'max_output_tokens' } }
            : {}),
          ...(this.#terminalStatus === 'failed'
            ? {
              error: {
                code: 'upstream_safety_or_protocol_stop',
                message: this.#terminalDetail ?? 'Upstream generation failed.'
              }
            }
            : {}),
          ...(this.#usage ? { usage: this.#usage } : {})
        }
      })
    )
    emitted.push('data: [DONE]\n\n')
    return emitted
  }

  #failed(message: string, code = 'upstream_error'): string[] {
    if (this.#completed) return []
    this.#completed = true
    return [
      frame('response.failed', {
        type: 'response.failed',
        response: { id: this.#id, object: 'response', status: 'failed', error: { code, message } }
      }),
      'data: [DONE]\n\n'
    ]
  }
}

const usage = (
  input: number | undefined,
  output: number | undefined,
  total?: number,
  inputDetails?: JsonObject,
  outputDetails?: JsonObject
): JsonObject => ({
  input_tokens: input ?? 0,
  output_tokens: output ?? 0,
  total_tokens: total ?? (input ?? 0) + (output ?? 0),
  ...(inputDetails ? { input_tokens_details: inputDetails } : {}),
  ...(outputDetails ? { output_tokens_details: outputDetails } : {})
})

const anthropicUsage = (state: AnthropicUsageState): JsonObject =>
  usage(
    state.input + state.cacheCreation + state.cacheRead,
    state.output,
    undefined,
    state.cacheCreation > 0 || state.cacheRead > 0
      ? { cached_tokens: state.cacheRead, cache_creation_tokens: state.cacheCreation }
      : undefined
  )

export const createResponseStreamTranslator = (options: ResponseStreamTranslatorOptions) =>
  new ResponseStreamTranslator(options)
