const ROOT_ONLY_ARGS = new Set(['-h', '--help', '-V', '--version', 'help'])
const ROOT_SUBCOMMANDS = new Set([
  'agent',
  'adapter',
  'benchmark',
  'channel',
  'clear',
  'config',
  'kill',
  'list',
  'ls',
  'mem',
  'plugin',
  'report',
  'skills',
  'stop'
])

export const normalizeCliArgs = (args: string[]) => {
  const [firstArg] = args

  if (firstArg == null) return ['__run']
  if (ROOT_ONLY_ARGS.has(firstArg)) return args
  if (!firstArg.startsWith('-') && ROOT_SUBCOMMANDS.has(firstArg)) return args

  return ['__run', ...args]
}
