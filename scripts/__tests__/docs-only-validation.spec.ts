import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  collectMarkdownAnchors,
  collectRemovedDocumentationPaths,
  runDocsOnlyValidation,
  validateAddedLinePrivacy,
  validateImpactedDocumentationLinks,
  validateMarkdownLinks,
  validateReleaseDocumentation
} from '../docs-only-validation.mjs'

describe('docs-only validation', () => {
  it('checks relative files and heading anchors while ignoring fenced examples', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'oneworks-doc-links-'))
    mkdirSync(path.join(root, 'docs'), { recursive: true })
    writeFileSync(path.join(root, 'docs', 'target.md'), '# Target Heading\n')
    const content = [
      '# Source',
      '[valid](./target.md#target-heading)',
      '[reference][target]',
      '[target]: ./target.md#target-heading',
      '```md',
      '[example](./does-not-exist.md)',
      '```'
    ].join('\n')

    expect(validateMarkdownLinks({ content, filePath: 'docs/source.md', root })).toEqual([])
    expect(validateMarkdownLinks({
      content: `${content}\n[missing](./target.md#missing)`,
      filePath: 'docs/source.md',
      root
    })).toEqual(['docs/source.md: missing anchor #missing in ./target.md'])
    expect(validateMarkdownLinks({
      content: `${content}\n[missing-reference]: ./does-not-exist.md`,
      filePath: 'docs/source.md',
      root
    })).toEqual(['docs/source.md: does not exist: ./does-not-exist.md'])
  })

  it('matches GitHub-style duplicate and CJK heading anchors', () => {
    expect([...collectMarkdownAnchors([
      '# 权限预检与审批恢复',
      '## Repeated Heading',
      '## Repeated Heading'
    ].join('\n'))]).toEqual([
      '权限预检与审批恢复',
      'repeated-heading',
      'repeated-heading-1'
    ])
  })

  it('rejects added personal paths and token-shaped secrets but permits placeholders', () => {
    expect(validateAddedLinePrivacy([
      { filePath: 'README.md', line: 'Use /Users/alice/project.', lineNumber: 4 },
      { filePath: 'README.md', line: 'Use /Users/<user>/project.', lineNumber: 5 },
      { filePath: 'README.md', line: 'Token gho_abcdefghijklmnopqrstuvwxyz1234', lineNumber: 6 }
    ])).toEqual([
      'README.md:4: added personal macOS home path',
      'README.md:6: added GitHub token'
    ])
  })

  it('preflights changelog structure and coordinated release headings', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'oneworks-release-docs-'))
    mkdirSync(path.join(root, 'changelog', '1.2.3'), { recursive: true })
    writeFileSync(path.join(root, 'changelog', '1.2.3', 'readme.md'), '# One Works 1.2.3\n')

    expect(validateReleaseDocumentation({
      changedFiles: ['changelog/1.2.3/readme.md', '.oo/rules/release/process.md'],
      root
    })).toEqual([])
    expect(validateReleaseDocumentation({
      changedFiles: ['changelog/not-a-version/readme.md'],
      root
    })).toEqual([
      'changelog/not-a-version/readme.md: expected changelog/<semver>/<entry>.md'
    ])
  })

  it('rejects unchanged inbound links to deleted documentation', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'oneworks-doc-delete-links-'))
    mkdirSync(path.join(root, 'docs'), { recursive: true })
    writeFileSync(
      path.join(root, 'docs', 'source.md'),
      '[Removed guide][removed]\n\n[removed]: ./removed.md\n'
    )

    expect(validateImpactedDocumentationLinks({
      removedFiles: ['docs/removed.md'],
      root,
      trackedMarkdownFiles: ['docs/source.md']
    })).toEqual([
      'docs/source.md: links to removed documentation path docs/removed.md'
    ])
  })

  it('treats the old side of a rename as removed but not the source of a copy', () => {
    expect(collectRemovedDocumentationPaths([
      { paths: ['docs/deleted.md'], status: 'D' },
      { paths: ['docs/old.md', 'docs/new.md'], status: 'R100' },
      { paths: ['docs/source.md', 'docs/copy.md'], status: 'C100' }
    ])).toEqual(['docs/deleted.md', 'docs/old.md'])

    const root = mkdtempSync(path.join(tmpdir(), 'oneworks-doc-rename-links-'))
    mkdirSync(path.join(root, 'docs'), { recursive: true })
    writeFileSync(path.join(root, 'docs', 'index.md'), '[Old guide](./old)\n')
    writeFileSync(path.join(root, 'docs', 'new.md'), '# New guide\n')

    expect(validateImpactedDocumentationLinks({
      changedFiles: ['docs/old.md', 'docs/new.md'],
      removedFiles: ['docs/old.md'],
      root,
      trackedMarkdownFiles: ['docs/index.md', 'docs/new.md']
    })).toEqual([
      'docs/index.md: links to removed documentation path docs/old.md'
    ])
  })

  it('checks reference-style inbound anchors when a target heading changes', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'oneworks-doc-anchor-links-'))
    mkdirSync(path.join(root, 'docs'), { recursive: true })
    writeFileSync(path.join(root, 'docs', 'index.md'), '[Old section][section]\n\n[section]: ./target.md#old-section\n')
    writeFileSync(path.join(root, 'docs', 'target.md'), '# New section\n')

    expect(validateImpactedDocumentationLinks({
      changedFiles: ['docs/target.md'],
      removedFiles: [],
      root,
      trackedMarkdownFiles: ['docs/index.md', 'docs/target.md']
    })).toEqual([
      'docs/index.md: missing anchor #old-section in docs/target.md'
    ])
  })

  it('fails a mixed range when a documentation deletion leaves an unchanged inbound link', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'oneworks-doc-delete-range-'))
    const git = (args: string[]) =>
      execFileSync('git', args, {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      }).trim()
    git(['init', '--quiet'])
    git(['config', 'user.name', 'One Works Test'])
    git(['config', 'user.email', 'test@example.com'])
    mkdirSync(path.join(root, 'docs'), { recursive: true })
    writeFileSync(path.join(root, 'docs', 'index.md'), '[Guide](./guide.md)\n')
    writeFileSync(path.join(root, 'docs', 'guide.md'), '# Guide\n')
    writeFileSync(path.join(root, 'runtime.ts'), 'export const value = 1\n')
    git(['add', '.'])
    git(['commit', '--quiet', '-m', 'docs: add guide'])
    const base = git(['rev-parse', 'HEAD'])

    unlinkSync(path.join(root, 'docs', 'guide.md'))
    writeFileSync(path.join(root, 'runtime.ts'), 'export const value = 2\n')
    git(['add', '--all'])
    git(['commit', '--quiet', '-m', 'docs: remove guide'])

    expect(() =>
      runDocsOnlyValidation(
        ['--base', base, '--head', 'HEAD', '--allow-mixed'],
        { cwd: root }
      )
    ).toThrow('docs/index.md: links to removed documentation path docs/guide.md')
  })

  it('keeps privacy validation active for documentation in a mixed range', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'oneworks-doc-mixed-privacy-'))
    const git = (args: string[]) =>
      execFileSync('git', args, {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      }).trim()
    git(['init', '--quiet'])
    git(['config', 'user.name', 'One Works Test'])
    git(['config', 'user.email', 'test@example.com'])
    writeFileSync(path.join(root, 'README.md'), '# Guide\n')
    writeFileSync(path.join(root, 'runtime.ts'), 'export const value = 1\n')
    git(['add', '.'])
    git(['commit', '--quiet', '-m', 'test: add baseline'])
    const base = git(['rev-parse', 'HEAD'])

    writeFileSync(path.join(root, 'README.md'), '# Guide\nToken gho_abcdefghijklmnopqrstuvwxyz1234\n')
    writeFileSync(path.join(root, 'runtime.ts'), 'export const value = 2\n')
    git(['add', '--all'])
    git(['commit', '--quiet', '-m', 'test: update source and docs'])

    expect(() =>
      runDocsOnlyValidation(
        ['--base', base, '--head', 'HEAD', '--allow-mixed'],
        { cwd: root }
      )
    ).toThrow('README.md:2: added GitHub token')
  })
})
