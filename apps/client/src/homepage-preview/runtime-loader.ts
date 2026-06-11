type HomepagePreviewRuntime = typeof import('./mock-runtime')

let runtime: HomepagePreviewRuntime | undefined
let runtimePromise: Promise<HomepagePreviewRuntime> | undefined

export const isHomepagePreviewBundleEnabled = () => __ONEWORKS_PROJECT_HOMEPAGE_PREVIEW__

const loadHomepagePreviewRuntime = async () => {
  if (!__ONEWORKS_PROJECT_HOMEPAGE_PREVIEW__) {
    return undefined
  }

  runtimePromise ??= import('./mock-runtime').then((mod) => {
    runtime = mod
    return mod
  })
  return runtimePromise
}

export const installHomepagePreviewRuntimeIfEnabled = async () => {
  const mod = await loadHomepagePreviewRuntime()
  mod?.installHomepagePreviewRuntime()
}

export const handleHomepagePreviewFetchIfEnabled = async (url: string, init?: RequestInit) => {
  const mod = runtime ?? await loadHomepagePreviewRuntime()
  return mod?.handleHomepagePreviewFetch(url, init)
}

export const createHomepagePreviewSocketIfEnabled = (url: string) => {
  return runtime?.createHomepagePreviewSocket(url)
}
