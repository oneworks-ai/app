import './authorization-messages'

import type { ChannelContext } from '../@types'
import { createAuthorizationRequestCommand, createListAuthorizationCommand } from './authorization-requests'
import {
  createDenyAuthorizationCommand,
  createGrantAuthorizationCommand,
  createResumeAuthorizationCommand
} from './authorization-resolution'
import { command } from './command-system'

export const authorizationCommands = () => [
  command<ChannelContext>('auth')
    .alias('authorization')
    .description('cmd.auth.description')
    .subcommand(createAuthorizationRequestCommand())
    .subcommand(createListAuthorizationCommand())
    .subcommand(createGrantAuthorizationCommand())
    .subcommand(createDenyAuthorizationCommand())
    .subcommand(createResumeAuthorizationCommand())
    .build()
]
