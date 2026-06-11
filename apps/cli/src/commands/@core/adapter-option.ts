import { Option } from 'commander'

import { normalizeAdapterPackageId } from '@oneworks/types'

const ADAPTER_PREFIX = 'adapter-'

export interface CliAdapterOptionValue {
  adapter: string
  cliVersion?: string
}

const splitAdapterVersionSelector = (value: string) => {
  const lastAt = value.lastIndexOf('@')
  if (lastAt <= 0) {
    return {
      adapter: value
    }
  }

  if (value.startsWith('@')) {
    const slash = value.indexOf('/')
    if (slash < 0 || lastAt <= slash) {
      return {
        adapter: value
      }
    }
  }

  const adapter = value.slice(0, lastAt).trim()
  const cliVersion = value.slice(lastAt + 1).trim()
  if (adapter === '' || cliVersion === '') {
    throw new TypeError('Adapter version selector must be formatted as <adapter>@<version>.')
  }
  if (/\s/.test(cliVersion)) {
    throw new TypeError('Adapter CLI version must not contain whitespace.')
  }

  return {
    adapter,
    cliVersion
  }
}

export const parseCliAdapterOptionValue = (value: string): CliAdapterOptionValue => {
  const trimmed = value.trim()
  if (trimmed === '') {
    return {
      adapter: trimmed
    }
  }

  const selector = splitAdapterVersionSelector(trimmed)
  const normalized = normalizeAdapterPackageId(selector.adapter)
  const adapter = normalized.startsWith(ADAPTER_PREFIX)
    ? normalized.slice(ADAPTER_PREFIX.length)
    : normalized

  return {
    adapter,
    cliVersion: selector.cliVersion
  }
}

export const normalizeCliAdapterOptionValue = (value: string) => {
  return parseCliAdapterOptionValue(value).adapter
}

const normalizeCliAdapterSelectorOptionValue = (value: string) => {
  const parsed = parseCliAdapterOptionValue(value)
  return parsed.cliVersion == null ? parsed.adapter : `${parsed.adapter}@${parsed.cliVersion}`
}

export const createAdapterOption = (
  description: string,
  options?: {
    allowCliVersion?: boolean
  }
) => (
  new Option('-A, --adapter <adapter>', description)
    .argParser(
      options?.allowCliVersion === true
        ? normalizeCliAdapterSelectorOptionValue
        : normalizeCliAdapterOptionValue
    )
)
