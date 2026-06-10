/* eslint-disable max-lines */

import type { ToolDiffMetaItem } from './ToolDiffViewer'
import type { ToolFieldView } from './tool-field-sections'

const WINDOWS_PATH_RE = /^[a-z]:[\\/]+/i
const PATH_KEY_SET = new Set(['cwd', 'dir', 'directory', 'filePath', 'file_path', 'path', 'workdir'])
const MULTILINE_CODE_KEY_SET = new Set([
  'command',
  'content',
  'input',
  'newString',
  'new_string',
  'oldString',
  'old_string',
  'output',
  'patch',
  'stderr',
  'stdout'
])
const LIST_KEY_SET = new Set(['changes', 'entries', 'files', 'items', 'matches', 'results', 'todos'])

interface ToolMeta {
  titleKey?: string
  fallbackTitle: string
  icon: string
}

interface GenericToolDiffView {
  original: string
  modified: string
  language?: string
  metaItems?: Array<{
    labelKey: string
    fallbackLabel: string
    value?: string
    tone?: ToolDiffMetaItem['tone']
    icon?: string
  }>
}

export interface GenericToolPresentation {
  titleKey?: string
  fallbackTitle: string
  icon: string
  primary?: string
  inlineFields: ToolFieldView[]
  blockFields: ToolFieldView[]
  diff?: GenericToolDiffView
  suppressSuccessResult?: boolean
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const asString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value : undefined
)

const asNumber = (value: unknown) => (
  typeof value === 'number' && Number.isFinite(value) ? value : undefined
)

const asBoolean = (value: unknown) => (
  typeof value === 'boolean' ? value : undefined
)

const normalizeToolPath = (value: string) => value.replace(/\\/g, '/')

const getFileInfo = (filePath?: string) => {
  const resolvedPath = (filePath != null && filePath !== '') ? filePath : 'unknown file'
  const normalizedPath = normalizeToolPath(resolvedPath)
  const lastSlashIndex = normalizedPath.lastIndexOf('/')
  const fileName = lastSlashIndex >= 0 ? normalizedPath.slice(lastSlashIndex + 1) : normalizedPath
  const dirPath = lastSlashIndex >= 0 ? normalizedPath.slice(0, lastSlashIndex) : ''

  return { filePath: normalizedPath, fileName, dirPath }
}

const getLanguageFromPath = (path: string) => {
  const extPart = path.split('.').pop()
  const ext = (extPart != null && extPart !== '') ? extPart.toLowerCase() : ''
  const langMap: Record<string, string> = {
    'css': 'css',
    'diff': 'diff',
    'html': 'html',
    'js': 'javascript',
    'json': 'json',
    'jsx': 'jsx',
    'md': 'markdown',
    'py': 'python',
    'scss': 'scss',
    'sh': 'bash',
    'sql': 'sql',
    'ts': 'typescript',
    'tsx': 'tsx',
    'yaml': 'yaml',
    'yml': 'yaml'
  }
  return langMap[ext] ?? 'text'
}

