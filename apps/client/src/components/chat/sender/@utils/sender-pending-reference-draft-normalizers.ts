/* eslint-disable max-lines -- pending reference draft normalization keeps related attachment schemas together. */
import type {
  PendingAnnotation,
  PendingAnnotationTarget,
  PendingContextFile,
  PendingFileComment,
  PendingFileCommentRange,
  PendingFileCommentSelection,
  PendingImage,
  PendingReferenceDraft,
  PendingTextSelection
} from '../@types/sender-composer'

const createEmptyNormalizedDraft = (): PendingReferenceDraft => ({
  pendingImages: [],
  pendingFiles: [],
  pendingAnnotations: [],
  pendingTextSelections: [],
  pendingFileComments: []
})

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value != null && !Array.isArray(value)
)

const readStringField = (value: Record<string, unknown>, key: string) => (
  typeof value[key] === 'string' ? value[key] as string : ''
)

const readOptionalStringField = (value: Record<string, unknown>, key: string) => {
  const field = value[key]
  return typeof field === 'string' && field !== '' ? field : undefined
}

const readOptionalNumberField = (value: Record<string, unknown>, key: string) => {
  const field = value[key]
  return typeof field === 'number' && Number.isFinite(field) ? field : undefined
}

const readNumberField = (value: Record<string, unknown>, key: string) => {
  const field = value[key]
  return typeof field === 'number' && Number.isFinite(field) ? field : 0
}

const createDraftItemId = (prefix: string, index: number) => `${prefix}-${index}`

const normalizePendingAnnotationTarget = (value: unknown): PendingAnnotationTarget | undefined => {
  if (!isRecord(value) || !isRecord(value.rect) || !isRecord(value.viewport)) return undefined
  const kind = readStringField(value, 'kind')
  if (kind !== 'element' && kind !== 'point') return undefined
  const borderRadius = isRecord(value.style)
    ? readOptionalStringField(value.style, 'borderRadius')
    : undefined

  return {
    frameUrl: readStringField(value, 'frameUrl'),
    kind,
    marker: isRecord(value.marker)
      ? {
        x: readNumberField(value.marker, 'x'),
        y: readNumberField(value.marker, 'y')
      }
      : undefined,
    nodeText: readOptionalStringField(value, 'nodeText'),
    rect: {
      height: readNumberField(value.rect, 'height'),
      width: readNumberField(value.rect, 'width'),
      x: readNumberField(value.rect, 'x'),
      y: readNumberField(value.rect, 'y')
    },
    selector: readOptionalStringField(value, 'selector'),
    style: borderRadius == null ? undefined : { borderRadius },
    targetPath: readStringField(value, 'targetPath'),
    viewport: {
      height: readNumberField(value.viewport, 'height'),
      width: readNumberField(value.viewport, 'width')
    }
  }
}

const normalizePendingImages = (value: unknown): PendingImage[] => {
  if (!Array.isArray(value)) return []

  return value.flatMap((item, index): PendingImage[] => {
    if (!isRecord(item)) return []
    const url = readStringField(item, 'url').trim()
    if (url === '') return []
    return [{
      id: readStringField(item, 'id') || createDraftItemId('pending-image-draft', index),
      url,
      name: readOptionalStringField(item, 'name'),
      size: readOptionalNumberField(item, 'size'),
      mimeType: readOptionalStringField(item, 'mimeType')
    }]
  })
}

const normalizePendingFiles = (value: unknown): PendingContextFile[] => {
  if (!Array.isArray(value)) return []

  return value.flatMap((item): PendingContextFile[] => {
    if (!isRecord(item)) return []
    const path = readStringField(item, 'path').trim()
    if (path === '') return []
    return [{
      path,
      name: readOptionalStringField(item, 'name'),
      size: readOptionalNumberField(item, 'size')
    }]
  })
}

