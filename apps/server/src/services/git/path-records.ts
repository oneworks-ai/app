import { sep } from 'node:path'

export const stripGitPathLineEndings = (value: string) => (
  sep === '\\' && value.endsWith('\r\n')
    ? value.slice(0, -2)
    : value.endsWith('\n')
    ? value.slice(0, -1)
    : value
)

export const splitGitNulRecords = (value: string) => {
  const records = value.split('\0')
  if (records.at(-1) === '') records.pop()
  return records
}
