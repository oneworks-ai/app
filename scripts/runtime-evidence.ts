/* eslint-disable max-lines -- runtime evidence helpers share filesystem discovery and wait semantics. */
import { access, readFile, readdir, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const DEFAULT_POLL_INTERVAL_MS = 1000

export interface RuntimeEvidenceDeps {
  now: () => number
  sleep: (ms: number) => Promise<void>
}

export interface RuntimeSessionEventFile {
  eventsPath: string
  sessionId: string
}

export interface RuntimeSessionProbe {
  assistantText?: string
  completed: boolean
  failed?: string
  lineCount: number
}

export interface RuntimeEvidenceSessionSummary extends RuntimeSessionEventFile, RuntimeSessionProbe {
  mtimeMs?: number
}

export interface RuntimeEvidenceWaitResult {
  assistantText?: string
  completed: boolean
  elapsedMs: number
  eventsPath?: string
  failed?: string
  message: string
  ok: boolean
  scannedFiles: number
  sessionId?: string
}

export interface RuntimeEvidenceWaitInput {
  expectedReply?: string
  homeDir?: string
  json?: boolean
  projectHome?: string
  sessionId?: string
  stdout?: Pick<NodeJS.WriteStream, 'write'>
  waitMs?: number
  setExitCode?: boolean
}

export interface RuntimeEvidenceListInput {
  homeDir?: string
  json?: boolean
  limit?: number
  projectHome?: string
  stdout?: Pick<NodeJS.WriteStream, 'write'>
}

const defaultDeps: RuntimeEvidenceDeps = {
  now: () => Date.now(),
  sleep: async (ms) => {
    await new Promise(resolve => setTimeout(resolve, ms))
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value != null && !Array.isArray(value)
)

const fileExists = async (filePath: string) => {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

const readProjectHomeCandidates = async (projectsDir: string) => {
  try {
    const entries = await readdir(projectsDir, { withFileTypes: true })
    return entries.filter(entry => entry.isDirectory()).map(entry => path.join(projectsDir, entry.name))
  } catch {
    return []
  }
}

const listSessionEventsInRuntimeRoot = async (runtimeRoot: string): Promise<RuntimeSessionEventFile[]> => {
  const sessionsDir = path.join(runtimeRoot, 'sessions')
  try {
    const entries = await readdir(sessionsDir, { withFileTypes: true })
    return entries
      .filter(entry => entry.isDirectory())
      .map(entry => ({
        sessionId: entry.name,
        eventsPath: path.join(sessionsDir, entry.name, 'events.jsonl')
      }))
  } catch {
    return []
  }
}

export const listCandidateSessionEventFiles = async (input: {
  homeDir: string
  projectHome?: string
}) => {
  const candidates: RuntimeSessionEventFile[] = []
  if (input.projectHome != null && input.projectHome.trim() !== '') {
    candidates.push(...await listSessionEventsInRuntimeRoot(path.resolve(input.projectHome, 'runtime')))
  }

  const projectsDir = path.join(input.homeDir, '.oneworks', 'projects')
  const projectHomes = await readProjectHomeCandidates(projectsDir)
  for (const projectHome of projectHomes) {
    candidates.push(...await listSessionEventsInRuntimeRoot(path.join(projectHome, 'runtime')))

    const mockProjectsDir = path.join(projectHome, '.mock', '.oneworks', 'projects')
    const mockProjectHomes = await readProjectHomeCandidates(mockProjectsDir)
    for (const mockProjectHome of mockProjectHomes) {
      candidates.push(...await listSessionEventsInRuntimeRoot(path.join(mockProjectHome, 'runtime')))
    }
  }

  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    if (seen.has(candidate.eventsPath)) return false
    seen.add(candidate.eventsPath)
    return true
  })
}

export const locateSessionEventsPath = async (input: {
  homeDir: string
  projectHome?: string
  sessionId: string
}) => {
  const candidates: string[] = []
  if (input.projectHome != null && input.projectHome.trim() !== '') {
    candidates.push(path.resolve(input.projectHome, 'runtime', 'sessions', input.sessionId, 'events.jsonl'))
  }

  const files = await listCandidateSessionEventFiles({
    homeDir: input.homeDir,
    projectHome: input.projectHome
  })
  candidates.push(...files.filter(file => file.sessionId === input.sessionId).map(file => file.eventsPath))

  for (const candidate of [...new Set(candidates)]) {
    if (await fileExists(candidate)) return candidate
  }
  return undefined
}

const messageContentToText = (content: unknown): string | undefined => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return undefined
  const parts = content.flatMap((item) => {
    if (!isRecord(item)) return []
    if (typeof item.text === 'string') return [item.text]
    if (typeof item.content === 'string') return [item.content]
    return []
  })
  return parts.length === 0 ? undefined : parts.join('')
}

