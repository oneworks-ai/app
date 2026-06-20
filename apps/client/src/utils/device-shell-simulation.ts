/* eslint-disable max-lines -- dev shell simulation centralizes query parsing, storage, and subscriptions. */

import { useSyncExternalStore } from 'react'

export const DEVICE_SHELL_SIMULATION_QUERY_PARAM = '__oneworks_device'
export const DESKTOP_SHELL_SIMULATION_QUERY_PARAM = '__oneworks_desktop'
export const DEV_SHELL_KIND_STORAGE_KEY = 'oneworks_dev_shell_kind'
export const DEV_SHELL_OS_STORAGE_KEY = 'oneworks_dev_shell_os'

const DEV_SHELL_SIMULATION_CHANGE_EVENT = 'oneworks:dev-shell-simulation-change'

export type DeviceShellSimulationMode = 'android' | 'ios'
export type DesktopShellSimulationMode = 'macos' | 'windows'
export type DevShellKind = 'electron' | 'mobile' | 'web'
export type DevShellOs = 'android' | 'ios' | 'linux' | 'macos' | 'windows'

export interface DevShellSimulationState {
  shellKind: DevShellKind
  os?: DevShellOs
}

const DEFAULT_DEV_SHELL_SIMULATION: DevShellSimulationState = { shellKind: 'web' }
let cachedStoredDevShellSimulationKey: string | undefined
let cachedStoredDevShellSimulation = DEFAULT_DEV_SHELL_SIMULATION

const getStorage = () => {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

const emitDevShellSimulationChange = () => {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(DEV_SHELL_SIMULATION_CHANGE_EVENT))
}

const normalizeDevShellKind = (value: string | null | undefined): DevShellKind | null => {
  const normalizedValue = value?.trim().toLowerCase()
  if (normalizedValue == null || normalizedValue === '') return null
  if (normalizedValue === 'electron' || normalizedValue === 'desktop') return 'electron'
  if (normalizedValue === 'mobile' || normalizedValue === 'phone' || normalizedValue === 'device') return 'mobile'
  if (normalizedValue === 'web' || normalizedValue === 'browser') return 'web'
  return null
}

const normalizeDevShellOs = (value: string | null | undefined): DevShellOs | null => {
  const normalizedValue = value?.trim().toLowerCase()
  if (normalizedValue == null || normalizedValue === '') return null

  if (normalizedValue === 'android') return 'android'
  if (normalizedValue === 'ios' || normalizedValue === 'iphone' || normalizedValue === 'ipad') return 'ios'
  if (normalizedValue === 'linux') return 'linux'
  if (
    normalizedValue === 'mac' ||
    normalizedValue === 'macos' ||
    normalizedValue === 'darwin'
  ) {
    return 'macos'
  }
  if (
    normalizedValue === 'win' ||
    normalizedValue === 'windows' ||
    normalizedValue === 'win32'
  ) {
    return 'windows'
  }

  return null
}

export const parseDeviceShellSimulationValue = (
  value: string | null
): DeviceShellSimulationMode | null => {
  if (value == null) return null

  const normalizedValue = value.trim().toLowerCase()
  if (
    normalizedValue === '' ||
    normalizedValue === '1' ||
    normalizedValue === 'true' ||
    normalizedValue === 'yes' ||
    normalizedValue === 'android' ||
    normalizedValue === 'mobile' ||
    normalizedValue === 'phone'
  ) {
    return 'android'
  }

  if (
    normalizedValue === 'ios' ||
    normalizedValue === 'iphone' ||
    normalizedValue === 'ipad'
  ) {
    return 'ios'
  }

  return null
}

export const parseDesktopShellSimulationValue = (
  value: string | null
): DesktopShellSimulationMode | null => {
  if (value == null) return null

  const normalizedValue = value.trim().toLowerCase()
  if (
    normalizedValue === '' ||
    normalizedValue === '1' ||
    normalizedValue === 'true' ||
    normalizedValue === 'mac' ||
    normalizedValue === 'macos' ||
    normalizedValue === 'darwin'
  ) {
    return 'macos'
  }

  if (
    normalizedValue === 'win' ||
    normalizedValue === 'windows' ||
    normalizedValue === 'win32'
  ) {
    return 'windows'
  }

  return null
}

export const readQueryDevShellSimulation = (search: string): DevShellSimulationState | null => {
  try {
    const searchParams = new URLSearchParams(search)
    const deviceMode = parseDeviceShellSimulationValue(searchParams.get(DEVICE_SHELL_SIMULATION_QUERY_PARAM))
    if (deviceMode != null) {
      return { shellKind: 'mobile', os: deviceMode }
    }

    const desktopMode = parseDesktopShellSimulationValue(searchParams.get(DESKTOP_SHELL_SIMULATION_QUERY_PARAM))
    if (desktopMode != null) {
      return { shellKind: 'electron', os: desktopMode }
    }

    return null
  } catch {
    return null
  }
}

