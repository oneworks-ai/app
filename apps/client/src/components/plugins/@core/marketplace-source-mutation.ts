const sourceMutationTails = new Map<string, Promise<void>>()

export const serializeMarketplaceSourceMutation = async <T>(
  serverKey: string,
  mutate: () => Promise<T>
): Promise<T> => {
  const previous = sourceMutationTails.get(serverKey) ?? Promise.resolve()
  const pending = previous.catch(() => undefined).then(mutate)
  const tail = pending.then(() => undefined, () => undefined)
  sourceMutationTails.set(serverKey, tail)
  try {
    return await pending
  } finally {
    if (sourceMutationTails.get(serverKey) === tail) {
      sourceMutationTails.delete(serverKey)
    }
  }
}
