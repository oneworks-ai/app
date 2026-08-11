import type { ChannelContext } from '../@types'
import { accessCommands } from './cmd.access'
import { authorizationCommands } from './cmd.authorization'
import { channelControlCommands } from './cmd.channel-control'
import { generalCommands } from './cmd.general'
import { identityCommands } from './cmd.identity'
import { policyCommands } from './cmd.policy'
import { sendCommands } from './cmd.send'
import { sessionCommands } from './cmd.session'
import type { AnyCommandSpec } from './command-system'
import { listChannelCommandToolDefinitions } from './tools'

export const getPrefix = (ctx: ChannelContext): string =>
  ((ctx.config as Record<string, unknown> | undefined)?.commandPrefix as string | undefined) ?? '/'

let allCommands: AnyCommandSpec<ChannelContext>[] | undefined

export const getAllCommands = (): AnyCommandSpec<ChannelContext>[] => {
  if (allCommands) return allCommands
  allCommands = [
    ...generalCommands(getPrefix, getAllCommands),
    ...sendCommands(),
    ...identityCommands(),
    ...policyCommands(),
    ...channelControlCommands(),
    ...sessionCommands(getPrefix),
    ...authorizationCommands(),
    ...accessCommands()
  ]
  return allCommands
}

export const listRegisteredChannelCommandTools = (options: { prefix?: string } = {}) =>
  listChannelCommandToolDefinitions(getAllCommands(), options)