const normalizeDevShellSimulation = (
  input: Partial<DevShellSimulationState> | null | undefined
): DevShellSimulationState => {
  const shellKind = normalizeDevShellKind(input?.shellKind) ?? 'web'

  if (shellKind === 'electron') {
    const os = normalizeDevShellOs(input?.os) ?? 'macos'
    return {
      shellKind,
      os: os === 'windows' ? 'windows' : 'macos'
    }
  }

  if (shellKind === 'mobile') {
    const os = normalizeDevShellOs(input?.os) ?? 'android'
    return {
      shellKind,
      os: os === 'ios' ? 'ios' : 'android'
    }
  }

  return DEFAULT_DEV_SHELL_SIMULATION
}

export const readStoredDevShellSimulation = (): DevShellSimulationState => {
  const storage = getStorage()
  const rawShellKind = storage?.getItem(DEV_SHELL_KIND_STORAGE_KEY)
  const rawOs = storage?.getItem(DEV_SHELL_OS_STORAGE_KEY)
  const storageKey = `${rawShellKind ?? ''}\u0000${rawOs ?? ''}`
  if (storageKey === cachedStoredDevShellSimulationKey) {
    return cachedStoredDevShellSimulation
  }

  cachedStoredDevShellSimulationKey = storageKey
  const shellKind = normalizeDevShellKind(rawShellKind)
  if (shellKind == null || shellKind === 'web') {
    cachedStoredDevShellSimulation = DEFAULT_DEV_SHELL_SIMULATION
    return cachedStoredDevShellSimulation
  }

  cachedStoredDevShellSimulation = normalizeDevShellSimulation({
    shellKind,
    os: normalizeDevShellOs(rawOs) ?? undefined
  })
  return cachedStoredDevShellSimulation
}

export const writeStoredDevShellSimulation = (simulation: Partial<DevShellSimulationState>) => {
  const storage = getStorage()
  const nextSimulation = normalizeDevShellSimulation(simulation)

  if (nextSimulation.shellKind === 'web') {
    storage?.removeItem(DEV_SHELL_KIND_STORAGE_KEY)
    storage?.removeItem(DEV_SHELL_OS_STORAGE_KEY)
  } else {
    storage?.setItem(DEV_SHELL_KIND_STORAGE_KEY, nextSimulation.shellKind)
    storage?.setItem(DEV_SHELL_OS_STORAGE_KEY, nextSimulation.os ?? '')
  }

  emitDevShellSimulationChange()
  return nextSimulation
}

export const readDevShellSimulation = (
  search: string,
  storedSimulation: DevShellSimulationState = readStoredDevShellSimulation()
) => readQueryDevShellSimulation(search) ?? storedSimulation

export const readDeviceShellSimulationMode = (
  search: string,
  storedSimulation: DevShellSimulationState = readStoredDevShellSimulation()
) => {
  const simulation = readDevShellSimulation(search, storedSimulation)
  return simulation.shellKind === 'mobile'
    ? simulation.os === 'ios' ? 'ios' : 'android'
    : null
}

export const readDesktopShellSimulationMode = (
  search: string,
  storedSimulation: DevShellSimulationState = readStoredDevShellSimulation()
) => {
  const simulation = readDevShellSimulation(search, storedSimulation)
  return simulation.shellKind === 'electron'
    ? simulation.os === 'windows' ? 'windows' : 'macos'
    : null
}

const subscribeStoredDevShellSimulation = (listener: () => void) => {
  if (typeof window === 'undefined') return () => undefined

  const handleStorageChange = (event: StorageEvent) => {
    if (
      event.key === DEV_SHELL_KIND_STORAGE_KEY ||
      event.key === DEV_SHELL_OS_STORAGE_KEY
    ) {
      listener()
    }
  }

  window.addEventListener(DEV_SHELL_SIMULATION_CHANGE_EVENT, listener)
  window.addEventListener('storage', handleStorageChange)
  return () => {
    window.removeEventListener(DEV_SHELL_SIMULATION_CHANGE_EVENT, listener)
    window.removeEventListener('storage', handleStorageChange)
  }
}

export const useStoredDevShellSimulation = () =>
  useSyncExternalStore(
    subscribeStoredDevShellSimulation,
    readStoredDevShellSimulation,
    () => DEFAULT_DEV_SHELL_SIMULATION
  )
