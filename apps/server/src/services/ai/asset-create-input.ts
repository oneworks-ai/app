/* eslint-disable regexp/no-super-linear-backtracking, regexp/prefer-character-class, regexp/prefer-w, no-control-regex -- bounded asset input validation needs explicit secret and forbidden-character patterns. */
import { badRequest } from '#~/utils/http.js'

export type CreatableAssetKind = 'entity' | 'spec' | 'rule'
interface AssetParam {
  description?: string
  name: string
}
export interface ValidatedCreateAssetInput {
  description: string
  kind: CreatableAssetKind
  name: string
  params: AssetParam[]
  slug: string
}

const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/iu,
  /\b(?:api[_-]?key|token|secret|password)\s*(?::|=|\s)\s*\S{4,}/iu,
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/u,
  /\b(?:AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{12,})\b/u
]
const isPlainRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype
)
const slug = (value: string) => {
  if (/[. ]$/u.test(value)) return undefined
  const normalized = value.normalize('NFKC').trim()
  if (normalized === '' || /[<>:"/\\|?*\u0000-\u001F]/u.test(normalized) || /[. ]$/u.test(normalized)) return undefined
  const stem = normalized.split('.')[0]?.toUpperCase()
  if (
    stem != null && new Set([
      'CON',
      'PRN',
      'AUX',
      'NUL',
      ...Array.from({ length: 9 }, (_, index) => `COM${index + 1}`),
      ...Array.from({ length: 9 }, (_, index) => `LPT${index + 1}`)
    ]).has(stem)
  ) return undefined
  const output = [...normalized.toLocaleLowerCase('und')].map(character =>
    /^[\p{L}\p{N}\p{M}_-]+$/u.test(character) ? character : '-'
  ).join('').replace(/-+/gu, '-').replace(/^-|-$/gu, '')
  return output === '' || output.length > 200 ? undefined : output
}
const readString = (value: unknown, field: string, maxLength: number, required = false) => {
  if (value == null && !required) return ''
  if (typeof value !== 'string') throw badRequest(`Invalid ${field}`, undefined, 'invalid_asset_input')
  const normalized = value.trim()
  if ((required && normalized === '') || normalized.length > maxLength) {
    throw badRequest(`Invalid ${field}`, undefined, 'invalid_asset_input')
  }
  if (SECRET_PATTERNS.some(pattern => pattern.test(normalized))) {
    throw badRequest('Sensitive values cannot be stored in a new data asset', undefined, 'asset_secret_rejected')
  }
  return normalized
}
export const validateCreateAssetInput = (input: unknown): ValidatedCreateAssetInput => {
  if (!isPlainRecord(input)) throw badRequest('Invalid asset request', undefined, 'invalid_asset_input')
  const allowed = new Set(['kind', 'name', 'description', 'params'])
  if (Object.keys(input).some(key => !allowed.has(key)) || Object.getOwnPropertySymbols(input).length > 0) {
    throw badRequest('Unexpected asset request field', undefined, 'invalid_asset_input')
  }
  if (input.kind !== 'entity' && input.kind !== 'spec' && input.kind !== 'rule') {
    throw badRequest('Unsupported asset kind', undefined, 'invalid_asset_kind')
  }
  if (typeof input.name !== 'string') throw badRequest('Invalid asset name', undefined, 'invalid_asset_input')
  const canonical = slug(input.name)
  if (canonical == null) throw badRequest('Invalid asset name', undefined, 'invalid_asset_name')
  const name = readString(input.name, 'asset name', 120, true)
  if (input.kind !== 'spec' && input.params != null) {
    throw badRequest('Only flows support parameters', undefined, 'invalid_asset_params')
  }
  if (input.params != null && !Array.isArray(input.params)) {
    throw badRequest('Invalid asset parameters', undefined, 'invalid_asset_params')
  }
  const params = (input.params ?? []).map(param => {
    if (
      !isPlainRecord(param) || Object.keys(param).some(key => key !== 'name' && key !== 'description') ||
      Object.getOwnPropertySymbols(param).length > 0
    ) throw badRequest('Invalid asset parameter', undefined, 'invalid_asset_params')
    return {
      name: readString(param.name, 'parameter name', 80, true),
      ...(param.description == null
        ? {}
        : { description: readString(param.description, 'parameter description', 500) })
    }
  })
  if (params.length > 30 || new Set(params.map(param => param.name.toLowerCase())).size !== params.length) {
    throw badRequest('Invalid asset parameters', undefined, 'invalid_asset_params')
  }
  return {
    description: readString(input.description, 'asset description', 2000),
    kind: input.kind,
    name,
    params,
    slug: canonical
  }
}
export const renderCreatedAsset = (input: ValidatedCreateAssetInput) => {
  const metadata = [
    `name: ${JSON.stringify(input.name)}`,
    ...(input.description === '' ? [] : [`description: ${JSON.stringify(input.description)}`]),
    ...(input.kind === 'spec' && input.params.length > 0
      ? [
        'params:',
        ...input.params.flatMap(
          param => [
            `  - name: ${JSON.stringify(param.name)}`,
            ...(param.description == null || param.description === ''
              ? []
              : [`    description: ${JSON.stringify(param.description)}`])
          ]
        )
      ]
      : [])
  ]
  return `---\n${metadata.join('\n')}\n---\n\n# ${input.name}\n`
}
