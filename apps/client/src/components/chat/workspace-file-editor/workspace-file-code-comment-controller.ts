/* eslint-disable max-lines -- Monaco gutter comment affordances and view zones need a single controller for synced lifecycle. */
import type { IMouseEvent, Selection, editor as MonacoEditorNamespace } from 'monaco-editor'

import type {
  PendingFileComment,
  PendingFileCommentRange,
  PendingFileCommentSelection
} from '#~/components/chat/sender/@types/sender-composer'
import { monacoApi } from '#~/components/monaco/monaco-runtime'
import { isImeComposingKeyboardEvent } from '#~/utils/shortcutUtils'

import {
  createPendingWorkspaceFileComment,
  createWorkspaceFileCommentId,
  normalizeWorkspaceFileSelectedText
} from './workspace-file-comments'

type MonacoCodeEditor = MonacoEditorNamespace.IStandaloneCodeEditor
type MonacoDecorationCollection = MonacoEditorNamespace.IEditorDecorationsCollection

export interface WorkspaceFileCodeCommentLabels {
  addComment: string
  cancel: string
  commentingLines: (segments: string) => string
  confirm: string
  emptyLine: string
  lineSegment: (lineNumber: number) => string
  lineSegmentRange: (startLineNumber: number, endLineNumber: number) => string
  lineSegmentSeparator: string
  placeholder: string
  sourceEditor: string
}

export interface WorkspaceFileCodeCommentControllerOptions {
  isMarkdown: boolean
  labels: WorkspaceFileCodeCommentLabels
  onDraftStateChange?: (state: WorkspaceFileCodeCommentDraftState) => void
  onReferenceFileComments?: (comments: PendingFileComment[]) => void
  path: string
}

export interface WorkspaceFileCodeCommentDraftState {
  hasContent: boolean
  hasDraft: boolean
}

interface WorkspaceFileCodeCommentTarget {
  afterLineNumber: number
  range?: PendingFileCommentRange
  selections: PendingFileCommentSelection[]
  selectedText: string
}

interface WorkspaceFileCodeCommentLineClickOptions {
  isRangeSelection: boolean
  isToggleSelection: boolean
}

interface WorkspaceFileCodeCommentZone {
  confirmButton: HTMLButtonElement
  confirmedComment: string
  domNode: HTMLElement
  id: string
  isConfirmed: boolean
  row: HTMLElement
  statusLabel: HTMLElement
  target: WorkspaceFileCodeCommentTarget
  textarea: HTMLTextAreaElement
  viewZone: MonacoEditorNamespace.IViewZone
  zoneId: string | null
}

const COMMENT_ZONE_MIN_HEIGHT = 42
const COMMENT_ZONE_MAX_TEXTAREA_HEIGHT = 112
const COMMENT_ZONE_VERTICAL_CHROME = 10
const COMMENT_ZONE_HORIZONTAL_INSET = 8

const toPendingFileCommentRange = (
  selection: Selection
): PendingFileCommentRange => ({
  endColumn: selection.endColumn,
  endLineNumber: selection.endLineNumber,
  startColumn: selection.startColumn,
  startLineNumber: selection.startLineNumber
})

const compareSelections = (a: PendingFileCommentSelection, b: PendingFileCommentSelection) => {
  const aRange = a.range
  const bRange = b.range
  if (aRange == null || bRange == null) return 0
  return aRange.startLineNumber === bRange.startLineNumber
    ? aRange.startColumn - bRange.startColumn
    : aRange.startLineNumber - bRange.startLineNumber
}

const getRangeKey = (range?: PendingFileCommentRange) => (
  range == null
    ? 'no-range'
    : `${range.startLineNumber}:${range.startColumn}-${range.endLineNumber}:${range.endColumn}`
)

