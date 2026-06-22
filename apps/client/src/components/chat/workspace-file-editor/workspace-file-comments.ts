import type {
  PendingFileComment,
  PendingFileCommentRange,
  PendingFileCommentSelection
} from '#~/components/chat/sender/@types/sender-composer'

export type WorkspaceFileCommentOverlayPlacement = 'above' | 'below'

export interface WorkspaceFileCommentOverlayAnchor {
  left: number
  placement: WorkspaceFileCommentOverlayPlacement
  top: number
}

export interface WorkspaceFileCommentSelection {
  anchor: WorkspaceFileCommentOverlayAnchor
  range?: PendingFileCommentRange
  selectedText: string
}

export const normalizeWorkspaceFileSelectedText = (value: string) => (
  value.replace(/\u00A0/g, ' ').trim()
)

export const createWorkspaceFileCommentId = () => {
  const randomId = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `workspace-file-comment-${randomId}`
}

export const createPendingWorkspaceFileComment = ({
  comment,
  id,
  isMarkdown,
  path,
  range,
  selections,
  selectedText,
  sourceLabel,
  targetLabel
}: {
  comment: string
  id?: string
  isMarkdown: boolean
  path: string
  range?: PendingFileCommentRange
  selections?: PendingFileCommentSelection[]
  selectedText: string
  sourceLabel?: string
  targetLabel?: string
}): PendingFileComment => {
  const normalizedSelections = selections
    ?.map(selection => ({
      range: selection.range,
      selectedText: normalizeWorkspaceFileSelectedText(selection.selectedText)
    }))
    .filter(selection => selection.selectedText !== '') ?? []
  const normalizedSelectedText = normalizeWorkspaceFileSelectedText(selectedText)
  const fallbackSelectedText = normalizedSelections.map(selection => selection.selectedText).join('\n\n')

  return {
    comment: comment.trim(),
    id: id ?? createWorkspaceFileCommentId(),
    isMarkdown,
    path,
    range: range ?? normalizedSelections[0]?.range,
    selections: normalizedSelections.length > 1 ? normalizedSelections : undefined,
    selectedText: normalizedSelectedText === '' ? fallbackSelectedText : normalizedSelectedText,
    sourceLabel,
    targetLabel: targetLabel?.trim() === '' ? undefined : targetLabel?.trim()
  }
}

export const getRangeVisibleRect = (range: Range) => {
  const rangeRect = range.getBoundingClientRect()
  if (rangeRect.width > 0 || rangeRect.height > 0) {
    return rangeRect
  }

  return Array.from(range.getClientRects()).find(rect => rect.width > 0 || rect.height > 0) ?? null
}

export const isSelectionNodeInside = (node: Node | null, root: HTMLElement) => {
  if (node == null) return false
  const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement
  return element != null && root.contains(element)
}

export const resolveFloatingAnchor = ({
  centerLeft,
  rectBottom,
  rectTop,
  width = 260
}: {
  centerLeft: number
  rectBottom: number
  rectTop: number
  width?: number
}): WorkspaceFileCommentOverlayAnchor => {
  const halfWidth = width / 2
  const minLeft = Math.min(halfWidth + 12, window.innerWidth / 2)
  const maxLeft = Math.max(window.innerWidth - halfWidth - 12, minLeft)
  const left = Math.min(Math.max(centerLeft, minLeft), maxLeft)
  const canPlaceAbove = rectTop >= 48

  return {
    left,
    placement: canPlaceAbove ? 'above' : 'below',
    top: canPlaceAbove ? rectTop - 8 : rectBottom + 8
  }
}
