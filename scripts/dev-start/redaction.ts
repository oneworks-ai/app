const sensitiveKey = String
  .raw`(?:[\w-]*(?:account|cookie|credential|password|secret|token)[\w-]*|api[\w-]?key|connection[\w-]?string|database[\w-]?url|db[\w-]?url)`

export const redactDevServiceText = (text: string) =>
  text
    .replace(/(\b[a-z][\w+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/giu, '$1[REDACTED]@')
    .replace(/(authorization\s*[=:]\s*)(?:bearer\s+)?[^\s,;&]+/giu, '$1[REDACTED]')
    .replace(
      new RegExp(`(["']?${sensitiveKey}["']?\\s*[=:]\\s*)(["']).*?\\2`, 'giu'),
      '$1$2[REDACTED]$2'
    )
    .replace(
      new RegExp(`(["']?${sensitiveKey}["']?\\s*[=:]\\s*)[^"',\\s};&]+`, 'giu'),
      '$1[REDACTED]'
    )
    .replace(/(bearer\s+)[\w.~+/-]+=*/giu, '$1[REDACTED]')
