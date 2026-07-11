import { CodeBlock } from '#~/components/CodeBlock'
import { MarkdownContent } from '#~/components/MarkdownContent'
import { safeJsonStringify } from '#~/utils/safe-serialize'

import { getStringList, getStructuredBlocks, looksLikeMarkdown } from './tool-result-content-utils'

export function ToolResultContent({
  content,
  preferMarkdown = false,
  format = 'auto',
  language
}: {
  content: unknown
  preferMarkdown?: boolean
  format?: 'auto' | 'text' | 'code' | 'json' | 'markdown'
  language?: string
}) {
  if (format === 'json') {
    return <CodeBlock code={safeJsonStringify(content, 2)} lang='json' />
  }
  if (format === 'code') {
    const code = typeof content === 'string' ? content : safeJsonStringify(content, 2)
    return <CodeBlock code={code} lang={language ?? 'text'} />
  }
  if (format === 'text') {
    const text = typeof content === 'string' ? content : safeJsonStringify(content, 2)
    return <div className='tool-result-text-content'>{text}</div>
  }
  if (format === 'markdown') {
    const markdown = typeof content === 'string' ? content : safeJsonStringify(content, 2)
    return <MarkdownContent content={markdown} />
  }

  const structuredBlocks = getStructuredBlocks(content)
  if (structuredBlocks != null) {
    return (
      <div className='tool-result-structured'>
        {structuredBlocks.map((block, index) => (
          block.type === 'text'
            ? (
              <div className='tool-result-text' key={`text-${index}`}>
                {block.format === 'markdown'
                  ? <MarkdownContent content={block.text} />
                  : <div className='tool-result-text-content'>{block.text}</div>}
              </div>
            )
            : (
              <div className='tool-result-image-wrapper' key={`image-${index}`}>
                <img
                  className='tool-result-image'
                  src={block.src}
                  alt={block.alt ?? ''}
                  width={block.width}
                  height={block.height}
                />
                {block.title != null && block.title !== '' && (
                  <div className='tool-result-image-caption'>{block.title}</div>
                )}
              </div>
            )
        ))}
      </div>
    )
  }

  const stringList = getStringList(content)
  if (stringList != null) {
    return (
      <div className='tool-result-list'>
        {stringList.map(item => (
          <div className='tool-result-list-item' key={item}>{item}</div>
        ))}
      </div>
    )
  }

  if (typeof content === 'string') {
    if (content.startsWith('```') || (preferMarkdown && looksLikeMarkdown(content))) {
      return <MarkdownContent content={content} />
    }

    return <CodeBlock code={content} lang='text' />
  }

  return <CodeBlock code={safeJsonStringify(content, 2)} lang='json' />
}
