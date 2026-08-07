const MAX_JSON_BYTES = 1024 * 1024
const MAX_DEPTH = 16
const MAX_CONTAINER_ITEMS = 256
const MAX_NODES = 16_384
const MAX_KEY_BYTES = 64 * 1024
const MAX_STRING_BYTES = 512 * 1024

interface JsonBudget {
  keyBytes: number
  nodes: number
  stringBytes: number
}

const textEncoder = new TextEncoder()

const readBoundedResponseText = async (response: Response) => {
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BYTES) {
    throw new Error('Plugin snapshot response exceeds the public JSON byte limit.')
  }
  if (response.body == null) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let result = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > MAX_JSON_BYTES) {
        await reader.cancel()
        throw new Error('Plugin snapshot response exceeds the public JSON byte limit.')
      }
      result += decoder.decode(chunk.value, { stream: true })
    }
    return result + decoder.decode()
  } finally {
    reader.releaseLock()
  }
}

const assertJsonBudget = (root: unknown) => {
  const budget: JsonBudget = { keyBytes: 0, nodes: 0, stringBytes: 0 }
  const stack: Array<{ depth: number; value: unknown }> = [{ depth: 0, value: root }]
  while (stack.length > 0) {
    const current = stack.pop()!
    budget.nodes += 1
    if (budget.nodes > MAX_NODES || current.depth > MAX_DEPTH) {
      throw new Error('Plugin snapshot JSON exceeds its structural limit.')
    }
    if (typeof current.value === 'string') {
      budget.stringBytes += textEncoder.encode(current.value).byteLength
      if (budget.stringBytes > MAX_STRING_BYTES) {
        throw new Error('Plugin snapshot JSON exceeds its string byte limit.')
      }
      continue
    }
    if (current.value == null || typeof current.value !== 'object') continue
    if (Array.isArray(current.value)) {
      if (current.value.length > MAX_CONTAINER_ITEMS) {
        throw new Error('Plugin snapshot JSON exceeds its array item limit.')
      }
      for (const value of current.value) stack.push({ depth: current.depth + 1, value })
      continue
    }
    const entries = Object.entries(current.value)
    if (entries.length > MAX_CONTAINER_ITEMS) {
      throw new Error('Plugin snapshot JSON exceeds its object key limit.')
    }
    for (const [key, value] of entries) {
      budget.keyBytes += textEncoder.encode(key).byteLength
      if (budget.keyBytes > MAX_KEY_BYTES) {
        throw new Error('Plugin snapshot JSON exceeds its key byte limit.')
      }
      stack.push({ depth: current.depth + 1, value })
    }
  }
}

export const parsePublicPluginResponse = async (response: Response) => {
  const text = await readBoundedResponseText(response)
  if (!response.ok) {
    throw new Error(`Plugin snapshot request failed with status ${response.status}.`)
  }
  const value: unknown = JSON.parse(text)
  assertJsonBudget(value)
  return value
}
