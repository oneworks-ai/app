export const shouldShowLauncherCommandSection = (
  sectionId: string,
  normalizedQuery: string
) => {
  if (normalizedQuery === '') {
    return sectionId !== 'builtin'
  }

  return sectionId !== 'recent-selections'
}
