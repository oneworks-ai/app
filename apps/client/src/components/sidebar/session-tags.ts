const hiddenSidebarTagPrefixes = ['oneworks:plugin:']

export const isHiddenSidebarSessionTag = (tag: string) => {
  const normalized = tag.trim()
  return hiddenSidebarTagPrefixes.some(prefix => normalized.startsWith(prefix))
}

export const getVisibleSidebarSessionTags = (tags: string[] = []) => (
  tags
    .map(tag => tag.trim())
    .filter(tag => tag !== '' && !isHiddenSidebarSessionTag(tag))
)