const getTargetLineRanges = (target: WorkspaceFileCodeCommentTarget) => {
  const ranges = target.selections
    .map(selection => selection.range)
    .filter((range): range is PendingFileCommentRange => range != null)
    .map(range => ({
      end: Math.max(range.startLineNumber, range.endLineNumber),
      start: Math.min(range.startLineNumber, range.endLineNumber)
    }))
    .sort((a, b) => a.start - b.start)
  if (ranges.length === 0) return [{ end: 1, start: 1 }]

  const mergedRanges: Array<{ end: number; start: number }> = []
  let currentStart = ranges[0]?.start ?? 1
  let currentEnd = ranges[0]?.end ?? currentStart
  for (const range of ranges.slice(1)) {
    if (range.start <= currentEnd + 1) {
      currentEnd = Math.max(currentEnd, range.end)
      continue
    }
    mergedRanges.push({ end: currentEnd, start: currentStart })
    currentStart = range.start
    currentEnd = range.end
  }
  mergedRanges.push({ end: currentEnd, start: currentStart })
  return mergedRanges
}

const getTargetLineCount = (target: WorkspaceFileCodeCommentTarget) => {
  const ranges = getTargetLineRanges(target)
  return ranges.reduce((count, range) => count + range.end - range.start + 1, 0)
}

const getTargetLineStatus = (
  target: WorkspaceFileCodeCommentTarget,
  labels: WorkspaceFileCodeCommentLabels
) => {
  const segments = getTargetLineRanges(target)
    .map(range =>
      range.start === range.end
        ? labels.lineSegment(range.start)
        : labels.lineSegmentRange(range.start, range.end)
    )
    .join(labels.lineSegmentSeparator)
  return labels.commentingLines(segments)
}

const isGutterMouseTarget = (targetType: number) => (
  targetType === monacoApi.editor.MouseTargetType.GUTTER_LINE_NUMBERS ||
  targetType === monacoApi.editor.MouseTargetType.GUTTER_LINE_DECORATIONS
)

const isLineNumberMouseTarget = (targetType: number) => (
  targetType === monacoApi.editor.MouseTargetType.GUTTER_LINE_NUMBERS ||
  targetType === monacoApi.editor.MouseTargetType.GUTTER_LINE_DECORATIONS
)

const isLineInsideRange = (lineNumber: number, range: PendingFileCommentRange) => (
  lineNumber >= range.startLineNumber && lineNumber <= range.endLineNumber
)

const getMouseTargetLineNumber = (event: MonacoEditorNamespace.IEditorMouseEvent) => {
  const targetWithRange = event.target as typeof event.target & {
    range?: { startLineNumber?: number }
  }
  return event.target.position?.lineNumber ?? targetWithRange.range?.startLineNumber ?? null
}

const getAdjustedSelection = (
  model: MonacoEditorNamespace.ITextModel,
  selection: Selection
) => {
  if (selection.endColumn !== 1 || selection.endLineNumber <= selection.startLineNumber) {
    return selection
  }

  const endLineNumber = selection.endLineNumber - 1
  return selection.setEndPosition(endLineNumber, model.getLineMaxColumn(endLineNumber))
}

export class WorkspaceFileCodeCommentController {
  private readonly decorationCollection: MonacoDecorationCollection
  private readonly disposables: Array<{ dispose: () => void }> = []
  private readonly editor: MonacoCodeEditor
  private readonly hoverLineDecorationCollection: MonacoDecorationCollection
  private readonly zones = new Map<string, WorkspaceFileCodeCommentZone>()
  private activeDraftZoneId: string | null = null
  private hoverLineNumber: number | null = null
  private lineSelectionAnchorNumber: number | null = null
  private options: WorkspaceFileCodeCommentControllerOptions
  private readonly selectedLineNumbers = new Set<number>()

