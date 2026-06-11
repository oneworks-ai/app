import process from 'node:process'

export const resolveRuntimeProtocolCliCommand = (env: NodeJS.ProcessEnv = process.env) => {
  const prefix = env.__ONEWORKS_CLI_RESUME_COMMAND_PREFIX__?.trim()
  if (prefix == null || prefix === '') {
    return 'oneworks'
  }
  return prefix
}

export const buildManagedTaskToolGuidance = () => {
  const runtimeCliCommand = resolveRuntimeProtocolCliCommand()
  const runtimeProtocolCommand = `${runtimeCliCommand} --input-format stream-json --output-format stream-json`

  return [
    'Agent runtime guide:',
    `- Use unified CLI protocol mode, \`${runtimeProtocolCommand}\`, to start a child runtime session when the work should run in a separate entity or continue independently from the current turn.`,
    '- Send typed runtime protocol envelopes such as `session.start`, `session.message`, `session.status`, `session.events`, `session.submit`, and `session.stop`; do not treat dedicated agent subcommands as the standard integration surface.',
    '- Ordinary new sessions stay session-scoped. A room is created or discovered only when a unified CLI runtime protocol start command launches a child runtime session from a server-managed host session and the server projects runtime store metadata/events.',
    '- Do not use MCP task tools, dedicated agent subcommands, legacy StartTasks, hand-written DB edits, or ad-hoc TS scripts as the task consumer surface. Use CLI protocol mode and the runtime protocol/store for start, status, events, follow-up messages, input submission, and cancellation.',
    '- Server-managed host sessions inject the current adapter, model, effort, and permission mode as runtime protocol defaults. Omit these fields to inherit the host selection, or set them explicitly only when a child task must use a different runtime profile.',
    '- Copyable JSONL example; write one `session.start` line per child task, and use multiple lines for multiple subtasks:',
    '```bash',
    `cat <<'JSONL' | ${runtimeProtocolCommand}`,
    '{"commandId":"start-planner","type":"session.start","payload":{"title":"Plan Agent Room UI fix","message":"Plan the frontend changes and tests for the Agent Room UI fix.","entity":"dev-planner","background":true},"title":"Plan Agent Room UI fix","message":"Plan the frontend changes and tests for the Agent Room UI fix.","entity":"dev-planner","background":true}',
    '{"commandId":"start-reviewer","type":"session.start","payload":{"title":"Review Agent Room UI fix","message":"Review the implemented Agent Room UI fix for regressions and missing tests.","entity":"dev-reviewer","background":true},"title":"Review Agent Room UI fix","message":"Review the implemented Agent Room UI fix for regressions and missing tests.","entity":"dev-reviewer","background":true}',
    'JSONL',
    '```',
    '- Keep `payload.title`, `payload.message`, `payload.entity`, and `payload.background: true` explicit in each start envelope. The mirrored top-level fields make the JSONL executable by the current runtime protocol reader.',
    '- Include a short `title` when the task prompt is long; it becomes the child session title and room run label. Put any room or workspace context in the title and initial message.',
    '- Read the returned `sessionId` and use it for follow-up protocol commands. Read the latest runtime snapshot from the runtime store or a `session.status` protocol command, and read progress from runtime events or a `session.events` protocol command.',
    '- Use a follow/read-events workflow when you need to watch progress instead of repeatedly restarting work.',
    '- Use a `session.message` protocol command to give an existing session another instruction. Running sessions continue immediately; completed or failed sessions resume the same conversation when the runtime allows resume.',
    '- When the chat UI sends a `[ROOM_TASK_MESSAGE] ... [/ROOM_TASK_MESSAGE]` block, treat it as a runtime relay envelope instead of ordinary prose. Parse the `sessionId` or legacy `taskId`, `message`, and optional `mode` / `request` fields. If the envelope indicates `mode: interaction`, or runtime status shows `waiting_input` / pending input, use a `session.submit` protocol command. Otherwise use `session.message`. Do not reply inline instead of routing the relay.',
    '- Use `session.submit` only when a runtime session is waiting for an explicit input or approval request. Do not use it for ordinary follow-up instructions.',
    '- Use a `session.stop` protocol command for graceful cancellation and set `mode` to `force` only when stop cannot recover the session.',
    '- Compatibility aliases such as dedicated agent start/status/events/send/submit/stop subcommands may exist for debugging or legacy scripts, but they are not the primary guidance for new agent workflows.',
    '- When a session is still making progress, use `wait` between checks and inspect status/events instead of starting a replacement session.'
  ].join('\n')
}
