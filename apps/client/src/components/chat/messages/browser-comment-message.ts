export interface BrowserCommentMessageItem {
  comment: string
  pageTitle?: string
  pageUrl?: string
  screenshotUrl?: string
  targetLabel: string
}

export interface BrowserCommentMessage {
  comments: BrowserCommentMessageItem[]
  remainingText: string
}

const BROWSER_COMMENT_HEADING_PATTERN = /^# Browser comment\s*$/m
const BROWSER_COMMENT_SCREENSHOT_NAME_PREFIX = 'browser-comment-screenshot-'

export const isBrowserCommentScreenshotName = (name?: string | null) =>
  name?.startsWith(BROWSER_COMMENT_SCREENSHOT_NAME_PREFIX) === true

export const createBrowserCommentScreenshotName = (index: number) =>
  `${BROWSER_COMMENT_SCREENSHOT_NAME_PREFIX}${index + 1}.png`

const readLineValue = (block: string, label: string) => {
  const match = new RegExp(`^${label}:\\s*(.*)$`, 'm').exec(block)
  const value = match?.[1]?.trim()
  return value == null || value === '' || value === 'unavailable' || value === '(unknown)' ? undefined : value
}

const readCommentValue = (block: string) => {
  const match = /^Comment:\s*\n([\s\S]*)$/m.exec(block)
  const value = match?.[1]?.trim()
  return value == null || value === '' ? undefined : value
}

const getTargetLabel = (block: string) => {
  const targetText = readLineValue(block, 'Target text')
  if (targetText != null) return targetText

  const targetPath = readLineValue(block, 'Target path')
  if (targetPath != null) {
    const pathParts = targetPath.split('>').map(part => part.trim()).filter(Boolean)
    return pathParts.at(-1) ?? targetPath
  }

  return readLineValue(block, 'Target selector') ?? readLineValue(block, 'Page title')
}

const parseBrowserCommentBlock = (block: string): BrowserCommentMessageItem | null => {
  if (!BROWSER_COMMENT_HEADING_PATTERN.test(block)) return null
  const comment = readCommentValue(block)
  if (comment == null) return null

  return {
    comment,
    pageTitle: readLineValue(block, 'Page title'),
    pageUrl: readLineValue(block, 'Page URL'),
    targetLabel: getTargetLabel(block) ?? ''
  }
}

export const parseBrowserCommentMessage = (content: string): BrowserCommentMessage | null => {
  if (!content.includes('# Browser comment')) return null
  const blocks = content
    .split(/(?=^# Browser comment\s*$)/m)
    .filter(block => block !== '')

  const comments: BrowserCommentMessageItem[] = []
  const remainingBlocks: string[] = []
  for (const block of blocks) {
    const parsedBlock = parseBrowserCommentBlock(block.trim())
    if (parsedBlock == null) {
      const remainingBlock = block.trim()
      if (remainingBlock !== '') remainingBlocks.push(remainingBlock)
      continue
    }
    comments.push(parsedBlock)
  }

  if (comments.length === 0 && remainingBlocks.length === 0) return null

  return {
    comments,
    remainingText: remainingBlocks.join('\n\n').trim()
  }
}

export const getBrowserCommentMessageComments = (content: string) => parseBrowserCommentMessage(content)?.comments ?? []