  constructor(editor: MonacoCodeEditor, options: WorkspaceFileCodeCommentControllerOptions) {
    this.editor = editor
    this.options = options
    this.decorationCollection = editor.createDecorationsCollection()
    this.hoverLineDecorationCollection = editor.createDecorationsCollection()
    this.updateLineNumberRenderer()
    const editorDomNode = editor.getDomNode()
    if (editorDomNode != null) {
      const handleDomMouseMove = (event: MouseEvent) => this.handleDomLineNumberMouseMove(event)
      const handleDomMouseDown = (event: MouseEvent) => this.handleDomLineNumberMouseDown(event)
      editorDomNode.addEventListener('mousemove', handleDomMouseMove, true)
      editorDomNode.addEventListener('mousedown', handleDomMouseDown, true)
      this.disposables.push({
        dispose: () => {
          editorDomNode.removeEventListener('mousemove', handleDomMouseMove, true)
          editorDomNode.removeEventListener('mousedown', handleDomMouseDown, true)
        }
      })
    }
    this.disposables.push(
      editor.onMouseMove(event => this.handleMouseMove(event)),
      editor.onMouseDown(event => this.handleMouseDown(event)),
      editor.onMouseLeave(() => this.hideLineNumberCommentAction()),
      editor.onDidLayoutChange(() => this.updateInlineZoneWidths()),
      editor.onDidScrollChange(() => this.updateInlineZoneWidths()),
      editor.onDidChangeModel(() => this.clear())
    )
  }

  clear() {
    this.hideLineNumberCommentAction()
    this.resetLineSelection()
    for (const zone of this.zones.values()) {
      this.removeZone(zone)
    }
    this.zones.clear()
    this.updateDecorations()
    this.emitDraftStateChange()
  }

  dispose() {
    this.clear()
    this.editor.updateOptions({ lineNumbers: 'on' })
    for (const disposable of this.disposables) {
      disposable.dispose()
    }
    this.disposables.length = 0
  }

  syncPendingFileComments(comments: PendingFileComment[]) {
    const pendingComments = comments.filter(comment => comment.path === this.options.path)
    const pendingIds = new Set(pendingComments.map(comment => comment.id))

    for (const comment of pendingComments) {
      const target = this.createTargetFromPendingComment(comment)
      if (target != null) {
        this.upsertZone({
          comment: comment.comment,
          id: comment.id,
          isConfirmed: true,
          target
        })
      }
    }

    for (const zone of Array.from(this.zones.values())) {
      if (zone.isConfirmed && !pendingIds.has(zone.id)) {
        this.removeZone(zone)
        this.zones.delete(zone.id)
      }
    }
    this.updateDecorations()
  }

  updateOptions(options: WorkspaceFileCodeCommentControllerOptions) {
    const shouldClear = options.path !== this.options.path
    this.options = options
    if (shouldClear || options.onReferenceFileComments == null) {
      this.clear()
      return
    }
    this.emitDraftStateChange()
  }

  private buildLineSelection(lineNumber: number): PendingFileCommentSelection | null {
    const model = this.editor.getModel()
    if (model == null) return null

    const safeLineNumber = Math.min(Math.max(lineNumber, 1), model.getLineCount())
    const lineText = model.getLineContent(safeLineNumber)
    const selectedText = normalizeWorkspaceFileSelectedText(lineText)
    return {
      range: {
        endColumn: model.getLineMaxColumn(safeLineNumber),
        endLineNumber: safeLineNumber,
        startColumn: 1,
        startLineNumber: safeLineNumber
      },
      selectedText: selectedText === '' ? this.options.labels.emptyLine : selectedText
    }
  }

  private buildTargetFromLineNumbers(lineNumbers: Iterable<number>): WorkspaceFileCodeCommentTarget | null {
    const selections = Array.from(new Set(lineNumbers))
      .sort((a, b) => a - b)
      .map(lineNumber => this.buildLineSelection(lineNumber))
      .filter((selection): selection is PendingFileCommentSelection => selection != null)
    return this.createTargetFromSelections(selections)
  }

  private buildSelection(selection: Selection): PendingFileCommentSelection | null {
    const model = this.editor.getModel()
    if (model == null) return null
    if (selection.isEmpty()) {
      return this.buildLineSelection(selection.positionLineNumber)
    }

    const adjustedSelection = getAdjustedSelection(model, selection)
    const selectedText = normalizeWorkspaceFileSelectedText(model.getValueInRange(adjustedSelection))
    if (selectedText === '') return null
    return {
      range: toPendingFileCommentRange(adjustedSelection),
      selectedText
    }
  }

