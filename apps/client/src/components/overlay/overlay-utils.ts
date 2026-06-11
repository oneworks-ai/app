export const mergeClassNames = (...classNames: Array<false | null | string | undefined>) =>
  classNames.filter(Boolean).join(' ') || undefined
