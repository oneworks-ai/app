import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cwd as getCwd, stdout } from 'node:process'

const readFirstLine = (path) => {
  const content = readFileSync(path, 'utf8')
  return content.split(/\r?\n/, 1)[0]
}

const cwd = getCwd()
const notesPath = resolve(cwd, 'fixtures/notes.md')

stdout.write(`${
  JSON.stringify(
    {
      cwd,
      hasConfig: existsSync(resolve(cwd, '.oo.config.json')),
      hasDebugRule: existsSync(resolve(cwd, '.oo/rules/DEBUG.md')),
      notesTitle: readFirstLine(notesPath)
    },
    null,
    2
  )
}\n`)