  private buildTarget(lineNumber: number): WorkspaceFileCodeCommentTarget | null {
    const selections = this.editor.getSelections() ?? []
    const selectionTargets = selections.length > 1
      ? selections.map(selection => this.buildSelection(selection)).filter((
        selection
      ): selection is PendingFileCommentSelection => selection != null)
      : []
    if (selectionTargets.length > 0) {
      return this.createTargetFromSelections(selectionTargets)
    }

    const selection = this.editor.getSelection()
    const selectionTarget = selection == null || selection.isEmpty()
      ? null
      : this.buildSelection(selection)
    if (
      selectionTarget?.range != null &&
      isLineInsideRange(lineNumber, selectionTarget.range)
    ) {
      return this.createTargetFromSelections([selectionTarget])
    }

    const lineSelection = this.buildLineSelection(lineNumber)
    return lineSelection == null ? null : this.createTargetFromSelections([lineSelection])
  }

  private confirmZone(zone: WorkspaceFileCodeCommentZone) {
    const comment = zone.textarea.value.trim()
    if (comment === '') return

    zone.isConfirmed = true
    zone.confirmedComment = comment
    zone.confirmButton.disabled = false
    this.options.onReferenceFileComments?.([
      createPendingWorkspaceFileComment({
        comment,
        id: zone.id,
        isMarkdown: this.options.isMarkdown,
        path: this.options.path,
        range: zone.target.range,
        selections: zone.target.selections,
        selectedText: zone.target.selectedText,
        sourceLabel: this.options.labels.sourceEditor
      })
    ])
    if (zone.id === this.activeDraftZoneId) {
      this.resetLineSelection()
    }
    this.updateDecorations()
    this.emitDraftStateChange()
  }

