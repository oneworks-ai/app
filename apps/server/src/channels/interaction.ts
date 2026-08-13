import type { AskUserQuestionParams } from '@oneworks/core'

import { resolvePermissionOptionCopy } from './permission-interaction-copy.js'

export {
  formatInteractionChoices,
  getInteractionResponseMode,
  normalizeInteractionToken,
  resolveInteractionSelection,
  splitInteractionSelections
} from './interaction-selection.js'

type InteractionOption = NonNullable<AskUserQuestionParams['options']>[number]
type InteractionKind = AskUserQuestionParams['kind']

const isEnglish = (language: string) => language === 'en'

const buildInteractionOptionLines = (
  language: string,
  options: InteractionOption[],
  kind: InteractionKind
) => {
  if (options.length === 0) return []

  return [
    '',
    isEnglish(language) ? 'Options:' : '可选项：',
    ...options.map((sourceOption, index) => {
      const option = kind === 'permission'
        ? resolvePermissionOptionCopy(language, sourceOption)
        : sourceOption
      const prefix = `${index + 1}. `
      if ((option.description?.trim() ?? '') === '') {
        return `${prefix}${option.label}`
      }
      return `${prefix}${option.label}: ${option.description}`
    })
  ]
}

const buildInteractionInstruction = (
  language: string,
  input: {
    hasOptions: boolean
    multiselect: boolean
    kind: InteractionKind
  }
) => {
  const controlled = input.kind === 'permission'

  if (input.multiselect) {
    if (isEnglish(language)) {
      return controlled
        ? 'Multiple selections are allowed. Reply with option labels or numbers, separated by commas or new lines.'
        : 'Multiple selections are allowed. You can reply with option labels or numbers, separated by commas or new lines, or answer freely in plain text.'
    }
    return controlled
      ? '支持多选，请直接回复选项文本或序号；多个选项可用逗号、顿号或换行分隔。'
      : '支持多选，可以回复选项文本或序号；多个选项可用逗号、顿号或换行分隔，也可以直接自由输入答案。'
  }

  if (input.hasOptions) {
    if (isEnglish(language)) {
      return controlled
        ? 'Reply with the option label or number, or tap a quick action if one is shown below.'
        : 'Reply with the option label or number, tap a quick action if one is shown below, or answer freely in plain text.'
    }
    return controlled
      ? '请直接回复选项文本或序号；如果下方出现快捷气泡，也可以直接点击。'
      : '可以回复选项文本或序号；如果下方出现快捷气泡，也可以直接点击，也可以直接自由输入答案。'
  }

  return isEnglish(language) ? 'Please reply directly in plain text.' : '请直接回复文字内容。'
}

export const buildInteractionText = (
  language: string,
  payload: AskUserQuestionParams
) => {
  const permissionContext = payload.kind === 'permission' ? payload.permissionContext : undefined
  const permissionReasons = permissionContext?.reasons ?? []
  const question = payload.kind === 'permission' && permissionContext?.subjectLabel?.trim()
    ? (isEnglish(language)
      ? `Permission is required to use ${permissionContext.subjectLabel.trim()}.`
      : `使用 ${permissionContext.subjectLabel.trim()} 需要权限。`)
    : payload.question.trim()
  const lines = [
    ...(payload.kind === 'permission'
      ? [isEnglish(language) ? '[Permission Request]' : '[权限请求]']
      : []),
    question
  ]

  if ((permissionContext?.currentMode ?? '').trim() !== '') {
    lines.push(
      isEnglish(language)
        ? `Current mode: ${permissionContext?.currentMode}`
        : `当前模式：${permissionContext?.currentMode}`
    )
  }
  if ((permissionContext?.suggestedMode ?? '').trim() !== '') {
    lines.push(
      isEnglish(language)
        ? `Suggested mode: ${permissionContext?.suggestedMode}`
        : `建议模式：${permissionContext?.suggestedMode}`
    )
  }
  if ((permissionContext?.subjectLabel ?? '').trim() !== '') {
    lines.push(
      isEnglish(language)
        ? `Scope: ${permissionContext?.subjectLabel}`
        : `审批范围：${permissionContext?.subjectLabel}`
    )
  }
  if ((permissionContext?.projectConfigPath ?? '').trim() !== '') {
    lines.push(
      isEnglish(language)
        ? `Project memory file: ${permissionContext?.projectConfigPath}`
        : `项目记忆文件：${permissionContext?.projectConfigPath}`
    )
  }
  if (permissionReasons.length > 0) {
    lines.push(isEnglish(language) ? 'Reason:' : '原因：')
    lines.push(...permissionReasons.map(reason => `- ${reason}`))
  }

  lines.push(...buildInteractionOptionLines(language, payload.options ?? [], payload.kind))
  lines.push('')
  lines.push(buildInteractionInstruction(language, {
    hasOptions: (payload.options?.length ?? 0) > 0,
    multiselect: payload.multiselect ?? false,
    kind: payload.kind
  }))

  return lines.join('\n')
}