const humanizeToolSegment = (value: string) => (
  value
    .replace(/[_:-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
)

const formatToolName = (name: string) => {
  if (name.startsWith('mcp__ChromeDevtools__')) {
    return name.replace('mcp__ChromeDevtools__', '')
  }

  const namespaceSegments = name.includes('__') ? name.split('__').filter(Boolean) : []
  const lastSegment = namespaceSegments.length > 0
    ? namespaceSegments[namespaceSegments.length - 1]
    : name.split(':').pop() ?? name
  return humanizeToolSegment(lastSegment)
}

const normalizeToolKey = (name: string) => (
  formatToolName(name).replace(/[^a-z0-9]+/gi, '').toLowerCase()
)

const toFieldKey = (value: string) => (
  value
    .replace(/^[^a-z0-9]+/i, '')
    .replace(/[_-]+([a-z0-9])/gi, (_, char: string) => char.toUpperCase())
)

const toFallbackLabel = (value: string) => {
  const humanized = humanizeToolSegment(value)
  if (humanized === '') return value
  return humanized.charAt(0).toUpperCase() + humanized.slice(1)
}

const getFieldDescriptor = (key: string, fallbackLabel?: string) => {
  const normalizedKey = toFieldKey(key)
  return {
    labelKey: `chat.tools.fields.${normalizedKey}`,
    fallbackLabel: fallbackLabel ?? toFallbackLabel(key)
  }
}

const pushField = (
  fields: ToolFieldView[],
  usedKeys: Set<string>,
  key: string,
  field: ToolFieldView
) => {
  const { value } = field
  if (value == null || value === '') {
    return
  }
  if (Array.isArray(value) && value.length === 0) {
    return
  }
  if (isRecord(value) && Object.keys(value).length === 0) {
    return
  }

  usedKeys.add(key)
  fields.push(field)
}

const isPathLikeValue = (value: string) => (
  value.startsWith('/') ||
  value.startsWith('./') ||
  value.startsWith('../') ||
  WINDOWS_PATH_RE.test(value) ||
  (value.includes('/') && !value.includes(' '))
)

const getFirstLine = (value: string | undefined) => value?.split('\n')[0]?.trim()

const looksLikeCode = (key: string, value: string) => {
  if (MULTILINE_CODE_KEY_SET.has(key)) return true
  if (value.includes('*** Begin Patch')) return true
  return /[{}();=<>]|^diff --git/m.test(value)
}

const isPrimitiveList = (value: unknown[]) =>
  value.every(item => (
    typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean'
  ))

const getChangeLines = (value: unknown) => {
  if (!Array.isArray(value)) return undefined
  const lines = value.flatMap((change) => {
    if (!isRecord(change)) return []
    const kind = asString(change.kind) ?? 'change'
    const path = asString(change.path) ?? asString(change.file_path) ?? asString(change.filePath)
    if (path == null) return []
    return [`${kind} ${path}`]
  })
  return lines.length > 0 ? lines : undefined
}

const getTodoLines = (value: unknown) => {
  if (!Array.isArray(value)) return undefined
  const lines = value.flatMap((item) => {
    if (!isRecord(item)) return []
    const title = asString(item.title) ?? asString(item.content)
    if (title == null) return []
    const status = asString(item.status)
    return [status != null ? `${status}: ${title}` : title]
  })
  return lines.length > 0 ? lines : undefined
}

const getPatchTargets = (patch: string) => {
  const matches = Array.from(
    patch.matchAll(/^\*\*\* (?:(?:Add|Update|Delete) File|Move to): (.+)$/gm),
    match => match[1]?.trim()
  ).filter((value): value is string => typeof value === 'string' && value !== '')

  if (matches.length > 0) {
    return matches
  }

  return Array.from(
    patch.matchAll(/^\+\+\+ b\/(.+)$/gm),
    match => match[1]?.trim()
  ).filter((value): value is string => typeof value === 'string' && value !== '')
}

const getGenericToolMeta = (name: string): ToolMeta => {
  const normalizedKey = normalizeToolKey(name)

  if (normalizedKey === 'applypatch') {
    return { fallbackTitle: 'Apply Patch', icon: 'difference' }
  }
  if (normalizedKey === 'bash' || normalizedKey === 'execcommand' || normalizedKey === 'shell') {
    return { titleKey: 'chat.tools.bash', fallbackTitle: 'Bash', icon: 'terminal' }
  }
  if (normalizedKey === 'edit' || normalizedKey === 'editfile' || normalizedKey === 'strreplacefile') {
    return { titleKey: 'chat.tools.editTool', fallbackTitle: 'Edit File', icon: 'edit' }
  }
  if (normalizedKey === 'filechange') {
    return { fallbackTitle: 'File Change', icon: 'difference' }
  }
  if (normalizedKey === 'glob') {
    return { titleKey: 'chat.tools.globTool', fallbackTitle: 'Glob', icon: 'search' }
  }
  if (normalizedKey === 'grep') {
    return { titleKey: 'chat.tools.grepTool', fallbackTitle: 'Grep', icon: 'find_in_page' }
  }
  if (normalizedKey === 'listdir' || normalizedKey === 'ls') {
    return { titleKey: 'chat.tools.lsTool', fallbackTitle: 'List Directory', icon: 'folder_open' }
  }
  if (normalizedKey === 'read' || normalizedKey === 'readfile') {
    return { titleKey: 'chat.tools.read', fallbackTitle: 'Read File', icon: 'visibility' }
  }
  if (normalizedKey === 'viewimage') {
    return { fallbackTitle: 'View Image', icon: 'image' }
  }
  if (normalizedKey === 'settodolist') {
    return { titleKey: 'chat.tools.todo', fallbackTitle: 'Task Planning', icon: 'task_alt' }
  }
  if (normalizedKey === 'webfetch' || normalizedKey === 'fetchurl') {
    return { titleKey: 'chat.tools.webFetch', fallbackTitle: 'Web Fetch', icon: 'language' }
  }
  if (normalizedKey === 'websearch' || normalizedKey === 'searchweb') {
    return { titleKey: 'chat.tools.webSearch', fallbackTitle: 'Web Search', icon: 'travel_explore' }
  }
  if (normalizedKey === 'write' || normalizedKey === 'writefile') {
    return { titleKey: 'chat.tools.write', fallbackTitle: 'Write File', icon: 'edit_note' }
  }
  if (name.startsWith('mcp__') || name.includes(':mcp:')) {
    return { fallbackTitle: formatToolName(name), icon: 'extension' }
  }
  if (name.startsWith('plugin__')) {
    return { fallbackTitle: formatToolName(name), icon: 'extension' }
  }

  return { fallbackTitle: formatToolName(name), icon: 'build' }
}

const getPrimaryFromRecord = (record: Record<string, unknown>) => {
  const preferredKeys = [
    'file_path',
    'filePath',
    'path',
    'url',
    'query',
    'pattern',
    'command',
    'selector',
    'taskId',
    'subject',
    'title'
  ]

  for (const key of preferredKeys) {
    const value = asString(record[key])
    if (value != null) {
      return getFirstLine(value)
    }
  }

  for (const value of Object.values(record)) {
    if (typeof value === 'string' && value.trim() !== '') {
      const firstLine = getFirstLine(value)
      if (firstLine != null && firstLine !== '' && !firstLine.startsWith('*** Begin Patch')) {
        return firstLine
      }
    }
  }

  return undefined
}

const addRemainingRecordFields = (
  blockFields: ToolFieldView[],
  inlineFields: ToolFieldView[],
  record: Record<string, unknown>,
  usedKeys: Set<string>
) => {
  for (const [key, value] of Object.entries(record)) {
    if (usedKeys.has(key) || value == null) {
      continue
    }

    const descriptor = getFieldDescriptor(key)
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed === '') {
        continue
      }

      if (!trimmed.includes('\n') && trimmed.length <= 80) {
        pushField(inlineFields, usedKeys, key, {
          ...descriptor,
          format: 'inline',
          value: trimmed
        })
        continue
      }

      pushField(blockFields, usedKeys, key, {
        ...descriptor,
        format: looksLikeCode(key, trimmed) ? 'code' : 'text',
        value: trimmed,
        lang: key === 'patch' ? 'diff' : undefined
      })
      continue
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      pushField(inlineFields, usedKeys, key, {
        ...descriptor,
        format: 'inline',
        value
      })
      continue
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        continue
      }

      const changeLines = key === 'changes' ? getChangeLines(value) : undefined
      if (changeLines != null) {
        pushField(blockFields, usedKeys, key, {
          ...descriptor,
          format: 'list',
          value: changeLines
        })
        continue
      }

      const todoLines = (key === 'items' || key === 'todos') ? getTodoLines(value) : undefined
      if (todoLines != null) {
        pushField(blockFields, usedKeys, key, {
          ...descriptor,
          format: 'list',
          value: todoLines
        })
        continue
      }

      if (LIST_KEY_SET.has(key) && isPrimitiveList(value)) {
        pushField(blockFields, usedKeys, key, {
          ...descriptor,
          format: 'list',
          value: value.map(item => String(item))
        })
        continue
      }

      pushField(blockFields, usedKeys, key, {
        ...descriptor,
        format: 'json',
        value
      })
      continue
    }

    if (isRecord(value)) {
      pushField(blockFields, usedKeys, key, {
        ...descriptor,
        format: 'json',
        value
      })
    }
  }
}