  private createCommentZoneDomNode(
    zoneId: string,
    initialComment: string,
    target: WorkspaceFileCodeCommentTarget
  ) {
    const root = document.createElement('div')
    root.className = 'workspace-file-editor__inline-comment-zone'
    this.applyInlineZoneWidth(root)

    const row = document.createElement('div')
    row.className = 'workspace-file-editor__inline-comment-row'

    const textarea = document.createElement('textarea')
    textarea.className = 'workspace-file-editor__inline-comment-input'
    textarea.rows = 1
    textarea.placeholder = this.options.labels.placeholder
    textarea.value = initialComment

    const status = document.createElement('div')
    status.className = 'workspace-file-editor__inline-comment-status'
    const statusIcon = document.createElement('span')
    statusIcon.className = 'material-symbols-rounded'
    statusIcon.setAttribute('aria-hidden', 'true')
    statusIcon.textContent = 'chat_bubble'
    const statusLabel = document.createElement('span')
    statusLabel.className = 'workspace-file-editor__inline-comment-status-label'
    statusLabel.textContent = getTargetLineStatus(target, this.options.labels)
    status.append(statusIcon, statusLabel)

    const cancelButton = document.createElement('button')
    cancelButton.type = 'button'
    cancelButton.className = 'workspace-file-editor__inline-comment-icon-button'
    cancelButton.setAttribute('aria-label', this.options.labels.cancel)
    const cancelIcon = document.createElement('span')
    cancelIcon.className = 'material-symbols-rounded'
    cancelIcon.setAttribute('aria-hidden', 'true')
    cancelIcon.textContent = 'close'
    const cancelLabel = document.createElement('span')
    cancelLabel.className = 'workspace-file-editor__inline-comment-button-label'
    cancelLabel.textContent = this.options.labels.cancel
    cancelButton.append(cancelIcon, cancelLabel)

    const confirmButton = document.createElement('button')
    confirmButton.type = 'button'
    confirmButton.className = 'workspace-file-editor__inline-comment-submit'
    confirmButton.disabled = initialComment.trim() === ''
    confirmButton.setAttribute('aria-label', this.options.labels.confirm)
    const confirmIcon = document.createElement('span')
    confirmIcon.className = 'material-symbols-rounded'
    confirmIcon.setAttribute('aria-hidden', 'true')
    confirmIcon.textContent = 'check'
    const confirmLabel = document.createElement('span')
    confirmLabel.className = 'workspace-file-editor__inline-comment-button-label'
    confirmLabel.textContent = this.options.labels.confirm
    confirmButton.append(confirmIcon, confirmLabel)

    const isInteractiveTarget = (target: EventTarget | null) => (
      target instanceof Node &&
      (textarea.contains(target) || cancelButton.contains(target) || confirmButton.contains(target))
    )
    let isComposing = false
    let compositionEndTimer: number | null = null
    const markCompositionStart = () => {
      if (compositionEndTimer != null) {
        window.clearTimeout(compositionEndTimer)
        compositionEndTimer = null
      }
      isComposing = true
    }
    const markCompositionEnd = () => {
      if (compositionEndTimer != null) {
        window.clearTimeout(compositionEndTimer)
      }
      compositionEndTimer = window.setTimeout(() => {
        isComposing = false
        compositionEndTimer = null
      }, 0)
    }
    const handleZonePointerDown = (event: PointerEvent) => {
      event.stopPropagation()
      if (isInteractiveTarget(event.target)) return
      event.preventDefault()
      textarea.focus()
    }
    const stopEditorMouseHandling = (event: Event) => {
      event.stopPropagation()
    }
    root.addEventListener('pointerdown', handleZonePointerDown)
    root.addEventListener('mousedown', stopEditorMouseHandling)
    root.addEventListener('mouseup', stopEditorMouseHandling)
    root.addEventListener('click', stopEditorMouseHandling)
    root.addEventListener('dblclick', stopEditorMouseHandling)
    row.addEventListener('pointerdown', handleZonePointerDown)
    for (const interactiveElement of [textarea, cancelButton, confirmButton]) {
      interactiveElement.addEventListener('pointerdown', stopEditorMouseHandling)
      interactiveElement.addEventListener('mousedown', stopEditorMouseHandling)
      interactiveElement.addEventListener('mouseup', stopEditorMouseHandling)
      interactiveElement.addEventListener('click', stopEditorMouseHandling)
    }
    textarea.addEventListener('input', () => {
      confirmButton.disabled = textarea.value.trim() === ''
      this.resizeZone(zoneId)
      this.emitDraftStateChange()
    })
    textarea.addEventListener('compositionstart', markCompositionStart)
    textarea.addEventListener('compositionend', markCompositionEnd)
    textarea.addEventListener('keydown', (event) => {
      if (isImeComposingKeyboardEvent(event, isComposing)) return

      if (event.key === 'Escape') {
        event.preventDefault()
        this.cancelZone(zoneId)
        return
      }

      if (event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault()
        const zone = this.zones.get(zoneId)
        if (zone != null) {
          this.confirmZone(zone)
        }
      }
    })
    cancelButton.addEventListener('click', (event) => {
      event.stopPropagation()
      this.cancelZone(zoneId)
    })
    confirmButton.addEventListener('click', (event) => {
      event.stopPropagation()
      const zone = this.zones.get(zoneId)
      if (zone != null) {
        this.confirmZone(zone)
      }
    })

    row.append(textarea, status, cancelButton, confirmButton)
    root.append(row)

    return { confirmButton, root, row, statusLabel, textarea }
  }

  private createTargetFromPendingComment(comment: PendingFileComment): WorkspaceFileCodeCommentTarget | null {
    const selections = comment.selections?.length
      ? comment.selections
      : [{
        range: comment.range,
        selectedText: comment.selectedText
      }]

    return this.createTargetFromSelections(selections)
  }

  private createTargetFromSelections(selections: PendingFileCommentSelection[]): WorkspaceFileCodeCommentTarget | null {
    const dedupedSelections = Array.from(
      new Map(selections.map(selection => [getRangeKey(selection.range), selection])).values()
    )
      .filter(selection => selection.selectedText.trim() !== '')
      .sort(compareSelections)
    if (dedupedSelections.length === 0) return null

    const rangeSelections = dedupedSelections.filter(selection => selection.range != null)
    const afterLineNumber = Math.max(
      ...rangeSelections.map(selection => selection.range?.endLineNumber ?? 1),
      1
    )

    return {
      afterLineNumber,
      range: dedupedSelections.length === 1 ? dedupedSelections[0]?.range : rangeSelections[0]?.range,
      selections: dedupedSelections,
      selectedText: dedupedSelections.map(selection => selection.selectedText).join('\n\n')
    }
  }

