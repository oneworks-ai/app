import { useEffect, useRef, useState } from 'react'

export function useRetainedValue<T>(value: T | null | undefined, exitDurationMs: number) {
  const hasValue = value != null
  const retainedValueRef = useRef<T | null>(null)
  const [isExitComplete, setIsExitComplete] = useState(false)

  if (hasValue) {
    retainedValueRef.current = value
  }

  useEffect(() => {
    if (hasValue) {
      setIsExitComplete(false)
      return
    }

    if (retainedValueRef.current == null) return

    setIsExitComplete(false)
    const timerId = window.setTimeout(() => {
      retainedValueRef.current = null
      setIsExitComplete(true)
    }, exitDurationMs)

    return () => {
      window.clearTimeout(timerId)
    }
  }, [exitDurationMs, hasValue])

  return hasValue || !isExitComplete ? retainedValueRef.current : null
}
