export interface SenderEditorSelection {
  start: number
  end: number
}

export interface SenderEditorHandle {
  focus: () => void
  replaceSelection: (text: string, selection?: SenderEditorSelection | null) => void
  setValue: (value: string, selection?: SenderEditorSelection | null) => void
  setSelection: (selection: SenderEditorSelection) => void
  getSelection: () => SenderEditorSelection | null
  getValue: () => string
  isDisabled: () => boolean
}