const extractMessageRecord = (event: Record<string, unknown>) => {
  if (event.type !== 'message') return undefined
  if (typeof event.role === 'string') return event
  const message = event.message
  if (isRecord(message)) return message
  const data = event.data
  return isRecord(data) ? data : undefined
}

export const probeRuntimeSessionEvents = (content: string): RuntimeSessionProbe => {
  const probe: RuntimeSessionProbe = {
    completed: false,
    lineCount: 0
  }

  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (!isRecord(parsed)) continue
    probe.lineCount += 1

    const message = extractMessageRecord(parsed)
    if (message?.role === 'assistant') {
      const text = messageContentToText(message.content)
      if (text != null && text.trim() !== '') probe.assistantText = text.trim()
    }

    if (parsed.type === 'session_completed') {
      probe.completed = true
      const summary = messageContentToText(parsed.summary)
      if (probe.assistantText == null && summary != null && summary.trim() !== '') {
        probe.assistantText = summary.trim()
      }
    }

    if (parsed.type === 'session_failed' || parsed.type === 'command_failed') {
      probe.failed = typeof parsed.error === 'string'
        ? parsed.error
        : typeof parsed.message === 'string'
        ? parsed.message
        : parsed.type
    }
  }

  return probe
}

const readRuntimeSessionProbe = async (eventsPath: string) => {
  try {
    return probeRuntimeSessionEvents(await readFile(eventsPath, 'utf8'))
  } catch {
    return undefined
  }
}

const readRuntimeSessionMtimeMs = async (eventsPath: string) => {
  try {
    return (await stat(eventsPath)).mtimeMs
  } catch {
    return undefined
  }
}

export const listRuntimeEvidenceSessions = async (input: {
  homeDir?: string
  limit?: number
  projectHome?: string
}): Promise<RuntimeEvidenceSessionSummary[]> => {
  const files = await listCandidateSessionEventFiles({
    homeDir: input.homeDir ?? os.homedir(),
    projectHome: input.projectHome
  })
  const summaries = await Promise.all(files.map(async (file) => {
    const [probe, mtimeMs] = await Promise.all([
      readRuntimeSessionProbe(file.eventsPath),
      readRuntimeSessionMtimeMs(file.eventsPath)
    ])
    return {
      ...file,
      mtimeMs,
      ...(probe ?? {
        completed: false,
        lineCount: 0
      })
    }
  }))
  const sorted = summaries.sort((left, right) => {
    const byMtime = (right.mtimeMs ?? 0) - (left.mtimeMs ?? 0)
    return byMtime === 0 ? left.eventsPath.localeCompare(right.eventsPath) : byMtime
  })
  return input.limit == null || input.limit <= 0 ? sorted : sorted.slice(0, input.limit)
}

const buildWaitResult = (
  input: Omit<RuntimeEvidenceWaitResult, 'elapsedMs'>,
  startedAt: number,
  deps: RuntimeEvidenceDeps
): RuntimeEvidenceWaitResult => ({
  ...input,
  elapsedMs: deps.now() - startedAt
})

