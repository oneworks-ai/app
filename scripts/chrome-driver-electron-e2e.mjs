#!/usr/bin/env node
/* eslint-disable max-lines -- Electron runtime evidence keeps CDP setup and screenshot assertions together. */
import { Buffer } from 'node:buffer'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'

const port = Number(process.env.ONEWORKS_ELECTRON_CDP_PORT)
const output = resolve(process.env.CHROME_DRIVER_ELECTRON_OUTPUT ?? '.logs/chrome-driver-electron.png')
const keepRoute = process.env.CHROME_DRIVER_ELECTRON_KEEP_ROUTE === '1'
const inspectOnly = process.env.CHROME_DRIVER_ELECTRON_INSPECT_ONLY === '1'
const triggerMissingPermission = process.env.CHROME_DRIVER_ELECTRON_TRIGGER_MISSING_PERMISSION === '1'
const webClientUrl = process.env.ONEWORKS_ELECTRON_WEB_CLIENT_URL
const webWorkspaceId = process.env.ONEWORKS_ELECTRON_WEB_WORKSPACE_ID
const webServerBaseUrl = process.env.ONEWORKS_ELECTRON_WEB_SERVER_BASE_URL
const webManagerUrl = process.env.ONEWORKS_ELECTRON_WEB_MANAGER_URL

if (!Number.isInteger(port) || port <= 0) throw new Error('ONEWORKS_ELECTRON_CDP_PORT is required.')

const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json())
const target = targets.find(candidate => candidate.type === 'page' && candidate.url.includes('/ui/'))
if (target == null) throw new Error('The packaged oneWorks Electron page target was not found.')

const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolveOpen, rejectOpen) => {
  socket.addEventListener('open', resolveOpen, { once: true })
  socket.addEventListener('error', rejectOpen, { once: true })
})

let nextId = 1
const pending = new Map()
socket.addEventListener('message', event => {
  const message = JSON.parse(String(event.data))
  const request = pending.get(message.id)
  if (request == null) return
  pending.delete(message.id)
  message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result)
})

const call = (method, params = {}) =>
  new Promise((resolveCall, rejectCall) => {
    const id = nextId++
    const timeout = setTimeout(() => {
      pending.delete(id)
      rejectCall(new Error(`Electron CDP call timed out: ${method}`))
    }, 20_000)
    pending.set(id, {
      reject: error => {
        clearTimeout(timeout)
        rejectCall(error)
      },
      resolve: value => {
        clearTimeout(timeout)
        resolveCall(value)
      }
    })
    socket.send(JSON.stringify({ id, method, params }))
  })

const evaluate = async expression => {
  const response = await call('Runtime.evaluate', { awaitPromise: true, expression, returnByValue: true })
  if (response.exceptionDetails != null) {
    throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text)
  }
  return response.result.value
}

