import {
  disposeCodexRuntimeBrokerDriver,
  initializeCodexRuntimeBrokerDriver,
  scheduleCodexRuntimeBrokerWarmup
} from './codex'

export const initializeRuntimeBrokerDrivers = async () => {
  await initializeCodexRuntimeBrokerDriver()
}

export const scheduleRuntimeBrokerWarmup = () => {
  scheduleCodexRuntimeBrokerWarmup()
}

export const disposeRuntimeBrokerDrivers = () => {
  disposeCodexRuntimeBrokerDriver()
}
