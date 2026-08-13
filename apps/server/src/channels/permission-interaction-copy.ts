import type { AskUserQuestionParams } from '@oneworks/core'
import type { PermissionInteractionOptionSemantic } from '@oneworks/types'

type InteractionOption = NonNullable<AskUserQuestionParams['options']>[number]

const frameworkPermissionSemantics = new Set<PermissionInteractionOptionSemantic>([
  'allow_once',
  'allow_session',
  'allow_project',
  'deny_once',
  'deny_session',
  'deny_project'
])

export const resolvePermissionOptionCopy = (language: string, option: InteractionOption) => {
  const valueSemantic = option.value as PermissionInteractionOptionSemantic | undefined
  const semantic = option.permission?.semantic ?? (
    valueSemantic != null && frameworkPermissionSemantics.has(valueSemantic) ? valueSemantic : undefined
  )
  if (semantic == null) return option

  const english = language === 'en'
  const adapter = option.permission?.adapterLabel ?? (english ? 'the native adapter' : '原生适配器')
  const nativeLabel = option.permission?.nativeLabel ?? option.label
  const copies: Record<PermissionInteractionOptionSemantic, [string, string]> = {
    allow_once: english
      ? ['Allow once', 'Allows only this request.']
      : ['仅允许本次', '只允许当前这次请求。'],
    allow_session: english
      ? ['Allow for this session', 'Allows matching requests for the rest of this session.']
      : ['当前会话内允许', '当前会话后续遇到同类请求时继续允许。'],
    allow_project: english
      ? ['Allow for this project', 'Saves approval for matching requests in this project.']
      : ['当前项目内允许', '为当前项目保存同类请求的允许规则。'],
    deny_once: english
      ? ['Deny once', 'Denies only this request.']
      : ['仅拒绝本次', '只拒绝当前这次请求。'],
    deny_session: english
      ? ['Deny for this session', 'Denies matching requests for the rest of this session.']
      : ['当前会话内拒绝', '当前会话后续遇到同类请求时继续拒绝。'],
    deny_project: english
      ? ['Deny for this project', 'Saves rejection for matching requests in this project.']
      : ['当前项目内拒绝', '为当前项目保存同类请求的拒绝规则。'],
    allow_persistent: english
      ? [`Always allow in ${adapter} (persistent)`, `Changes ${adapter} permission state beyond this request.`]
      : [`在 ${adapter} 中始终允许（持久）`, `会修改 ${adapter} 的权限状态，并在当前请求结束后继续生效。`],
    deny_persistent: english
      ? [`Always deny in ${adapter} (persistent)`, `Changes ${adapter} permission state beyond this request.`]
      : [`在 ${adapter} 中始终拒绝（持久）`, `会修改 ${adapter} 的权限状态，并在当前请求结束后继续生效。`],
    native_unknown: english
      ? [`${adapter} option: ${nativeLabel}`, "The native adapter did not advertise this option's scope."]
      : [`${adapter} 原生选项：${nativeLabel}`, '原生适配器未说明此选项的权限范围。']
  }
  const [label, description] = copies[semantic]
  return { ...option, description, label }
}