await call('Runtime.enable')
await call('Page.enable')
if (webClientUrl && webWorkspaceId && webServerBaseUrl && webManagerUrl) {
  await call('Page.navigate', { url: new URL('/ui/launcher', webClientUrl).href })
  const launcherDeadline = Date.now() + 30_000
  while (Date.now() < launcherDeadline) {
    if (await evaluate('Boolean(document.querySelector(\'input[placeholder*="搜索项目"]\'))')) break
    await new Promise(resolveWait => setTimeout(resolveWait, 200))
  }
  const connection = {
    serverBaseUrl: webServerBaseUrl,
    workspaceFolder: process.cwd(),
    workspaceId: webWorkspaceId,
    managerServerBaseUrl: webManagerUrl,
    transport: 'local',
    updatedAt: new Date().toISOString()
  }
  await evaluate(
    `localStorage.setItem('oneworks_workspace_connections', ${
      JSON.stringify(JSON.stringify({ [webWorkspaceId]: connection }))
    })`
  )
  await call('Page.navigate', {
    url: new URL(`/ui/w/${webWorkspaceId}/config/plugin%3Achrome%3Aexternal-browser`, webClientUrl).href
  })
}
const baseUrl = new URL('/ui/', target.url).href
if (!webClientUrl && !keepRoute && target.url !== baseUrl) await call('Page.navigate', { url: baseUrl })
const readyDeadline = Date.now() + 30_000
if (!webClientUrl && !keepRoute) {
  while (Date.now() < readyDeadline) {
    const ready = await evaluate(
      "document.body?.innerText?.includes('欢迎回来') || document.body?.innerText?.includes('Welcome back')"
    )
    if (ready) break
    await new Promise(resolveWait => setTimeout(resolveWait, 200))
  }
}
const runtime = await evaluate('globalThis.__ONEWORKS_PROJECT_RUNTIME_ENV__')
if (inspectOnly) {
  const inspection = await evaluate(`({
    href: location.href,
    text: document.body?.innerText?.slice(0, 2000),
    runtime: globalThis.__ONEWORKS_PROJECT_RUNTIME_ENV__,
    storage: Object.fromEntries(Object.entries(localStorage))
  })`)
  socket.close()
  process.stdout.write(`${JSON.stringify(inspection)}\n`)
  process.exit(0)
}
const workspaceId = runtime?.__ONEWORKS_PROJECT_WORKSPACE_ID__
const url = new URL(
  typeof workspaceId === 'string' && workspaceId
    ? `/ui/w/${workspaceId}/config/plugin%3Achrome%3Aexternal-browser`
    : '/ui/config/plugin%3Achrome%3Aexternal-browser',
  baseUrl
).href
if (!webClientUrl && !keepRoute) {
  await evaluate(
    `history.pushState({}, '', ${JSON.stringify(url)}); globalThis.dispatchEvent(new PopStateEvent('popstate')); true`
  )
}
const deadline = Date.now() + 30_000
let state
while (Date.now() < deadline) {
  state = await evaluate(`({
    href: location.href,
    text: document.body?.innerText ?? '',
    pluginHosts: [...document.querySelectorAll('[data-plugin-scope]')].map(item => ({ scope: item.getAttribute('data-plugin-scope'), view: item.getAttribute('data-plugin-view') })),
    resources: performance.getEntriesByType('resource').map(item => item.name).filter(name => name.includes('plugin')).slice(-30),
    html: document.querySelector('main')?.innerHTML?.slice(0, 3000)
  })`)
  if (state.text.includes('External Browser') || state.text.includes('外部浏览器')) break
  await new Promise(resolveWait => setTimeout(resolveWait, 200))
}
if (!state?.text.includes('External Browser') && !state?.text.includes('外部浏览器')) {
  throw new Error(
    `External Browser UI did not load in packaged Electron: runtime=${JSON.stringify(runtime)}; state=${
      JSON.stringify(state)
    }`
  )
}
const visibleDeadline = Date.now() + 30_000
while (Date.now() < visibleDeadline) {
  const visible = await evaluate(
    `Boolean(document.querySelector('.chrome-driver')) && !document.body.innerText.includes('正在把项目上下文铺好') && !document.body.innerText.includes('项目正在就位')`
  )
  if (visible) break
  await new Promise(resolveWait => setTimeout(resolveWait, 200))
}
state = await evaluate(`({
  href: location.href,
  text: document.body?.innerText ?? '',
  pluginHosts: [...document.querySelectorAll('[data-plugin-scope]')].map(item => ({ scope: item.getAttribute('data-plugin-scope'), view: item.getAttribute('data-plugin-view') }))
})`)
if (triggerMissingPermission) {
  await evaluate(
    `(()=>{const button=[...document.querySelectorAll('button')].find(item=>item.textContent?.includes('Discover frames')||item.textContent?.includes('发现 Frame'));if(!button)throw new Error('Discover frames button missing');button.click();return true})()`
  )
  const failureDeadline = Date.now() + 15_000
  while (Date.now() < failureDeadline) {
    const visible = await evaluate(
      `Boolean(document.querySelector('[role="alert"]')) && (document.body.innerText.includes('已授权，重试') || document.body.innerText.includes('I granted it'))`
    )
    if (visible) break
    await new Promise(resolveWait => setTimeout(resolveWait, 100))
  }
  await evaluate(
    `(()=>{const summary=[...document.querySelectorAll('[role="alert"] summary')].find(item=>item.textContent?.includes('技术详情')||item.textContent?.includes('Technical detail'));summary?.click();return true})()`
  )
  state = await evaluate(
    `({ href: location.href, text: document.body?.innerText ?? '', pluginHosts: [...document.querySelectorAll('[data-plugin-scope]')].map(item => ({ scope: item.getAttribute('data-plugin-scope'), view: item.getAttribute('data-plugin-view') })) })`
  )
  if (!state.text.includes('已授权，重试') && !state.text.includes('I granted it')) {
    throw new Error(`The recoverable missing-permission state was not visible: ${JSON.stringify(state)}`)
  }
} else if (!state.text.includes('Disconnected') && !state.text.includes('未连接')) {
  throw new Error(
    `The recoverable disconnected state was not visible in packaged Electron: runtime=${
      JSON.stringify(runtime)
    }; state=${JSON.stringify(state)}`
  )
}

const screenshot = await call('Page.captureScreenshot', { format: 'png', fromSurface: true })
await mkdir(dirname(output), { recursive: true })
await writeFile(output, Buffer.from(screenshot.data, 'base64'), { mode: 0o600 })
await chmod(output, 0o600)
socket.close()

process.stdout.write(`${
  JSON.stringify({
    electron_url: state.href,
    output,
    plugin_hosts: state.pluginHosts,
    state: triggerMissingPermission ? 'missing-permission-recoverable' : 'disconnected-recoverable'
  })
}\n`)
