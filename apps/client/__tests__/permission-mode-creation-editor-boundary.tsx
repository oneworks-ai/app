import { SenderToolbar } from '#~/components/chat/sender/@components/sender-toolbar/SenderToolbar'
import type {
  SenderToolbarData,
  SenderToolbarHandlers,
  SenderToolbarRefs,
  SenderToolbarState
} from '#~/components/chat/sender/@types/sender-toolbar-types'

export function PermissionModeCreationEditorBoundary({
  input,
  onInputChange,
  toolbarData,
  toolbarHandlers,
  toolbarRefs,
  toolbarState
}: {
  input: string
  onInputChange: (value: string, cursorOffset: number | null) => void
  toolbarData: SenderToolbarData
  toolbarHandlers: SenderToolbarHandlers
  toolbarRefs: SenderToolbarRefs
  toolbarState: SenderToolbarState
}) {
  return (
    <div>
      <output data-testid='creation-editor-value'>{input}</output>
      <button
        data-testid='fill-creation-editor'
        onClick={() => onInputChange('create the session', 18)}
      >
        fill
      </button>
      <SenderToolbar
        state={toolbarState}
        data={toolbarData}
        refs={toolbarRefs}
        handlers={toolbarHandlers}
      />
    </div>
  )
}
