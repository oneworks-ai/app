const titleInput = document.querySelector('#task-title')
const confirmInput = document.querySelector('#task-confirm')
const priorityInput = document.querySelector('#task-priority')
const createButton = document.querySelector('#create-task')
const resetButton = document.querySelector('#reset-lab')
const status = document.querySelector('#task-status')
const themeIndicator = document.querySelector('#theme-indicator')
const instanceIndicator = document.querySelector('#instance-indicator')
const favicon = document.querySelector('#lab-favicon')
const items = Array.from(document.querySelectorAll('.lab-item'))
const filterButtons = Array.from(document.querySelectorAll('[data-filter]'))

const resolvedTheme = () =>
  document.documentElement.dataset.oneWorksTheme ||
  (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')

const refreshThemeIndicator = () => {
  themeIndicator.textContent = `Theme: ${resolvedTheme()}`
}

const instanceName = new URLSearchParams(window.location.search).get('instance')?.trim() || 'default'
const useDynamicFavicon = new URLSearchParams(window.location.search).get('dynamic_favicon') === '1'
instanceIndicator.textContent = `Instance: ${instanceName}`

const refreshCreateButton = () => {
  createButton.disabled = titleInput.value.trim() === '' || !confirmInput.checked
}

const resetLab = () => {
  titleInput.value = ''
  confirmInput.checked = false
  priorityInput.value = 'normal'
  status.className = 'lab-status'
  status.innerHTML = '<strong>Waiting for input</strong><span>Complete the form to enable submission.</span>'
  filterButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.filter === 'all')))
  items.forEach(item => {
    item.hidden = false
  })
  refreshCreateButton()
  window.scrollTo({ top: 0, behavior: 'instant' })
}

titleInput.addEventListener('input', () => {
  refreshCreateButton()
  if (useDynamicFavicon) favicon.href = `./favicon-metal-dark.svg?title=${encodeURIComponent(titleInput.value)}`
})
confirmInput.addEventListener('change', refreshCreateButton)

createButton.addEventListener('click', () => {
  createButton.disabled = true
  status.className = 'lab-status'
  status.innerHTML = '<strong>Processing…</strong><span>The lab is simulating an asynchronous update.</span>'
  window.setTimeout(() => {
    const title = titleInput.value.trim()
    status.className = 'lab-status is-success'
    status.innerHTML =
      `<strong>Task created successfully</strong><span>${title} · Priority: ${priorityInput.value}</span>`
    refreshCreateButton()
  }, 650)
})

resetButton.addEventListener('click', resetLab)

filterButtons.forEach(button => {
  button.addEventListener('click', () => {
    const filter = button.dataset.filter
    filterButtons.forEach(candidate => candidate.setAttribute('aria-pressed', String(candidate === button)))
    items.forEach(item => {
      item.hidden = filter !== 'all' && item.dataset.state !== filter
    })
  })
})

new MutationObserver(refreshThemeIndicator).observe(document.documentElement, {
  attributeFilter: ['data-one-works-theme'],
  attributes: true
})
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', refreshThemeIndicator)

refreshThemeIndicator()
resetLab()
