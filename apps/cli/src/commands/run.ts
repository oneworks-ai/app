import { getCliDefaultSkillNames, getCliDefaultSkillPluginConfig } from '#~/default-skill-plugin.js'
import { createAdapterOption, normalizeCliAdapterOptionValue, parseCliAdapterOptionValue } from './@core/adapter-option'
import { applyAdapterCliVersionEnv, persistAdapterCliVersionSelection } from './run/adapter-cli-version'
import { registerRunCommand } from './run/command'
import { parseCliInputControlEvent } from './run/input-control'
import {
  getDisallowedResumeFlags,
  resolveDefaultOneworksMcpServerOption,
  resolveInjectDefaultSystemPromptOption,
  resolveResumeAdapterOptions,
  resolveRunMode
} from './run/options'
import {
  getAdapterErrorMessage,
  getAdapterInteractionMessage,
  getPrintableAssistantText,
  handlePrintEvent,
  resolvePrintableStopText,
  shouldPrintResumeHint
} from './run/output'
import { createPrintIdleTimeoutController, parsePrintIdleTimeoutSeconds } from './run/print-idle-timeout'
import {
  executeRuntimeProtocolCommand,
  shouldStartRuntimeConsumer,
  shouldStartRuntimeResumeConsumer
} from './run/protocol'
import { runRuntimeProtocolStdio } from './run/protocol-stdio'
import { createSessionExitController } from './run/session-exit-controller'
import { RUN_INPUT_FORMATS, RUN_OUTPUT_FORMATS } from './run/types'

export {
  RUN_INPUT_FORMATS,
  RUN_OUTPUT_FORMATS,
  applyAdapterCliVersionEnv,
  createAdapterOption,
  createPrintIdleTimeoutController,
  createSessionExitController,
  executeRuntimeProtocolCommand,
  getAdapterErrorMessage,
  getAdapterInteractionMessage,
  getCliDefaultSkillNames,
  getCliDefaultSkillPluginConfig,
  getDisallowedResumeFlags,
  getPrintableAssistantText,
  handlePrintEvent,
  normalizeCliAdapterOptionValue,
  parseCliAdapterOptionValue,
  parseCliInputControlEvent,
  parsePrintIdleTimeoutSeconds,
  persistAdapterCliVersionSelection,
  registerRunCommand,
  resolveDefaultOneworksMcpServerOption,
  resolveInjectDefaultSystemPromptOption,
  resolvePrintableStopText,
  resolveResumeAdapterOptions,
  resolveRunMode,
  runRuntimeProtocolStdio,
  shouldPrintResumeHint,
  shouldStartRuntimeConsumer,
  shouldStartRuntimeResumeConsumer
}
export type { RunInputFormat, RunOptions, RunOutputFormat } from './run/types'