  private cancelZone(zoneId: string) {
    const zone = this.zones.get(zoneId)
    if (zone == null) return
    if (zone.isConfirmed) {
      zone.textarea.value = zone.confirmedComment
      zone.confirmButton.disabled = zone.confirmedComment.trim() === ''
      this.editor.focus()
      return
    }

    this.removeZone(zone)
    this.zones.delete(zoneId)
    if (zoneId === this.activeDraftZoneId) {
      this.resetLineSelection()
    }
    this.updateDecorations()
    this.emitDraftStateChange()
    this.editor.focus()
  }

  private emitDraftStateChange() {
    const activeDraftZone = this.activeDraftZoneId == null ? null : this.zones.get(this.activeDraftZoneId)
    if (activeDraftZone == null || activeDraftZone.isConfirmed) {
      this.options.onDraftStateChange?.({ hasContent: false, hasDraft: false })
      return
    }
    this.options.onDraftStateChange?.({
      hasContent: activeDraftZone.textarea.value.trim() !== '',
      hasDraft: true
    })
  }

  private getLineClickOptions(event: MouseEvent | IMouseEvent): WorkspaceFileCodeCommentLineClickOptions {
    return {
      isRangeSelection: event.shiftKey,
      isToggleSelection: event.metaKey || event.ctrlKey
    }
  }

  private getLineNumberFromDomEvent(event: MouseEvent) {
    if (!(event.target instanceof Element)) return null
    const lineNumberElement = event.target.closest('.line-numbers')
    const editorDomNode = this.editor.getDomNode()
    if (lineNumberElement == null || editorDomNode == null || !editorDomNode.contains(lineNumberElement)) {
      return null
    }

    const parsedLineNumber = Number.parseInt(lineNumberElement.textContent ?? '', 10)
    return Number.isFinite(parsedLineNumber) ? parsedLineNumber : this.hoverLineNumber
  }

  private handleDomLineNumberMouseDown(event: MouseEvent) {
    if (this.options.onReferenceFileComments == null) return
    const lineNumber = this.getLineNumberFromDomEvent(event)
    if (lineNumber == null) return

    event.preventDefault()
    event.stopPropagation()
    this.openCommentZone(lineNumber, this.getLineClickOptions(event))
  }

  private handleDomLineNumberMouseMove(event: MouseEvent) {
    if (this.options.onReferenceFileComments == null) {
      this.hideLineNumberCommentAction()
      return
    }
    const lineNumber = this.getLineNumberFromDomEvent(event)
    if (lineNumber == null) return
    this.showLineNumberCommentAction(lineNumber)
  }

  private handleMouseMove(event: MonacoEditorNamespace.IEditorMouseEvent) {
    if (this.options.onReferenceFileComments == null) {
      this.hideLineNumberCommentAction()
      return
    }

    const lineNumber = getMouseTargetLineNumber(event)
    if (!isGutterMouseTarget(event.target.type) || lineNumber == null) {
      this.hideLineNumberCommentAction()
      return
    }

    this.showLineNumberCommentAction(lineNumber)
  }

  private handleMouseDown(event: MonacoEditorNamespace.IEditorMouseEvent) {
    const lineNumber = getMouseTargetLineNumber(event)
    if (
      this.options.onReferenceFileComments == null ||
      lineNumber == null ||
      !isLineNumberMouseTarget(event.target.type)
    ) {
      return
    }

    event.event.preventDefault()
    event.event.stopPropagation()
    this.openCommentZone(lineNumber, this.getLineClickOptions(event.event))
  }

  private hideLineNumberCommentAction() {
    this.hoverLineNumber = null
    this.hoverLineDecorationCollection.clear()
    this.updateLineNumberRenderer()
  }

