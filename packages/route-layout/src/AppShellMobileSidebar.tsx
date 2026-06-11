import type { ReactNode, Ref, RefObject } from 'react'

interface AppShellMobileSidebarProps {
  backdropClassName?: string
  backdropOpenClassName?: string
  closeLabel: string
  isOpen: boolean
  onOpenChange: (nextOpen: boolean) => void
  routeSidebarAriaLabel: string
  sheetClassName?: string
  sheetId?: string
  sheetOpenClassName?: string
  sheetRef: RefObject<HTMLDivElement | null>
  sidebar: ReactNode
}

export function AppShellMobileSidebar({
  backdropClassName,
  backdropOpenClassName,
  closeLabel,
  isOpen,
  onOpenChange,
  routeSidebarAriaLabel,
  sheetClassName,
  sheetId,
  sheetOpenClassName,
  sheetRef,
  sidebar
}: AppShellMobileSidebarProps) {
  const backdropClasses = [
    backdropClassName,
    isOpen ? backdropOpenClassName : ''
  ].filter(Boolean).join(' ')
  const sheetClasses = [
    sheetClassName,
    isOpen ? sheetOpenClassName : ''
  ].filter(Boolean).join(' ')

  return (
    <>
      <button
        type='button'
        className={backdropClasses}
        aria-label={closeLabel}
        aria-hidden={!isOpen}
        tabIndex={-1}
        onClick={() => onOpenChange(false)}
      />
      <div
        ref={sheetRef as Ref<HTMLDivElement>}
        id={sheetId}
        className={sheetClasses}
        role='dialog'
        aria-modal={isOpen ? 'true' : undefined}
        aria-label={routeSidebarAriaLabel}
        aria-hidden={!isOpen}
        tabIndex={-1}
      >
        {sidebar}
      </div>
    </>
  )
}