const normalizePendingAnnotations = (value: unknown): PendingAnnotation[] => {
  if (!Array.isArray(value)) return []

  return value.flatMap((item, index): PendingAnnotation[] => {
    if (!isRecord(item)) return []
    const comment = readStringField(item, 'comment').trim()
    const evidence = readStringField(item, 'evidence').trim()
    if (comment === '' && evidence === '') return []
    return [{
      id: readStringField(item, 'id') || createDraftItemId('pending-annotation-draft', index),
      comment,
      evidence,
      screenshotDataUrl: readOptionalStringField(item, 'screenshotDataUrl'),
      sourcePageId: readOptionalStringField(item, 'sourcePageId'),
      target: normalizePendingAnnotationTarget(item.target),
      targetLabel: readStringField(item, 'targetLabel')
    }]
  })
}

const normalizePendingTextSelections = (value: unknown): PendingTextSelection[] => {
  if (!Array.isArray(value)) return []

  return value.flatMap((item, index): PendingTextSelection[] => {
    if (!isRecord(item)) return []
    const text = readStringField(item, 'text').trim()
    if (text === '') return []
    return [{
      id: readStringField(item, 'id') || createDraftItemId('pending-text-selection-draft', index),
      sourceLabel: readOptionalStringField(item, 'sourceLabel'),
      text
    }]
  })
}

const normalizePendingFileCommentRange = (value: unknown): PendingFileCommentRange | undefined => {
  if (!isRecord(value)) return undefined
  const startLineNumber = readNumberField(value, 'startLineNumber')
  const startColumn = readNumberField(value, 'startColumn')
  const endLineNumber = readNumberField(value, 'endLineNumber')
  const endColumn = readNumberField(value, 'endColumn')
  if (startLineNumber <= 0 || startColumn <= 0 || endLineNumber <= 0 || endColumn <= 0) return undefined

  return {
    endColumn,
    endLineNumber,
    startColumn,
    startLineNumber
  }
}

const normalizePendingFileCommentSelections = (value: unknown): PendingFileCommentSelection[] => {
  if (!Array.isArray(value)) return []

  return value.flatMap((item): PendingFileCommentSelection[] => {
    if (!isRecord(item)) return []
    const selectedText = readStringField(item, 'selectedText').trim()
    if (selectedText === '') return []
    return [{
      range: normalizePendingFileCommentRange(item.range),
      selectedText
    }]
  })
}

const normalizePendingFileComments = (value: unknown): PendingFileComment[] => {
  if (!Array.isArray(value)) return []

  return value.flatMap((item, index): PendingFileComment[] => {
    if (!isRecord(item)) return []
    const path = readStringField(item, 'path').trim()
    const selectedText = readStringField(item, 'selectedText').trim()
    const selections = normalizePendingFileCommentSelections(item.selections)
    const comment = readStringField(item, 'comment').trim()
    const targetLabel = readOptionalStringField(item, 'targetLabel')
    if (path === '' || (selectedText === '' && selections.length === 0 && comment === '' && targetLabel == null)) {
      return []
    }
    return [{
      id: readStringField(item, 'id') || createDraftItemId('pending-file-comment-draft', index),
      comment,
      isMarkdown: item.isMarkdown === true,
      path,
      range: normalizePendingFileCommentRange(item.range),
      selections: selections.length > 1 ? selections : undefined,
      selectedText: selectedText === ''
        ? selections.map(selection => selection.selectedText).join('\n\n')
        : selectedText,
      sourceLabel: readOptionalStringField(item, 'sourceLabel'),
      targetLabel
    }]
  })
}

export const normalizePendingReferenceDraft = (value: unknown): PendingReferenceDraft => {
  if (!isRecord(value)) return createEmptyNormalizedDraft()

  return {
    pendingImages: normalizePendingImages(value.pendingImages),
    pendingFiles: normalizePendingFiles(value.pendingFiles),
    pendingAnnotations: normalizePendingAnnotations(value.pendingAnnotations),
    pendingTextSelections: normalizePendingTextSelections(value.pendingTextSelections),
    pendingFileComments: normalizePendingFileComments(value.pendingFileComments)
  }
}
