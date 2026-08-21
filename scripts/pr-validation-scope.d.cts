export interface PrValidationScope {
  changedFiles: string[]
  clientBuild: boolean
  desktopPackage: boolean
  docsChanged: boolean
  docsMedia: boolean
  docsOnly: boolean
  envContract: boolean
  format: boolean
  full: boolean
  lint: boolean
  nonDocsFiles: string[]
  policyDocs: boolean
  publicDocs: boolean
  releaseDocs: boolean
  typecheck: boolean
  typecheckScopes: string[]
  unknown: boolean
  unknownFiles: string[]
  version: number
}

export interface ClassifyChangedPathsOptions {
  forceFull?: boolean
}

export interface PrValidationRangeInput {
  base?: string
  cwd?: string
  forceFull?: boolean
  head?: string
}

export interface ChangedPathEntry {
  paths: string[]
  status: string
}

export const prValidationScopeVersion: number
export const fullTypecheckScopes: string[]
export function isDocumentationPath(filePath: string): boolean
export function isPublicDocumentationPath(filePath: string): boolean
export function isReleaseDocumentationPath(filePath: string): boolean
export function isPolicyDocumentationPath(filePath: string): boolean
export function classifyChangedPaths(
  changedFiles: string[],
  options?: ClassifyChangedPathsOptions
): PrValidationScope
export function getChangedFiles(input: PrValidationRangeInput): string[]
export function getChangedFilesFromEntries(changes: ChangedPathEntry[]): string[]
export function getChangedPathEntries(input: PrValidationRangeInput): ChangedPathEntry[]
export function getPresentChangedFiles(changes: ChangedPathEntry[]): string[]
export function classifyPrValidationRange(input: PrValidationRangeInput): PrValidationScope
export function runPrValidationScope(args?: string[]): PrValidationScope