  private openCommentZone(lineNumber: number, options: WorkspaceFileCodeCommentLineClickOptions) {
    const target = this.updateLineSelectionTarget(lineNumber, options)
    if (target == null) return

    this.hideLineNumberCommentAction()
    const existingDraftZone = this.activeDraftZoneId == null ? null : this.zones.get(this.activeDraftZoneId)
    const draftComment = existingDraftZone?.textarea.value ?? ''
    if (existingDraftZone == null) {
      for (const zone of Array.from(this.zones.values())) {
        if (!zone.isConfirmed) {
          this.removeZone(zone)
          this.zones.delete(zone.id)
        }
      }
    }

    const zoneId = existingDraftZone?.id ?? createWorkspaceFileCommentId()
    this.activeDraftZoneId = zoneId
    const zone = this.upsertZone({
      comment: draftComment,
      id: zoneId,
      isConfirmed: false,
      target
    })
    this.updateDecorations()
    this.emitDraftStateChange()
    window.setTimeout(() => zone.textarea.focus(), 0)
    this.editor.revealLineInCenterIfOutsideViewport(target.afterLineNumber)
  }

  private resetLineSelection() {
    this.activeDraftZoneId = null
    this.lineSelectionAnchorNumber = null
    this.selectedLineNumbers.clear()
  }

  private updateLineSelectionTarget(
    lineNumber: number,
    options: WorkspaceFileCodeCommentLineClickOptions
  ) {
    if (!options.isRangeSelection && !options.isToggleSelection) {
      this.selectedLineNumbers.clear()
      this.selectedLineNumbers.add(lineNumber)
      this.lineSelectionAnchorNumber = lineNumber
      this.activeDraftZoneId = null
      return this.buildTargetFromLineNumbers(this.selectedLineNumbers)
    }

    if (options.isRangeSelection) {
      const anchorLineNumber = this.lineSelectionAnchorNumber ?? lineNumber
      const startLineNumber = Math.min(anchorLineNumber, lineNumber)
      const endLineNumber = Math.max(anchorLineNumber, lineNumber)
      if (!options.isToggleSelection) {
        this.selectedLineNumbers.clear()
      }
      for (let currentLineNumber = startLineNumber; currentLineNumber <= endLineNumber; currentLineNumber += 1) {
        this.selectedLineNumbers.add(currentLineNumber)
      }
      this.lineSelectionAnchorNumber = anchorLineNumber
      return this.buildTargetFromLineNumbers(this.selectedLineNumbers)
    }

    if (this.selectedLineNumbers.has(lineNumber) && this.selectedLineNumbers.size > 1) {
      this.selectedLineNumbers.delete(lineNumber)
    } else {
      this.selectedLineNumbers.add(lineNumber)
    }
    this.lineSelectionAnchorNumber = lineNumber
    return this.buildTargetFromLineNumbers(this.selectedLineNumbers)
  }

  private removeZone(zone: WorkspaceFileCodeCommentZone) {
    if (zone.zoneId != null) {
      const zoneId = zone.zoneId
      zone.zoneId = null
      this.editor.changeViewZones((accessor) => {
        accessor.removeZone(zoneId)
      })
    }
    zone.domNode.remove()
  }

  private applyInlineZoneWidth(root: HTMLElement) {
    const layoutInfo = this.editor.getLayoutInfo()
    const visibleContentWidth = Math.max(
      160,
      layoutInfo.contentWidth - COMMENT_ZONE_HORIZONTAL_INSET
    )
    const scrollLeft = this.editor.getScrollLeft()
    root.style.setProperty('--workspace-file-editor-inline-comment-width', `${visibleContentWidth}px`)
    root.style.transform = scrollLeft === 0 ? '' : `translateX(${scrollLeft}px)`
  }

  private resizeZone(zoneId: string) {
    const zone = this.zones.get(zoneId)
    if (zone == null || zone.zoneId == null) return

    zone.textarea.style.height = '0px'
    const textareaHeight = Math.min(
      COMMENT_ZONE_MAX_TEXTAREA_HEIGHT,
      Math.max(28, zone.textarea.scrollHeight)
    )
    zone.textarea.style.height = `${textareaHeight}px`
    zone.row.classList.toggle('is-multiline', textareaHeight > 32 || getTargetLineCount(zone.target) > 1)

    const nextHeight = Math.max(COMMENT_ZONE_MIN_HEIGHT, zone.row.scrollHeight + COMMENT_ZONE_VERTICAL_CHROME)
    if (zone.viewZone.heightInPx === nextHeight) return
    zone.viewZone.heightInPx = nextHeight
    this.editor.changeViewZones((accessor) => {
      if (zone.zoneId != null) {
        accessor.layoutZone(zone.zoneId)
      }
    })
  }

