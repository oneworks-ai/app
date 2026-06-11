import { useMemo } from 'react'

import { getShortcutDisplayTokens } from './shortcut-utils.js'

export function ShortcutDisplay({
  className,
  isMac,
  shortcut
}: {
  className?: string
  isMac: boolean
  shortcut?: string
}) {
  const tokens = useMemo(() => getShortcutDisplayTokens(shortcut, isMac), [isMac, shortcut])

  if (tokens.length === 0) {
    return null
  }

  return (
    <span className={['shortcut-display', className].filter(Boolean).join(' ')}>
      {tokens.map(token => (
        <span
          key={`${token.value}-${token.compact ? 'compact' : 'full'}`}
          className={[
            'shortcut-display__token',
            token.compact ? 'shortcut-display__token--compact' : ''
          ].filter(Boolean).join(' ')}
        >
          {token.value}
        </span>
      ))}
    </span>
  )
}
