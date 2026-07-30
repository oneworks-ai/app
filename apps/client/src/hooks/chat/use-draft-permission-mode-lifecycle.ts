import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'

import type { DraftPermissionModeIncarnation, DraftPermissionModeLifecycle } from './permission-mode-acknowledgement'
import {
  createDraftPermissionModeLifecycle,
  retireDraftPermissionModeLifecycle
} from './permission-mode-acknowledgement'

export const useDraftPermissionModeLifecycle = ({
  incarnation,
  ownerIdentity
}: {
  incarnation: DraftPermissionModeIncarnation
  ownerIdentity?: string
}): DraftPermissionModeLifecycle => {
  const lifecycle = useMemo(
    () => createDraftPermissionModeLifecycle({ incarnation, ownerIdentity }),
    [incarnation, ownerIdentity]
  )
  const committedLifecycleRef = useRef(lifecycle)

  useLayoutEffect(() => {
    const previousLifecycle = committedLifecycleRef.current
    committedLifecycleRef.current = lifecycle
    if (previousLifecycle !== lifecycle) {
      retireDraftPermissionModeLifecycle(previousLifecycle)
    }
  }, [lifecycle])

  useEffect(() => {
    return () => retireDraftPermissionModeLifecycle(committedLifecycleRef.current)
  }, [])

  return lifecycle
}
