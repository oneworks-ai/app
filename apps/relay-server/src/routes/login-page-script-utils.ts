export const safeJson = (value: unknown) => (JSON.stringify(value) ?? 'null').replaceAll('<', '\\u003c')