const buildPrimitiveInputPresentation = (
  input: unknown,
  meta: ToolMeta
): GenericToolPresentation => {
  const blockFields: ToolFieldView[] = []

  if (typeof input === 'string' && input.trim() !== '') {
    const trimmed = input.trim()
    pushField(blockFields, new Set<string>(), 'input', {
      ...getFieldDescriptor('input', 'Input'),
      format: trimmed.includes('\n') || looksLikeCode('input', trimmed) ? 'code' : 'text',
      value: trimmed
    })
  } else if (Array.isArray(input) && input.length > 0) {
    pushField(blockFields, new Set<string>(), 'input', {
      ...getFieldDescriptor('input', 'Input'),
      format: isPrimitiveList(input) ? 'list' : 'json',
      value: isPrimitiveList(input) ? input.map(item => String(item)) : input
    })
  } else if (input != null) {
    pushField(blockFields, new Set<string>(), 'input', {
      ...getFieldDescriptor('input', 'Input'),
      format: 'json',
      value: input
    })
  }

  return {
    ...meta,
    primary: typeof input === 'string' && input.trim() !== '' ? getFirstLine(input.trim()) : undefined,
    inlineFields: [],
    blockFields
  }
}

const getFirstDiffRecord = (record: Record<string, unknown>) => {
  const diffs = Array.isArray(record.diffs) ? record.diffs.filter(isRecord) : []
  return diffs[0] ?? record
}

