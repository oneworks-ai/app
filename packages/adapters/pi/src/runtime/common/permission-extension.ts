import type { AdapterQueryOptions } from '@oneworks/types'

export const PI_PERMISSION_PREFIX = '[oneworks-pi-permission]'
export const PI_PERMISSION_ALLOW = 'Allow'
export const PI_PERMISSION_DENY = 'Deny'

export type PiConfiguredPermission = 'allow' | 'ask' | 'deny' | 'inherit'

export const buildPiPermissionExtension = (params: {
  configuredPermissions: Record<string, PiConfiguredPermission>
  guardUnknownTools: boolean
  oneTimePermissions?: Record<string, { decision: 'allow' | 'deny'; key: string }>
  permissionMode: AdapterQueryOptions['permissionMode']
  sessionId: string
}) =>
  `
const PREFIX = ${JSON.stringify(PI_PERMISSION_PREFIX)};
const MODE = ${JSON.stringify(params.permissionMode ?? 'default')};
const CONFIGURED = ${JSON.stringify(params.configuredPermissions)};
const GUARD_UNKNOWN_TOOLS = ${JSON.stringify(params.guardUnknownTools)};
const ONE_TIME = new Map(Object.entries(${JSON.stringify(params.oneTimePermissions ?? {})}));
const SESSION_ID = ${JSON.stringify(params.sessionId)};
const MUTATING = new Set(['bash', 'edit', 'write']);
const READ_ONLY = new Set(['read', 'grep', 'find', 'ls']);

function normalizeServerHost(host) {
  const value = String(host || '').trim();
  if (value === '0.0.0.0') return '127.0.0.1';
  if (value === '::' || value === '[::]' || value === '::1' || value === '[::1]') return '[::1]';
  return value.includes(':') && !value.startsWith('[') ? '[' + value + ']' : value;
}

async function resolveServerDecision(toolName, input, signal) {
  const host = process.env.__ONEWORKS_PROJECT_SERVER_HOST__;
  const port = process.env.__ONEWORKS_PROJECT_SERVER_PORT__;
  if (!host || !port) return undefined;
  try {
    const timeoutSignal = AbortSignal.timeout(1500);
    const response = await fetch('http://' + normalizeServerHost(host) + ':' + port + '/api/interact/permission-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: SESSION_ID, adapter: 'pi', toolName, toolInput: input || {} }),
      signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
    });
    if (!response.ok) return undefined;
    const body = await response.json();
    const payload = body?.success === true && body.data && typeof body.data === 'object' ? body.data : body;
    const result = payload?.result;
    return result === 'allow' || result === 'ask' || result === 'deny' || result === 'inherit'
      ? { result, source: payload.source }
      : undefined;
  } catch {
    return undefined;
  }
}

function takeOneTime(toolName) {
  const record = ONE_TIME.get(toolName);
  if (!record) return undefined;
  for (const [alias, candidate] of ONE_TIME) {
    if (candidate.key === record.key) ONE_TIME.delete(alias);
  }
  return record;
}

export default function (pi) {
  pi.on('tool_call', async (event, ctx) => {
    const toolName = String(event.toolName || '').toLowerCase();
    const guardedByDefault = MUTATING.has(toolName) || (GUARD_UNKNOWN_TOOLS && !READ_ONLY.has(toolName));
    if (MODE === 'bypassPermissions') return undefined;
    if (MODE === 'plan' && guardedByDefault) {
      return { block: true, reason: 'One Works plan mode blocks mutating Pi tools.' };
    }
    const serverConfigured = Boolean(process.env.__ONEWORKS_PROJECT_SERVER_HOST__ && process.env.__ONEWORKS_PROJECT_SERVER_PORT__);
    if (!serverConfigured) {
      const oneTimeRecord = takeOneTime(toolName);
      const configured = oneTimeRecord?.decision ?? CONFIGURED[toolName] ?? 'inherit';
      if (configured === 'deny') {
        return { block: true, reason: 'Blocked by an explicit One Works permission.' };
      }
      if (configured === 'allow') return undefined;
      if (!guardedByDefault && configured !== 'ask') return undefined;
      const shouldAsk = configured === 'ask' || (
        MODE !== 'dontAsk' && !(MODE === 'acceptEdits' && (toolName === 'edit' || toolName === 'write'))
      );
      if (!shouldAsk) return undefined;
      if (!ctx.hasUI) return { block: true, reason: 'One Works permission UI is unavailable.' };

      const title = PREFIX + JSON.stringify({ toolName, input: event.input || {} });
      const choice = await ctx.ui.select(title, [${JSON.stringify(PI_PERMISSION_ALLOW)}, ${
    JSON.stringify(PI_PERMISSION_DENY)
  }], { signal: ctx.signal });
      return choice === ${JSON.stringify(PI_PERMISSION_ALLOW)}
        ? undefined
        : { block: true, reason: 'Blocked by One Works permission policy.' };
    }

    const serverResponse = await resolveServerDecision(toolName, event.input, ctx.signal);
    if (serverResponse == null) {
      return { block: true, reason: 'One Works permission server is unavailable.' };
    }
    takeOneTime(toolName);
    const configured = serverResponse.result;
    if (configured === 'deny') {
      return { block: true, reason: 'Blocked by an explicit One Works permission.' };
    }
    if (configured === 'allow') return undefined;
    if (!guardedByDefault && configured !== 'ask') return undefined;
    const shouldAsk = configured === 'ask' || (
      MODE !== 'dontAsk' && !(MODE === 'acceptEdits' && (toolName === 'edit' || toolName === 'write'))
    );
    if (!shouldAsk) return undefined;
    if (!ctx.hasUI) return { block: true, reason: 'One Works permission UI is unavailable.' };

    const title = PREFIX + JSON.stringify({ toolName, input: event.input || {} });
    const choice = await ctx.ui.select(title, [${JSON.stringify(PI_PERMISSION_ALLOW)}, ${
    JSON.stringify(PI_PERMISSION_DENY)
  }], { signal: ctx.signal });
    return choice === ${JSON.stringify(PI_PERMISSION_ALLOW)}
      ? undefined
      : { block: true, reason: 'Blocked by One Works permission policy.' };
  });
}
`.trimStart()
