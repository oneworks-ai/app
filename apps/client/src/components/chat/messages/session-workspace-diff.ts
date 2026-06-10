export interface SessionWorkspaceParsedPatch {
  original: string
  modified: string
}

export const parseUnifiedPatchForMonaco = (patch: string): SessionWorkspaceParsedPatch | undefined => {
  const originalLines: string[] = []
  const modifiedLines: string[] = []
  let hasHunk = false
  let hasBodyLine = false

  for (const line of patch.replace(/\r\n/g, '\n').split('\n')) {
    if (line.startsWith('diff --git ') && hasHunk) {
      break
    }

    if (line.startsWith('@@')) {
      if (hasHunk) {
        originalLines.push('')
        modifiedLines.push('')
      }
      originalLines.push(line)
      modifiedLines.push(line)
      hasHunk = true
      continue
    }

    if (!hasHunk || line === '' || line.startsWith('\\ No newline')) {
      continue
    }

    const marker = line[0]
    const value = line.slice(1)

    if (marker === ' ') {
      originalLines.push(value)
      modifiedLines.push(value)
      hasBodyLine = true
      continue
    }

    if (marker === '-') {
      originalLines.push(value)
      hasBodyLine = true
      continue
    }

    if (marker === '+') {
      modifiedLines.push(value)
      hasBodyLine = true
    }
  }

  if (!hasHunk || !hasBodyLine) {
    return undefined
  }

  return {
    original: originalLines.join('\n'),
    modified: modifiedLines.join('\n')
  }
}
