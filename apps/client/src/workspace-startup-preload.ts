let workspaceSurfacePreload: Promise<void> | undefined

export const preloadWorkspaceSurface = () => {
  workspaceSurfacePreload ??= Promise.all([
    import('#~/WorkspaceApp'),
    import('#~/AuthenticatedApp'),
    import('#~/routes/ChatRoute')
  ]).then(() => undefined)
  return workspaceSurfacePreload
}
