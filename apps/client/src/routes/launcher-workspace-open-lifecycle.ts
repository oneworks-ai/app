import { createContext } from 'react'
import type { Dispatch, SetStateAction } from 'react'

export interface LauncherOpeningWorkspace {
  name: string
  path: string
}

export interface LauncherWorkspaceOpenLease {
  isCurrent: () => boolean
  onInvalidate: (cleanup: () => void) => () => void
}

export interface LauncherActivationObserver extends LauncherWorkspaceOpenLease {
  release: () => void
}

interface LauncherWorkspaceOpenLeaseInternal extends LauncherWorkspaceOpenLease {
  invalidate: () => void
}

interface LauncherWorkspaceOpenAttempt {
  lease: LauncherWorkspaceOpenLease
  opening: LauncherOpeningWorkspace
}

export interface LauncherWorkspaceOpenController {
  acquire: () => LauncherWorkspaceOpenLease
  invalidate: (options?: { clearOpening?: boolean }) => void
  observeActivation: () => LauncherActivationObserver
  open: <Result>(input: {
    clearDelayMs?: number
    execute: () => Promise<Result>
    lease: LauncherWorkspaceOpenLease
    onError: (error: unknown) => void
    onSuccess: (result: Result) => void
    opening: LauncherOpeningWorkspace
  }) => Promise<boolean>
}

export const createLauncherWorkspaceOpenController = (input: {
  setOpeningWorkspace: Dispatch<SetStateAction<LauncherOpeningWorkspace | undefined>>
}): LauncherWorkspaceOpenController => {
  let activationGeneration = 0
  const activationObservers = new Set<LauncherWorkspaceOpenLeaseInternal>()
  let currentAttempt: LauncherWorkspaceOpenAttempt | undefined
  let currentLease: LauncherWorkspaceOpenLeaseInternal | undefined

  const clearAttempt = (attempt: LauncherWorkspaceOpenAttempt) => {
    if (currentAttempt !== attempt || currentLease !== attempt.lease) return
    currentAttempt = undefined
    input.setOpeningWorkspace(current => current === attempt.opening ? undefined : current)
  }

  const invalidateCurrentLease = (options: { clearOpening?: boolean } = {}) => {
    const lease = currentLease
    currentLease = undefined
    const attempt = currentAttempt
    currentAttempt = undefined
    if (attempt != null && options.clearOpening !== false) {
      input.setOpeningWorkspace(current => current === attempt.opening ? undefined : current)
    }
    lease?.invalidate()
  }

  const invalidate: LauncherWorkspaceOpenController['invalidate'] = (options = {}) => {
    invalidateCurrentLease(options)
    activationGeneration += 1
    const observers = [...activationObservers]
    activationObservers.clear()
    observers.forEach(observer => observer.invalidate())
  }

  const acquire: LauncherWorkspaceOpenController['acquire'] = () => {
    invalidateCurrentLease()
    const invalidationCleanups = new Set<() => void>()
    const lease: LauncherWorkspaceOpenLeaseInternal = {
      invalidate: () => {
        const cleanups = [...invalidationCleanups]
        invalidationCleanups.clear()
        cleanups.forEach(cleanup => cleanup())
      },
      isCurrent: () => currentLease === lease,
      onInvalidate: (cleanup) => {
        if (currentLease !== lease) {
          cleanup()
          return () => undefined
        }
        invalidationCleanups.add(cleanup)
        return () => invalidationCleanups.delete(cleanup)
      }
    }
    currentLease = lease
    return lease
  }

  const observeActivation: LauncherWorkspaceOpenController['observeActivation'] = () => {
    const generation = activationGeneration
    const invalidationCleanups = new Set<() => void>()
    let observer!: LauncherWorkspaceOpenLeaseInternal
    const release = () => {
      if (!activationObservers.delete(observer)) return
      observer.invalidate()
    }
    observer = {
      invalidate: () => {
        const cleanups = [...invalidationCleanups]
        invalidationCleanups.clear()
        cleanups.forEach(cleanup => cleanup())
      },
      isCurrent: () => activationGeneration === generation && activationObservers.has(observer),
      onInvalidate: (cleanup) => {
        if (activationGeneration !== generation || !activationObservers.has(observer)) {
          cleanup()
          return () => undefined
        }
        invalidationCleanups.add(cleanup)
        return () => invalidationCleanups.delete(cleanup)
      }
    }
    activationObservers.add(observer)
    return { ...observer, release }
  }

  const open: LauncherWorkspaceOpenController['open'] = async (attemptInput) => {
    if (!attemptInput.lease.isCurrent() || currentLease !== attemptInput.lease) return false

    const attempt: LauncherWorkspaceOpenAttempt = {
      lease: attemptInput.lease,
      opening: { ...attemptInput.opening }
    }
    currentAttempt = attempt
    input.setOpeningWorkspace(attempt.opening)

    try {
      const result = await attemptInput.execute()
      if (!attempt.lease.isCurrent() || currentAttempt !== attempt) return false

      attemptInput.onSuccess(result)
      if (!attempt.lease.isCurrent() || currentAttempt !== attempt) return true

      const clearDelayMs = attemptInput.clearDelayMs ?? 0
      if (clearDelayMs > 0) {
        globalThis.setTimeout(() => clearAttempt(attempt), clearDelayMs)
      } else {
        clearAttempt(attempt)
      }
      return true
    } catch (error) {
      if (!attempt.lease.isCurrent() || currentAttempt !== attempt) return false

      attemptInput.onError(error)
      clearAttempt(attempt)
      return true
    }
  }

  return { acquire, invalidate, observeActivation, open }
}

export interface LauncherWorkspaceOpenControllerOwner {
  attach: (controller: LauncherWorkspaceOpenController) => () => void
  current: () => LauncherWorkspaceOpenController | undefined
  invalidate: () => void
}

export const createLauncherWorkspaceOpenControllerOwner = (): LauncherWorkspaceOpenControllerOwner => {
  let controller: LauncherWorkspaceOpenController | undefined
  return {
    attach: (nextController) => {
      controller = nextController
      return () => {
        if (controller === nextController) controller = undefined
      }
    },
    current: () => controller,
    invalidate: () => controller?.invalidate()
  }
}

export const LauncherWorkspaceOpenControllerOwnerContext = createContext<
  LauncherWorkspaceOpenControllerOwner | undefined
>(undefined)