const buildDiffFromRecord = (
  record: Record<string, unknown>,
  primary: string | undefined
): GenericToolDiffView | undefined => {
  const diffRecord = getFirstDiffRecord(record)
  const original = asString(diffRecord.old_text) ??
    asString(record.oldString) ??
    asString(record.old_string) ??
    asString(record.old_text) ??
    ''
  const modified = asString(diffRecord.new_text) ??
    asString(record.newString) ??
    asString(record.new_string) ??
    asString(record.new_text) ??
    ''
  if (original === '' && modified === '') return undefined

  const oldStart = asNumber(diffRecord.old_start) ?? asNumber(record.old_start)
  const newStart = asNumber(diffRecord.new_start) ?? asNumber(record.new_start)
  const isSummary = asBoolean(diffRecord.is_summary) ?? asBoolean(record.is_summary)
  const metaItems: NonNullable<GenericToolDiffView['metaItems']> = []
  if (oldStart != null) {
    metaItems.push({
      ...getFieldDescriptor('oldStart', 'Old Start'),
      icon: 'line_start',
      value: String(oldStart),
      tone: 'muted'
    })
  }
  if (newStart != null) {
    metaItems.push({
      ...getFieldDescriptor('newStart', 'New Start'),
      icon: 'line_end',
      value: String(newStart),
      tone: 'muted'
    })
  }
  if (isSummary != null) {
    metaItems.push({
      ...getFieldDescriptor('summary', 'Summary'),
      icon: 'summarize',
      value: isSummary ? 'true' : 'false',
      tone: isSummary ? 'muted' : 'success'
    })
  }
  return {
    original,
    modified,
    language: getLanguageFromPath(primary ?? asString(diffRecord.path) ?? asString(record.path) ?? ''),
    metaItems
  }
}

