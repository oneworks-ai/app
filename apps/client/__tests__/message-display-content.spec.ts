import { describe, expect, it } from 'vitest'

import {
  escapeLeadingUserMarkdownReferenceDefinition,
  normalizeEscapedMessageLineBreaks,
  prepareMarkdownMessageContent
} from '#~/components/chat/messages/message-display-content'

describe('message display content', () => {
  it('keeps channel sender prefixes visible in user markdown bubbles', () => {
    const content = '[wxid_sender]:\n吃了吗？'

    expect(escapeLeadingUserMarkdownReferenceDefinition(content)).toBe('\\[wxid_sender]:\n吃了吗？')
  })

  it('leaves ordinary markdown unchanged', () => {
    const content = '你好，**收到**。'

    expect(escapeLeadingUserMarkdownReferenceDefinition(content)).toBe(content)
  })

  it('normalizes escaped line breaks before markdown rendering', () => {
    const content = '第一段\\n\\n- 第二段\\r\\n- 第三段'

    expect(normalizeEscapedMessageLineBreaks(content)).toBe('第一段\n\n- 第二段\n- 第三段')
    expect(prepareMarkdownMessageContent(content)).toBe('第一段\n\n- 第二段\n- 第三段')
  })

  it('escapes leading user references after normalizing escaped line breaks', () => {
    const content = '[wxid_sender]:\\n吃了吗？'

    expect(prepareMarkdownMessageContent(content, {
      escapeLeadingUserReferenceDefinition: true
    })).toBe('\\[wxid_sender]:\n吃了吗？')
  })
})
