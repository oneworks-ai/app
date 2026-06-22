export interface PendingImage {
  id: string
  url: string
  name?: string
  size?: number
  mimeType?: string
}

export interface PendingContextFile {
  path: string
  name?: string
  size?: number
}

export interface PendingAnnotationTarget {
  frameUrl: string
  kind: 'element' | 'point'
  marker?: {
    x: number
    y: number
  }
  nodeText?: string
  rect: {
    height: number
    width: number
    x: number
    y: number
  }
  selector?: string
  style?: {
    borderRadius?: string
  }
  targetPath: string
  viewport: {
    height: number
    width: number
  }
}

export interface PendingAnnotation {
  comment: string
  evidence: string
  id: string
  screenshotDataUrl?: string
  sourcePageId?: string
  target?: PendingAnnotationTarget
  targetLabel: string
}

export interface PendingAnnotationPreviewState {
  activeAnnotationId?: string | null
  isActive: boolean
}

export interface AnnotationReferenceRequest {
  annotations: PendingAnnotation[]
  id: number
}

export interface PendingTextSelection {
  id: string
  sourceLabel?: string
  text: string
}

export interface TextSelectionReferenceRequest {
  id: number
  selections: PendingTextSelection[]
}

export interface PendingReferenceDraft {
  pendingImages: PendingImage[]
  pendingFiles: PendingContextFile[]
  pendingAnnotations: PendingAnnotation[]
  pendingTextSelections: PendingTextSelection[]
}

export interface PendingReferenceDraftRequest extends PendingReferenceDraft {
  id: number
}

export interface SenderComposerState {
  input: string
  pendingImages: PendingImage[]
  pendingFiles: PendingContextFile[]
  pendingAnnotations: PendingAnnotation[]
  pendingTextSelections: PendingTextSelection[]
}
