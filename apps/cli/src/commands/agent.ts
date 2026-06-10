import type { Command } from 'commander'

import { runAgentAction, runAgentCommand, runAgentEvents, runAgentStart, runAgentStatus } from './agent/actions'
import type { AgentEventsOptions, AgentSessionOptions, AgentStartOptions } from './agent/actions'

export function registerAgentCommand(program: Command) {
  const agentCommand = program
    .command('agent')
    .description('Operate agent runtime sessions through the runtime store protocol')

  agentCommand
    .command('start')
    .description('Create a runtime session store and queue the initial start command')
    .requiredOption('--entity <entity>', 'Entity key to start, for example dev or qa')
    .requiredOption('--message <message>', 'Initial user message for the runtime session')
    .option('--title <title>', 'Display title for the runtime session')
    .option('--host-session <session>', 'Parent host session id for automatic room binding')
    .option('--room <room>', 'Existing agent room id to attach to')
    .option('--room-title <title>', 'Agent room title hint when a room is created')
    .option('--avatar <avatar>', 'Avatar label shown for this room member')
    .option('--json', 'Print JSON output', false)
    .action((opts: AgentStartOptions) => runAgentAction(() => runAgentStart(opts)))

  agentCommand
    .command('send')
    .description('Queue a message for an existing runtime session')
    .requiredOption('--session <session>', 'Runtime session id')
    .requiredOption('--message <message>', 'Message to send')
    .option('--json', 'Print JSON output', false)
    .action((opts: AgentSessionOptions & { session: string }) =>
      runAgentAction(() => runAgentCommand(opts, 'send_message'))
    )

  agentCommand
    .command('stop')
    .description('Queue a graceful stop command for an existing runtime session')
    .requiredOption('--session <session>', 'Runtime session id')
    .option('--json', 'Print JSON output', false)
    .action((opts: AgentSessionOptions & { session: string }) => runAgentAction(() => runAgentCommand(opts, 'stop')))

  agentCommand
    .command('kill')
    .description('Queue a force-kill command for an existing runtime session')
    .requiredOption('--session <session>', 'Runtime session id')
    .option('--json', 'Print JSON output', false)
    .action((opts: AgentSessionOptions & { session: string }) => runAgentAction(() => runAgentCommand(opts, 'kill')))

  agentCommand
    .command('submit')
    .description('Queue a response to a pending runtime input request')
    .requiredOption('--session <session>', 'Runtime session id')
    .requiredOption('--request <request>', 'Pending input or approval request id')
    .requiredOption('--value <value>', 'Submitted value')
    .option('--json', 'Print JSON output', false)
    .action((opts: AgentSessionOptions & { session: string }) =>
      runAgentAction(() => runAgentCommand(opts, 'submit_input'))
    )

  agentCommand
    .command('resume')
    .description('Queue a resume command and optional follow-up message')
    .requiredOption('--session <session>', 'Runtime session id')
    .requiredOption('--message <message>', 'Resume message')
    .option('--json', 'Print JSON output', false)
    .action((opts: AgentSessionOptions & { session: string }) => runAgentAction(() => runAgentCommand(opts, 'resume')))

  agentCommand
    .command('status')
    .description('Read runtime session status from state, heartbeat, and metadata files')
    .requiredOption('--session <session>', 'Runtime session id')
    .option('--json', 'Print JSON output', false)
    .action((opts: AgentSessionOptions & { session: string }) => runAgentAction(() => runAgentStatus(opts)))

  agentCommand
    .command('events')
    .description('Read or follow runtime session events')
    .requiredOption('--session <session>', 'Runtime session id')
    .option('--follow', 'Keep following the events.jsonl file', false)
    .option('--jsonl', 'Print JSON Lines output', false)
    .action((opts: AgentEventsOptions & { session: string }) => runAgentAction(() => runAgentEvents(opts)))
}
