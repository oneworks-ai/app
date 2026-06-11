export const normalizeSeed = (value: unknown): string | null => {
  const seed = String(value ?? '')
    .trim()
    .replace(/[^\w-]/g, '')
    .slice(0, 64)
  return seed || null
}

export const createSessionSeed = (): string => {
  const values = new Uint32Array(2)

  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(values)
  } else {
    values[0] = Math.floor(Math.random() * 0xFFFFFFFF)
    values[1] = Date.now() >>> 0
  }

  return normalizeSeed(`${values[0].toString(36)}${values[1].toString(36)}`) ?? 'oneworks'
}

export const hashSeed = (seed: string): number => {
  let hash = 2166136261

  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return hash >>> 0
}

export const createSeededRandom = (seed: string): () => number => {
  let state = hashSeed(seed) || 0x9E3779B9

  return () => {
    state += 0x6D2B79F5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}
