import type { PrValidationScope } from './pr-validation-scope.cjs'

export interface AddedDocumentationLine {
  filePath: string
  line: string
  lineNumber: number
}

export function collectMarkdownAnchors(content: string): Set<string>
export function collectRemovedDocumentationPaths(
  changes: Array<{ paths: string[]; status: string }>
): string[]
export function validateMarkdownLinks(input: {
  content: string
  filePath: string
  gitlinks?: string[]
  root: string
}): string[]
export function validateImpactedDocumentationLinks(input: {
  changedFiles?: string[]
  readFile?: (path: string, encoding: 'utf8') => string
  removedFiles: string[]
  root?: string
  trackedMarkdownFiles?: string[]
}): string[]
export function validateAddedLinePrivacy(addedLines: AddedDocumentationLine[]): string[]
export function validateReleaseDocumentation(input: {
  changedFiles: string[]
  readFile?: (path: string, encoding: 'utf8') => string
  root?: string
}): string[]
export function runDocsOnlyValidation(
  args?: string[],
  options?: { cwd?: string }
): { scope: PrValidationScope; violations: string[] }
