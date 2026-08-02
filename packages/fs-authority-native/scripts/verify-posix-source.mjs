import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = path => readFileSync(resolve(root, path), 'utf8')
const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const darwin = read('src/darwin.cc')
const broker = read('broker.cjs')
const transport = read('transport.cjs')
assert(darwin.includes('O_NOFOLLOW_ANY'), 'macOS target opens must reject symlinks')
assert(
  darwin.includes('fclonefileat') && darwin.includes('CLONE_NOFOLLOW_ANY'),
  'macOS publication must use a no-follow clone'
)
assert(darwin.includes('F_FULLFSYNC'), 'macOS stage durability must use F_FULLFSYNC')
assert(
  broker.indexOf('verifySocketPeer(binding, socket, true)') < broker.indexOf('const session = createSession'),
  'broker peer verification must precede session creation'
)
assert(transport.includes('verifySocketPeer(binding, socket, false)'), 'client must verify the local broker peer')
process.stdout.write('Verified macOS authority source gates\n')
