import type { AskUserQuestionParams } from '@oneworks/core'

type InteractionSelectionOption = NonNullable<AskUserQuestionParams['options']>[number] & {
  aliases?: string[]
}
type InteractionKind = AskUserQuestionParams['kind']

export const splitInteractionSelections = (value: string) =>
  value
    .split(/[\n,，、]+/g)
    .map(item => item.trim())
    .filter(Boolean)

export const normalizeInteractionToken = (value: string) =>
  value
    .trim()
    .replace(/^[`"'“”‘’([]+|[`"'“”‘’)\].,，。!！?？:：；;]+$/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()

export const formatInteractionChoices = (options: InteractionSelectionOption[]) =>
  options
    .map((option, index) => `${index + 1}. ${option.label}`)
    .join('\n')

export const getInteractionResponseMode = (kind: InteractionKind) => {
  if (kind === 'permission') return 'controlled'
  return 'freeform'
}

export const resolveInteractionSelection = (
  rawSelection: string,
  options: InteractionSelectionOption[],
  input: {
    allowLooseMatch?: boolean
  } = {}
) => {
  const trimmed = rawSelection.trim()
  if (trimmed === '') return undefined

  const numeric = Number.parseInt(trimmed, 10)
  if (String(numeric) === trimmed && numeric >= 1 && numeric <= options.length) {
    const option = options[numeric - 1]!
    return option.value ?? option.label
  }

  const normalized = normalizeInteractionToken(trimmed)
  if (normalized === '') return undefined

  const candidatesFor = (option: InteractionSelectionOption) => (
    [option.label, option.value, ...(option.aliases ?? [])].filter((candidate): candidate is string =>
      (candidate?.trim() ?? '') !== ''
    )
  )
  const resolveUniqueMatch = (matches: InteractionSelectionOption[]) => {
    const resolutions = [...new Set(matches.map(option => option.value ?? option.label))]
    return resolutions.length === 1 ? resolutions[0] : undefined
  }

  const exactMatched = options.filter((option) => {
    const candidates = candidatesFor(option)
    return candidates.some(candidate => normalizeInteractionToken(candidate) === normalized)
  })
  if (exactMatched.length > 0) return resolveUniqueMatch(exactMatched)
  if (input.allowLooseMatch === false) return undefined

  const looseMatched = options.filter((option) => {
    const candidates = candidatesFor(option)
    return candidates.some((candidate) => {
      const normalizedCandidate = normalizeInteractionToken(candidate)
      return normalizedCandidate !== '' && (
        normalizedCandidate.includes(normalized) ||
        normalized.includes(normalizedCandidate)
      )
    })
  })
  return resolveUniqueMatch(looseMatched)
}
