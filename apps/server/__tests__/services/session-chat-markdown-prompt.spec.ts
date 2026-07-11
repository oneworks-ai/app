import { describe, expect, it } from 'vitest'

import { buildChatMarkdownSystemPrompt } from '#~/services/session/chat-markdown-prompt.js'

describe('chat Markdown system prompt', () => {
  it('teaches agents the three explicit link intents without arbitrary file access', () => {
    const prompt = buildChatMarkdownSystemPrompt()

    expect(prompt).toContain('"oneworks:open=internal"')
    expect(prompt).toContain('"oneworks:open=external"')
    expect(prompt).toContain('"oneworks:open=workspace-file"')
    expect(prompt).toContain('Use workspace-relative paths')
    expect(prompt).toContain('Never use this metadata to request arbitrary filesystem access')
  })
})
