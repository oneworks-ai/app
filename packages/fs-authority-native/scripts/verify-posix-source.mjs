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
const darwinTree = read('src/darwin-tree.cc')
const darwinTreeCleanup = read('src/darwin-tree-cleanup.cc')
const broker = read('broker.cjs')
const loader = read('loader.cjs')
const managedTree = read('managed-tree-session.cjs')
const transport = read('transport.cjs')
assert(darwin.includes('O_NOFOLLOW_ANY'), 'macOS target opens must reject symlinks')
assert(
  darwin.includes('fclonefileat') && darwin.includes('CLONE_NOFOLLOW_ANY'),
  'macOS publication must use a no-follow clone'
)
assert(darwin.includes('F_FULLFSYNC'), 'macOS stage durability must use F_FULLFSYNC')
assert(darwinTree.includes('O_NOFOLLOW_ANY'), 'managed tree traversal must reject symlinks')
assert(
  darwinTree.includes('renameatx_np') && darwinTree.includes('RENAME_EXCL'),
  'managed tree quarantine and restore must be no-clobber descriptor-relative renames'
)
assert(
  darwinTreeCleanup.includes('Current(child_link)') && darwinTreeCleanup.includes('unlinkat'),
  'managed tree recursive cleanup must revalidate the complete descriptor chain'
)
assert(
  darwinTree.includes('unlinkat') && darwinTree.includes('AT_REMOVEDIR'),
  'managed tree cleanup must remain descriptor-relative'
)
assert(
  darwinTree.includes('expected_parent_identity') && managedTree.includes('parentIdentity'),
  'managed tree transactions must bind the resolved parent identity'
)
assert(
  broker.indexOf('verifySocketPeer(binding, socket, true)') < broker.indexOf('const session = createSession'),
  'broker peer verification must precede session creation'
)
assert(
  broker.indexOf('await listen(server, endpoint, controlRoot)') < broker.indexOf('database.recover(epoch)'),
  'broker endpoint ownership must precede claim recovery'
)
assert(loader.includes("typeof cached?.treeSync !== 'function'"), 'loader must validate the treeSync native export')
assert(transport.includes('verifySocketPeer(binding, socket, false)'), 'client must verify the local broker peer')
process.stdout.write('Verified macOS authority source gates\n')
