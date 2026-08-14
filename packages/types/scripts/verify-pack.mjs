import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const packageDir = fileURLToPath(new URL('..', import.meta.url))
const output = execFileSync('pnpm', ['pack', '--dry-run', '--json'], {
  cwd: packageDir,
  encoding: 'utf8'
})
const report = JSON.parse(output.slice(output.lastIndexOf('\n{') + 1))
const files = new Set(report.files.map(file => file.path))
const requiredFiles = [
  'dist/adapter-package-cache.d.ts',
  'dist/adapter-package-cache.js',
  'dist/adapter-package-cache.mjs',
  'dist/adapter-package-contract.d.ts',
  'dist/adapter-package.d.ts',
  'dist/adapter-package.js',
  'dist/adapter-package.mjs',
  'dist/index.d.ts',
  'dist/index.js',
  'dist/index.mjs',
  'dist/standalone-route.d.ts',
  'dist/standalone-route.js',
  'dist/standalone-route.mjs',
  'dist/relay-device-transport.d.ts',
  'dist/relay-device-transport.js',
  'dist/relay-device-transport.mjs'
]

for (const file of requiredFiles) {
  if (!files.has(file)) throw new Error(`Packed @oneworks/types artifact is missing ${file}.`)
}
