export const MODEL_SERVICE_API_PROTOCOLS = [
  'openai-responses',
  'openai-chat-completions',
  'anthropic-messages',
  'gemini-generate-content',
  'gemini-interactions'
] as const

export type ModelServiceApiProtocol = typeof MODEL_SERVICE_API_PROTOCOLS[number]
