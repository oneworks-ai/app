import type { Config } from '@oneworks/types'

export interface InteractionPanelRunCommand {
  cwd?: string
  env?: InteractionPanelRunCommandEnvVar[]
  icon?: string
  id: string
  isFavorite?: boolean
  name: string
  script: string
}

export interface InteractionPanelRunCommandEnvVar {
  key: string
  value: string
}

export interface InteractionPanelRunCommandTaskStatus {
  commandId: string
  isRunning: boolean
  terminalId: string
}

const buildLastRunCommandStorageKey = (sessionId: string) => `chatInteractionLastRunCommand:${sessionId}`

const createRunCommandId = () => `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
const DEFAULT_RUN_COMMAND_ICON = 'terminal'
const FALLBACK_RUN_COMMAND_TITLE = 'run'
const RUN_COMMAND_SCRIPT_TITLE_LENGTH = 20
const ENV_KEY_PATTERN = /^[a-z_]\w*$/i

const normalizeText = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const normalizeLooseText = (value: unknown) => typeof value === 'string' ? value : ''
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`

const normalizeRunCommandEnv = (value: unknown): InteractionPanelRunCommandEnvVar[] => {
  if (!Array.isArray(value)) return []

  const seenKeys = new Set<string>()
  const env: InteractionPanelRunCommandEnvVar[] = []
  for (const item of value) {
    if (item == null || typeof item !== 'object' || Array.isArray(item)) continue
    const candidate = item as Partial<InteractionPanelRunCommandEnvVar>
    const key = normalizeText(candidate.key)
    if (!ENV_KEY_PATTERN.test(key) || seenKeys.has(key)) continue
    seenKeys.add(key)
    env.push({
      key,
      value: normalizeLooseText(candidate.value)
    })
  }

  return env
}

const normalizeRunCommand = (value: unknown): InteractionPanelRunCommand | null => {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Partial<InteractionPanelRunCommand>
  const script = normalizeText(candidate.script)
  if (script === '') return null

  const name = normalizeText(candidate.name)
  const cwd = normalizeText(candidate.cwd)
  const env = normalizeRunCommandEnv(candidate.env)
  const icon = normalizeText(candidate.icon) || DEFAULT_RUN_COMMAND_ICON
  return {
    ...(cwd !== '' ? { cwd } : {}),
    ...(env.length > 0 ? { env } : {}),
    id: normalizeText(candidate.id) || createRunCommandId(),
    icon,
    ...(candidate.isFavorite === true ? { isFavorite: true } : {}),
    name,
    script
  }
}

export const createInteractionPanelRunCommand = (): InteractionPanelRunCommand => ({
  icon: DEFAULT_RUN_COMMAND_ICON,
  id: createRunCommandId(),
  name: '',
  script: ''
})

export const cloneInteractionPanelRunCommand = (command: InteractionPanelRunCommand): InteractionPanelRunCommand => ({
  ...(command.cwd != null ? { cwd: command.cwd } : {}),
  ...(command.env != null ? { env: command.env.map(item => ({ ...item })) } : {}),
  ...(command.icon != null ? { icon: command.icon } : {}),
  id: command.id,
  ...(command.isFavorite === true ? { isFavorite: true } : {}),
  name: command.name,
  script: command.script
})

export const getInteractionPanelRunCommandIcon = (command?: InteractionPanelRunCommand) =>
  normalizeText(command?.icon) || DEFAULT_RUN_COMMAND_ICON

export const getInteractionPanelRunCommandTitle = (command?: InteractionPanelRunCommand) => {
  if (command == null) return FALLBACK_RUN_COMMAND_TITLE
  const name = normalizeText(command.name)
  if (name !== '') return name

  const firstLine = command.script.split(/\r?\n/).map(item => item.trim()).find(Boolean) ?? ''
  const title = Array.from(firstLine).slice(0, RUN_COMMAND_SCRIPT_TITLE_LENGTH).join('').trim()
  return title || FALLBACK_RUN_COMMAND_TITLE
}

export const buildInteractionPanelRunCommandScript = (command: InteractionPanelRunCommand) => {
  const cwd = normalizeText(command.cwd)
  const cwdCommand = cwd === '' ? [] : [`cd ${shellQuote(cwd)}`]
  const exports = (command.env ?? [])
    .filter(item => ENV_KEY_PATTERN.test(item.key.trim()))
    .map(item => `export ${item.key.trim()}=${shellQuote(item.value)}`)

  return [...cwdCommand, ...exports, command.script].join('\n')
}

export const buildInteractionPanelRunCommandTaskScript = (script: string) => {
  const trimmedScript = script.trimEnd()
  return trimmedScript === '' ? '' : `${trimmedScript}\nexit $?`
}

export const normalizeInteractionPanelRunCommands = (value: unknown): InteractionPanelRunCommand[] => {
  if (!Array.isArray(value)) return []

  const seenIds = new Set<string>()
  const commands: InteractionPanelRunCommand[] = []
  for (const item of value) {
    const command = normalizeRunCommand(item)
    if (command == null) continue

    const id = seenIds.has(command.id) ? createRunCommandId() : command.id
    seenIds.add(id)
    commands.push({ ...command, id })
  }

  return commands
}

export const getInteractionPanelRunCommandsFromConfig = (
  conversation?: Config['conversation']
): InteractionPanelRunCommand[] => normalizeInteractionPanelRunCommands(conversation?.runCommands ?? [])

export const buildInteractionPanelRunCommandsConfigPatch = (
  conversation: Config['conversation'] | undefined,
  commands: InteractionPanelRunCommand[]
): Config['conversation'] => {
  const nextConversation = { ...(conversation ?? {}) }
  const normalizedCommands = normalizeInteractionPanelRunCommands(commands)
  if (normalizedCommands.length === 0) {
    delete nextConversation.runCommands
  } else {
    nextConversation.runCommands = normalizedCommands
  }

  return nextConversation
}

export const readInteractionPanelLastRunCommandId = (sessionId: string): string | null => {
  if (typeof window === 'undefined') return null

  try {
    return normalizeText(window.localStorage.getItem(buildLastRunCommandStorageKey(sessionId))) || null
  } catch {
    return null
  }
}

export const writeInteractionPanelLastRunCommandId = (
  sessionId: string,
  commandId: string | null
) => {
  if (typeof window === 'undefined') return

  try {
    if (commandId == null || commandId.trim() === '') {
      window.localStorage.removeItem(buildLastRunCommandStorageKey(sessionId))
      return
    }

    window.localStorage.setItem(buildLastRunCommandStorageKey(sessionId), commandId.trim())
  } catch {
    // Run command last-used state is best-effort UI state.
  }
}
