import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

const DATE_DIRECTORY_MARGIN_MS = 24 * 60 * 60 * 1_000

const toDateKey = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 10)

export const listCodexSessionFiles = async (
  sessionsRoot: string,
  from: number,
  to: number
): Promise<string[]> => {
  const endKey = toDateKey(to + DATE_DIRECTORY_MARGIN_MS)
  const files: string[] = []
  const years = await readdir(sessionsRoot, { withFileTypes: true })
  for (const year of years.filter(entry => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!/^\d{4}$/u.test(year.name)) continue
    const yearPath = join(sessionsRoot, year.name)
    const months = await readdir(yearPath, { withFileTypes: true })
    for (const month of months.filter(entry => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!/^\d{2}$/u.test(month.name)) continue
      const monthPath = join(yearPath, month.name)
      const days = await readdir(monthPath, { withFileTypes: true })
      for (const day of days.filter(entry => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
        if (!/^\d{2}$/u.test(day.name)) continue
        const dateKey = `${year.name}-${month.name}-${day.name}`
        if (dateKey > endKey) continue
        const dayPath = join(monthPath, day.name)
        const entries = await readdir(dayPath, { withFileTypes: true })
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
          const filePath = join(dayPath, entry.name)
          try {
            if ((await stat(filePath)).mtimeMs >= from) files.push(filePath)
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          }
        }
      }
    }
  }
  return files.sort((left, right) => left.localeCompare(right))
}
