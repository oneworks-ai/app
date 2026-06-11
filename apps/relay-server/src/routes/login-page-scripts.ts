export const iconLoaderScript = () => `
(() => {
  const loader = window.OneWorksIconLoader
  if (!loader || typeof loader.mountOneWorksIconLoader !== 'function') return
  const background = document.querySelector('[data-relay-login-background-loader]')
  if (background && background.dataset.mounted !== 'true') {
    background.dataset.mounted = 'true'
    try {
      loader.mountOneWorksIconLoader(background, {
        appearance: 'dark',
        background: 'textured',
        canvasClassName: 'relay-login__backdrop-canvas',
        className: 'relay-login__backdrop-loader',
        fullscreen: true,
        mode: 'dark',
        motion: true,
        random: false,
        seed: 'relay-login-background',
        shadow: false,
        theme: 'metal'
      })
      background.classList.add('is-loader-ready')
    } catch {
      background.dataset.loaderFailed = 'true'
    }
  }
})()`
