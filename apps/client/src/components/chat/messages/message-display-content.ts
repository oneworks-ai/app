const LEADING_REFERENCE_DEFINITION_RE = /^\[([^\]\n]+)\]:(?=[ \t]*\r?\n)/
const ESCAPED_LINE_BREAK_RE = /\\r\\n|\\n|\\r/gu

export const normalizeEscapedMessageLineBreaks = (content: string) => (
  content.replace(ESCAPED_LINE_BREAK_RE, '\n')
)

export const escapeLeadingUserMarkdownReferenceDefinition = (content: string) => (
  content.replace(LEADING_REFERENCE_DEFINITION_RE, '\\[$1]:')
)

export const prepareMarkdownMessageContent = (content: string, options: {
  escapeLeadingUserReferenceDefinition?: boolean
} = {}) => {
  const normalized = normalizeEscapedMessageLineBreaks(content)
  return options.escapeLeadingUserReferenceDefinition === true
    ? escapeLeadingUserMarkdownReferenceDefinition(normalized)
    : normalized
}
