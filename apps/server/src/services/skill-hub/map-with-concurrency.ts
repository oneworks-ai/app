export const mapWithConcurrency = async <TItem, TResult>(
  items: TItem[],
  concurrency: number,
  worker: (item: TItem) => Promise<TResult>
) => {
  const results: TResult[] = []
  let nextIndex = 0
  const runWorker = async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++
      results[currentIndex] = await worker(items[currentIndex]!)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, runWorker)
  )
  return results
}
