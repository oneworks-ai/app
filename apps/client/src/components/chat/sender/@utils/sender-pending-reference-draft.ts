import type {
  PendingAnnotation,
  PendingAnnotationTarget,
  PendingContextFile,
  PendingImage,
  PendingReferenceDraft,
  PendingTextSelection
} from '../@types/sender-composer'

const senderPendingReferenceDraftStorageKeyPrefix = 'oneworks.chat.senderPendingReferenceDraft:'

export const getSenderPendingReferenceDraftStorageKey = (sessionId: string) => (
  `${senderPendingReferenceDraftStorageKeyPrefix}${sessionId}`
)

export const createEmptyPendingReferenceDraft = (): PendingReferenceDraft => ({
  pendingImages: [],
  pendingFiles: [],
  pendingAnnotations: [],
  pendingTextSelections: []
})

export const hasPendingReferenceDraft = (draft: PendingReferenceDraft) => (
  draft.pendingImages.length > 0 ||
  draft.pendingFiles.length > 0 ||
  draft.pendingAnnotations.length > 0 ||
  draft.pendingTextSelections.length > 0
)

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

const normalizePendingReferenceDraft = (value: unknown): PendingReferenceDraft => {
  if (!isRecord(value)) return createEmptyPendingReferenceDraft()

  return {
    pendingImages: normalizePendingImages(value.pendingImages),
    pendingFiles: normalizePendingFiles(value.pendingFiles),
    pendingAnnotations: normalizePendingAnnotations(value.pendingAnnotations),
    pendingTextSelections: normalizePendingTextSelections(value.pendingTextSelections)
  }
}

export const readPendingReferenceDraft = (storageKey: string): PendingReferenceDraft => {
  if (typeof window === 'undefined') return createEmptyPendingReferenceDraft()

  try {
    return normalizePendingReferenceDraft(JSON.parse(window.localStorage.getItem(storageKey) ?? 'null'))
  } catch {
    return createEmptyPendingReferenceDraft()
  }
}

export const writePendingReferenceDraft = (storageKey: string, draft: PendingReferenceDraft) => {
  if (typeof window === 'undefined') return

  try {
    if (!hasPendingReferenceDraft(draft)) {
      window.localStorage.removeItem(storageKey)
      return
    }
    window.localStorage.setItem(storageKey, JSON.stringify(draft))
  } catch {
    try {
      window.localStorage.removeItem(storageKey)
    } catch {
      // Ignore storage failures; the live composer state remains authoritative.
    }
  }
}
