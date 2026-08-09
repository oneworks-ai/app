import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import process from 'node:process'

const SOURCE_EXTENSION_PATTERN = /\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/u
const GENERATED_SOURCE_PATH_PATTERNS = [
  /^apps\/relay-server\/src\/routes\/assets\/.*\.bundle\.js$/u
]
const PRIVATE_TOKEN_PATTERN = /__[A-Z][A-Z0-9_]*__/gu
const ALLOWED_NON_ENV_PRIVATE_TOKENS = new Set([
  '__D__',
  '__I__',
  '__INTERNAL__',
  '__TEST_ONLY__'
])
const LEGACY_CLI_LOADER_TOKEN = ['__IS_', 'LOADER_CLI__'].join('')
const LEGACY_HOOK_LOADER_TOKEN = ['__IS_', 'ONEWORKS_HOOK_LOADER__'].join('')
const LEGACY_TOKEN_ALLOWED_FILES = new Map([
  [
    LEGACY_CLI_LOADER_TOKEN,
    new Set([
      'apps/bootstrap/__tests__/desktop-app.spec.ts',
      'apps/desktop/__tests__/runtime-consumer-cli-path.spec.ts',
      'apps/desktop/scripts/smoke-packaged-server.cjs',
      'apps/vscode-extension/__tests__/server-env.spec.ts',
      'scripts/__tests__/desktop-cdp.spec.ts',
      'packages/adapters/codex/__tests__/session-rpc.spec.ts',
      'packages/cli-helper/__tests__/loader.spec.ts',
      'packages/utils/__tests__/process-env.spec.ts',
      'packages/utils/src/process-env.ts'
    ])
  ],
  [
    LEGACY_HOOK_LOADER_TOKEN,
    new Set([
      'apps/desktop/__tests__/runtime-consumer-cli-path.spec.ts',
      'apps/desktop/scripts/smoke-packaged-server.cjs',
      'packages/hooks/__tests__/managed-runtime.spec.ts',
      'packages/utils/__tests__/process-env.spec.ts',
      'packages/utils/src/process-env.ts'
    ])
  ]
])

const sourceFiles = execFileSync(
  'git',
  ['ls-files', '-co', '--exclude-standard', '-z'],
  { encoding: 'utf8' }
)
  .split('\0')
  .filter(filePath => (
    filePath !== '' &&
    SOURCE_EXTENSION_PATTERN.test(filePath) &&
    !GENERATED_SOURCE_PATH_PATTERNS.some(pattern => pattern.test(filePath))
  ))

const violations = []
for (const filePath of sourceFiles) {
  const lines = readFileSync(filePath, 'utf8').split(/\r?\n/u)
  lines.forEach((line, index) => {
    for (const match of line.matchAll(PRIVATE_TOKEN_PATTERN)) {
      const token = match[0]
      if (token.startsWith('__ONEWORKS_') || ALLOWED_NON_ENV_PRIVATE_TOKENS.has(token)) {
        continue
      }
      if (LEGACY_TOKEN_ALLOWED_FILES.get(token)?.has(filePath) === true) {
        continue
      }
      violations.push(`${filePath}:${index + 1}: ${token}`)
    }
  })
}

if (violations.length > 0) {
  console.error(
    [
      'Private process-control names must use the __ONEWORKS_*__ namespace.',
      'Use ONEWORKS_* for public configuration and ONEWORKS_TEST_* for test-only controls.',
      ...violations
    ].join('\n')
  )
  process.exit(1)
}

console.log(`Environment contract verified across ${sourceFiles.length} repository source files.`)
