const ROOT_ONLY_ARGS = new Set(['-h', '--help', '-V', '--version', 'help'])
const ROOT_SUBCOMMANDS = new Set([
  'agent',
  'adapter',
  'benchmark',
  'channel',
  'clear',
  'config',
  'daemon',
  'kill',
  'list',
  'login',
  'ls',
  'logout',
  'mem',
  'plugin',
  'report',
  'skills',
  'stop',
  'users',
  '__run'
])

export const normalizeCliArgs = (args: string[], dynamicSubcommands: Iterable<string> = []) => {
  const [firstArg] = args
  const dynamicSubcommandSet = new Set(dynamicSubcommands)

  if (firstArg == null) return ['__run']
  if (ROOT_ONLY_ARGS.has(firstArg)) return args
  if (!firstArg.startsWith('-') && (ROOT_SUBCOMMANDS.has(firstArg) || dynamicSubcommandSet.has(firstArg))) {
    return args
  }

  return ['__run', ...args]
}
