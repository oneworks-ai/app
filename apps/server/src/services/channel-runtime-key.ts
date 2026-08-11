/** Encodes compound channel-runtime identifiers without embedding NUL bytes in SQLite TEXT values. */
export const encodeChannelRuntimeKey = (...parts: readonly string[]) => JSON.stringify(parts)