export const waitForRuntimeEvidenceReply = async (
  input: RuntimeEvidenceWaitInput,
  deps: RuntimeEvidenceDeps = defaultDeps
): Promise<RuntimeEvidenceWaitResult> => {
  const startedAt = deps.now()
  const waitMs = input.waitMs ?? 60_000
  const deadline = deps.now() + waitMs
  let eventsPath: string | undefined
  let scannedFiles = 0
  let lastAssistantText: string | undefined

  while (deps.now() <= deadline) {
    if (input.sessionId != null && input.sessionId.trim() !== '') {
      eventsPath ??= await locateSessionEventsPath({
        homeDir: input.homeDir ?? os.homedir(),
        projectHome: input.projectHome,
        sessionId: input.sessionId
      })
      if (eventsPath != null) {
        const probe = await readRuntimeSessionProbe(eventsPath)
        if (probe != null) {
          lastAssistantText = probe.assistantText ?? lastAssistantText
          const replyMatches = input.expectedReply == null || probe.assistantText?.includes(input.expectedReply)
          if (probe.failed != null) {
            return buildWaitResult(
              {
                ok: false,
                completed: probe.completed,
                failed: probe.failed,
                scannedFiles,
                assistantText: probe.assistantText,
                eventsPath,
                sessionId: input.sessionId,
                message: `${probe.failed} (${eventsPath})`
              },
              startedAt,
              deps
            )
          }
          if (probe.completed && replyMatches) {
            return buildWaitResult(
              {
                ok: true,
                completed: true,
                scannedFiles,
                assistantText: probe.assistantText,
                eventsPath,
                sessionId: input.sessionId,
                message: input.expectedReply == null
                  ? `completed (${eventsPath})`
                  : `matched "${input.expectedReply}" (${eventsPath})`
              },
              startedAt,
              deps
            )
          }
        }
      }
    } else {
      const candidates = await listCandidateSessionEventFiles({
        homeDir: input.homeDir ?? os.homedir(),
        projectHome: input.projectHome
      })
      scannedFiles = candidates.length
      for (const candidate of candidates) {
        const probe = await readRuntimeSessionProbe(candidate.eventsPath)
        if (probe == null) continue
        if (probe.assistantText != null) lastAssistantText = probe.assistantText
        const replyMatches = input.expectedReply == null || probe.assistantText?.includes(input.expectedReply) === true
        if (probe.failed != null && replyMatches) {
          return buildWaitResult(
            {
              ok: false,
              completed: probe.completed,
              failed: probe.failed,
              scannedFiles,
              assistantText: probe.assistantText,
              eventsPath: candidate.eventsPath,
              sessionId: candidate.sessionId,
              message: `${probe.failed} (${candidate.eventsPath})`
            },
            startedAt,
            deps
          )
        }
        if (probe.completed && replyMatches) {
          return buildWaitResult(
            {
              ok: true,
              completed: true,
              scannedFiles,
              assistantText: probe.assistantText,
              eventsPath: candidate.eventsPath,
              sessionId: candidate.sessionId,
              message: input.expectedReply == null
                ? `discovered ${candidate.sessionId}; completed (${candidate.eventsPath})`
                : `discovered ${candidate.sessionId}; matched "${input.expectedReply}" (${candidate.eventsPath})`
            },
            startedAt,
            deps
          )
        }
      }
    }
    await deps.sleep(DEFAULT_POLL_INTERVAL_MS)
  }

  return buildWaitResult(
    {
      ok: false,
      completed: false,
      scannedFiles,
      assistantText: lastAssistantText,
      eventsPath,
      sessionId: input.sessionId,
      message: input.sessionId == null
        ? `no completed session reply matched "${
          input.expectedReply ?? '<any>'
        }" after ${waitMs}ms; scanned=${scannedFiles}; last assistant=${lastAssistantText ?? '<none>'}`
        : eventsPath == null
        ? `events.jsonl not found for ${input.sessionId}`
        : `timed out after ${waitMs}ms; last assistant=${lastAssistantText ?? '<none>'} (${eventsPath})`
    },
    startedAt,
    deps
  )
}

export const formatRuntimeEvidenceWaitResult = (result: RuntimeEvidenceWaitResult) => (
  [
    `[runtime-evidence] ${result.ok ? 'OK' : 'FAIL'} ${result.message}`,
    `[runtime-evidence] elapsed=${result.elapsedMs}ms scanned=${result.scannedFiles}${
      result.sessionId == null ? '' : ` session=${result.sessionId}`
    }`
  ].join('\n')
)

export const runRuntimeEvidenceWait = async (
  input: RuntimeEvidenceWaitInput,
  deps: RuntimeEvidenceDeps = defaultDeps
) => {
  const result = await waitForRuntimeEvidenceReply(input, deps)
  const stdout = input.stdout ?? process.stdout
  if (input.json) {
    stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } else {
    stdout.write(`${formatRuntimeEvidenceWaitResult(result)}\n`)
  }
  if (!result.ok && input.setExitCode !== false) {
    process.exitCode = 1
  }
  return result
}

export const runRuntimeEvidenceList = async (input: RuntimeEvidenceListInput = {}) => {
  const sessions = await listRuntimeEvidenceSessions(input)
  const stdout = input.stdout ?? process.stdout
  if (input.json) {
    stdout.write(`${JSON.stringify({ sessions }, null, 2)}\n`)
    return { sessions }
  }

  if (sessions.length === 0) {
    stdout.write('[runtime-evidence] no sessions found\n')
    return { sessions }
  }
  for (const session of sessions) {
    const updated = session.mtimeMs == null ? '' : `updated=${new Date(session.mtimeMs).toISOString()} `
    stdout.write(
      `[runtime-evidence] ${session.sessionId} ${updated}completed=${session.completed} lines=${session.lineCount} ${
        session.assistantText == null ? '' : `assistant=${JSON.stringify(session.assistantText)} `
      }${session.eventsPath}\n`
    )
  }
  return { sessions }
}