export function buildGenericToolPresentation(name: string, input: unknown): GenericToolPresentation {
  const meta = getGenericToolMeta(name)
  if (!isRecord(input)) {
    return buildPrimitiveInputPresentation(input, meta)
  }

  const record = input
  const inlineFields: ToolFieldView[] = []
  const blockFields: ToolFieldView[] = []
  const usedKeys = new Set<string>()
  const normalizedKey = normalizeToolKey(name)
  let primary: string | undefined
  let diff: GenericToolDiffView | undefined
  let suppressSuccessResult = false

  if (normalizedKey === 'bash' || normalizedKey === 'execcommand' || normalizedKey === 'shell') {
    const command = asString(record.command)
    primary = getFirstLine(command)
    pushField(inlineFields, usedKeys, 'cwd', {
      ...getFieldDescriptor('cwd', 'Cwd'),
      format: 'inline',
      value: asString(record.cwd)
    })
    pushField(inlineFields, usedKeys, 'workdir', {
      ...getFieldDescriptor('workdir', 'Workdir'),
      format: 'inline',
      value: asString(record.workdir)
    })
    pushField(inlineFields, usedKeys, 'timeoutMs', {
      ...getFieldDescriptor('timeoutMs', 'Timeout'),
      format: 'inline',
      value: asNumber(record.timeoutMs)
    })
    pushField(inlineFields, usedKeys, 'yield_time_ms', {
      ...getFieldDescriptor('yieldTimeMs', 'Yield Time'),
      format: 'inline',
      value: asNumber(record.yield_time_ms)
    })
    pushField(inlineFields, usedKeys, 'max_output_tokens', {
      ...getFieldDescriptor('maxOutputTokens', 'Max Output Tokens'),
      format: 'inline',
      value: asNumber(record.max_output_tokens)
    })
    if (command != null && command.includes('\n')) {
      pushField(blockFields, usedKeys, 'command', {
        ...getFieldDescriptor('command'),
        format: 'code',
        value: command,
        lang: 'bash'
      })
    } else {
      usedKeys.add('command')
    }
  } else if (normalizedKey === 'read' || normalizedKey === 'readfile' || normalizedKey === 'viewimage') {
    const pathValue = asString(record.path) ?? asString(record.file_path)
    primary = pathValue != null ? getFileInfo(pathValue).filePath : undefined
    pushField(inlineFields, usedKeys, 'startLine', {
      ...getFieldDescriptor('startLine', 'Start Line'),
      format: 'inline',
      value: asNumber(record.startLine)
    })
    pushField(inlineFields, usedKeys, 'endLine', {
      ...getFieldDescriptor('endLine', 'End Line'),
      format: 'inline',
      value: asNumber(record.endLine)
    })
    pushField(inlineFields, usedKeys, 'offset', {
      ...getFieldDescriptor('offset'),
      format: 'inline',
      value: asNumber(record.offset)
    })
    pushField(inlineFields, usedKeys, 'limit', {
      ...getFieldDescriptor('limit'),
      format: 'inline',
      value: asNumber(record.limit)
    })
    usedKeys.add('path')
    usedKeys.add('file_path')
  } else if (normalizedKey === 'write' || normalizedKey === 'writefile') {
    const pathValue = asString(record.path) ?? asString(record.file_path)
    primary = pathValue != null ? getFileInfo(pathValue).filePath : undefined
    diff = buildDiffFromRecord(record, primary)
    const content = asString(record.content)
    if (content != null && diff == null) {
      pushField(blockFields, usedKeys, 'content', {
        ...getFieldDescriptor('content'),
        format: 'code',
        value: content,
        lang: getLanguageFromPath(primary ?? '')
      })
    }
    usedKeys.add('path')
    usedKeys.add('file_path')
    usedKeys.add('old_text')
    usedKeys.add('new_text')
    usedKeys.add('old_start')
    usedKeys.add('new_start')
    usedKeys.add('is_summary')
    usedKeys.add('diffs')
    suppressSuccessResult = true
  } else if (normalizedKey === 'edit' || normalizedKey === 'editfile' || normalizedKey === 'strreplacefile') {
    const pathValue = asString(record.path) ?? asString(record.file_path)
    primary = pathValue != null ? getFileInfo(pathValue).filePath : undefined
    const replaceAll = asBoolean(record.replaceAll) ?? asBoolean(record.replace_all)
    diff = buildDiffFromRecord(record, primary)
    if (diff != null) {
      diff.metaItems = [
        ...(diff.metaItems ?? []),
        ...(replaceAll == null
          ? []
          : [{
            ...getFieldDescriptor('replaceAll'),
            icon: 'select_all',
            value: replaceAll ? 'true' : 'false',
            tone: replaceAll ? 'success' as const : 'muted' as const
          }])
      ]
      usedKeys.add('oldString')
      usedKeys.add('old_string')
      usedKeys.add('old_text')
      usedKeys.add('newString')
      usedKeys.add('new_string')
      usedKeys.add('new_text')
      usedKeys.add('old_start')
      usedKeys.add('new_start')
      usedKeys.add('is_summary')
      usedKeys.add('diffs')
    }
    pushField(inlineFields, usedKeys, 'replaceAll', {
      ...getFieldDescriptor('replaceAll'),
      format: 'inline',
      value: replaceAll != null ? String(replaceAll) : undefined
    })
    usedKeys.add('path')
    usedKeys.add('file_path')
    suppressSuccessResult = true
  } else if (normalizedKey === 'applypatch') {
    const patch = asString(record.patch)
    const targets = patch != null ? getPatchTargets(patch) : []
    primary = targets.length === 1
      ? getFileInfo(targets[0]).filePath
      : targets.length > 1
      ? `${targets.length} files`
      : undefined
    if (patch != null) {
      pushField(blockFields, usedKeys, 'patch', {
        ...getFieldDescriptor('patch', 'Patch'),
        format: 'code',
        value: patch,
        lang: 'diff'
      })
    }
    pushField(inlineFields, usedKeys, 'cwd', {
      ...getFieldDescriptor('cwd', 'Cwd'),
      format: 'inline',
      value: asString(record.cwd)
    })
    suppressSuccessResult = true
  } else if (normalizedKey === 'glob') {
    primary = asString(record.pattern)
    pushField(inlineFields, usedKeys, 'cwd', {
      ...getFieldDescriptor('cwd', 'Cwd'),
      format: 'inline',
      value: asString(record.cwd)
    })
    usedKeys.add('pattern')
  } else if (normalizedKey === 'grep') {
    primary = asString(record.pattern)
    pushField(inlineFields, usedKeys, 'path', {
      ...getFieldDescriptor('path'),
      format: 'inline',
      value: asString(record.path)
    })
    pushField(inlineFields, usedKeys, 'glob', {
      ...getFieldDescriptor('glob'),
      format: 'inline',
      value: asString(record.glob)
    })
    pushField(inlineFields, usedKeys, 'ignoreCase', {
      ...getFieldDescriptor('ignoreCase', 'Ignore Case'),
      format: 'inline',
      value: asBoolean(record.ignoreCase) != null ? String(record.ignoreCase) : undefined
    })
    pushField(inlineFields, usedKeys, 'contextLines', {
      ...getFieldDescriptor('contextLines', 'Context Lines'),
      format: 'inline',
      value: asNumber(record.contextLines)
    })
    usedKeys.add('pattern')
  } else if (normalizedKey === 'ls' || normalizedKey === 'listdir') {
    const pathValue = asString(record.path)
    primary = pathValue != null ? getFileInfo(pathValue).filePath : undefined
    usedKeys.add('path')
  } else if (normalizedKey === 'settodolist') {
    const todoLines = getTodoLines(record.items) ?? getTodoLines(record.todos)
    primary = todoLines == null ? undefined : `${todoLines.length} tasks`
    pushField(blockFields, usedKeys, 'items', {
      ...getFieldDescriptor('items', 'Items'),
      format: 'list',
      value: todoLines
    })
    usedKeys.add('todos')
  } else if (normalizedKey === 'websearch' || normalizedKey === 'searchweb') {
    primary = asString(record.query)
    usedKeys.add('query')
  } else if (normalizedKey === 'webfetch' || normalizedKey === 'fetchurl') {
    primary = asString(record.url)
    usedKeys.add('url')
  } else if (normalizedKey === 'filechange') {
    const changeLines = getChangeLines(record.changes)
    primary = changeLines?.length === 1
      ? getFileInfo(changeLines[0].split(' ').slice(1).join(' ')).filePath
      : changeLines != null && changeLines.length > 1
      ? `${changeLines.length} files`
      : undefined
    pushField(inlineFields, usedKeys, 'status', {
      ...getFieldDescriptor('status'),
      format: 'inline',
      value: asString(record.status)
    })
    pushField(blockFields, usedKeys, 'changes', {
      ...getFieldDescriptor('changes', 'Changes'),
      format: 'list',
      value: changeLines
    })
    suppressSuccessResult = true
  }

  if (primary == null) {
    const genericPrimary = getPrimaryFromRecord(record)
    primary = genericPrimary
  }

  for (const key of ['path', 'file_path', 'url', 'query', 'pattern', 'command']) {
    if (key in record && usedKeys.has(key)) {
      continue
    }
    const value = asString(record[key])
    if (value == null) continue
    if (PATH_KEY_SET.has(key) || isPathLikeValue(value)) {
      primary = primary ?? (PATH_KEY_SET.has(key) ? getFileInfo(value).filePath : value)
    } else if (key === 'command') {
      primary = primary ?? getFirstLine(value)
    } else {
      primary = primary ?? value
    }
  }

  addRemainingRecordFields(blockFields, inlineFields, record, usedKeys)

  return {
    ...meta,
    primary,
    inlineFields,
    blockFields,
    diff,
    suppressSuccessResult
  }
}