  private updateInlineZoneWidths() {
    for (const zone of this.zones.values()) {
      this.applyInlineZoneWidth(zone.domNode)
    }
  }

  private renderLineNumber(lineNumber: number) {
    return lineNumber === this.hoverLineNumber ? 'add_comment' : String(lineNumber)
  }

  private showLineNumberCommentAction(lineNumber: number) {
    if (this.hoverLineNumber === lineNumber) return
    this.hoverLineNumber = lineNumber
    this.hoverLineDecorationCollection.set([{
      options: {
        lineNumberClassName: 'workspace-file-editor__line-number-comment-action',
        stickiness: monacoApi.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
      },
      range: {
        endColumn: 1,
        endLineNumber: lineNumber,
        startColumn: 1,
        startLineNumber: lineNumber
      }
    }])
    this.updateLineNumberRenderer()
  }

  private updateLineNumberRenderer() {
    this.editor.updateOptions({
      lineNumbers: lineNumber => this.renderLineNumber(lineNumber)
    })
  }

  private updateDecorations() {
    this.decorationCollection.set(
      Array.from(this.zones.values()).flatMap(zone =>
        zone.target.selections.flatMap(selection =>
          selection.range == null
            ? []
            : [{
              options: {
                className: 'workspace-file-editor__comment-line',
                isWholeLine: true,
                lineNumberClassName: 'workspace-file-editor__comment-line-number',
                linesDecorationsClassName: 'workspace-file-editor__comment-lines-decoration',
                marginClassName: 'workspace-file-editor__comment-margin',
                stickiness: monacoApi.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
              },
              range: selection.range
            }]
        )
      )
    )
  }

  private upsertZone({
    comment,
    id,
    isConfirmed,
    target
  }: {
    comment: string
    id: string
    isConfirmed: boolean
    target: WorkspaceFileCodeCommentTarget
  }) {
    const existingZone = this.zones.get(id)
    if (existingZone != null) {
      existingZone.target = target
      existingZone.isConfirmed = isConfirmed
      existingZone.confirmedComment = comment
      existingZone.statusLabel.textContent = getTargetLineStatus(target, this.options.labels)
      if (existingZone.zoneId != null && existingZone.viewZone.afterLineNumber !== target.afterLineNumber) {
        const oldZoneId = existingZone.zoneId
        existingZone.zoneId = null
        existingZone.viewZone.afterLineNumber = target.afterLineNumber
        this.editor.changeViewZones((accessor) => {
          accessor.removeZone(oldZoneId)
          existingZone.zoneId = accessor.addZone(existingZone.viewZone)
        })
      }
      if (document.activeElement !== existingZone.textarea) {
        existingZone.textarea.value = comment
        existingZone.confirmButton.disabled = comment.trim() === ''
      }
      this.resizeZone(id)
      return existingZone
    }

    const { confirmButton, root, row, statusLabel, textarea } = this.createCommentZoneDomNode(id, comment, target)
    const viewZone: MonacoEditorNamespace.IViewZone = {
      afterLineNumber: target.afterLineNumber,
      domNode: root,
      heightInPx: COMMENT_ZONE_MIN_HEIGHT,
      ordinal: 10_000,
      suppressMouseDown: false
    }
    const zone: WorkspaceFileCodeCommentZone = {
      confirmButton,
      confirmedComment: comment,
      domNode: root,
      id,
      isConfirmed,
      row,
      statusLabel,
      target,
      textarea,
      viewZone,
      zoneId: null
    }
    this.editor.changeViewZones((accessor) => {
      zone.zoneId = accessor.addZone(viewZone)
    })
    this.zones.set(id, zone)
    this.resizeZone(id)
    return zone
  }
}
