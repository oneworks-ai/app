export async function deliverCommand(command, dependencies) {
  const { connection, execute, post, sanitizeResult, sleep, uploadLargeArtifact } = dependencies
  let acknowledgement
  try {
    acknowledgement = { command_id: command.command_id, ok: true, result: sanitizeResult(await execute(command)) }
  } catch (operationError) {
    acknowledgement = {
      command_id: command.command_id,
      ok: false,
      error: {
        code: operationError.code ?? 'CHROME_OPERATION_FAILED',
        message: operationError.message,
        advanced_access_key: operationError.advanced_access_key,
        recoverable: operationError.recoverable !== false,
        missing_permissions: operationError.missing_permissions,
        user_action: operationError.user_action
      }
    }
  }
  if (acknowledgement.ok === true) {
    acknowledgement = { ...acknowledgement, result: await uploadLargeArtifact(acknowledgement.result, connection) }
  }
  const body = { ...acknowledgement, bridge_url: connection.bridge_url }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await post('/v1/extensions/ack', body, connection.session_token)
      return
    } catch (ackError) {
      if (attempt === 2) throw ackError
      await sleep(100 * (attempt + 1))
    }
  }
}
