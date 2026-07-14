#!/usr/bin/env node
/* eslint-disable max-lines -- Real extension E2E keeps lifecycle and evidence capture in one outer harness. */
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, chmod, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'

const workspaceFolder = resolve(process.cwd())
const require = createRequire(import.meta.url)
const { createOneWorksCursorSvg } = require(join(workspaceFolder, 'packages/cursor/index.cjs'))
const managerUrl = process.env.ONEWORKS_MANAGER_URL ?? 'http://127.0.0.1:8798'
const clientUrl = process.env.ONEWORKS_CLIENT_URL ?? 'http://127.0.0.1:5207'
const chromeExecutable = process.env.CHROME_E2E_EXECUTABLE ??
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
const outputRoot = resolve(
  process.env.CHROME_DRIVER_E2E_OUTPUT ?? join(tmpdir(), `oneworks-chrome-driver-e2e-${Date.now()}`)
)
const profileDir = join(outputRoot, 'profile')
const extensionDir = join(outputRoot, 'extension')
const evidencePath = join(outputRoot, 'evidence.json')
const storeAssetsOutput = process.env.CHROME_DRIVER_E2E_STORE_ASSETS == null
  ? undefined
  : resolve(process.env.CHROME_DRIVER_E2E_STORE_ASSETS)
const sourceExtension = join(workspaceFolder, 'packages/plugins/chrome-driver/extension')
const demoMode = process.env.CHROME_DRIVER_E2E_DEMO === '1'
const demoControlPath = process.env.CHROME_DRIVER_E2E_DEMO_CONTROL
const demoStartPath = process.env.CHROME_DRIVER_E2E_DEMO_START
const demoRunCompletePath = process.env.CHROME_DRIVER_E2E_DEMO_RUN_COMPLETE
const demoDonePath = process.env.CHROME_DRIVER_E2E_DEMO_DONE
const baseHoldReadyPath = process.env.CHROME_DRIVER_E2E_BASE_HOLD_READY
const baseHoldDonePath = process.env.CHROME_DRIVER_E2E_BASE_HOLD_DONE
const headless = process.env.CHROME_DRIVER_E2E_HEADLESS === '1'
const evidence = { started_at: new Date().toISOString(), output_root: outputRoot, checks: [] }
let chromeProcess
let fixtureServer

const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms))
const demoPause = (ms = 1_200) => demoMode ? sleep(ms) : Promise.resolve()
const check = (name, details = {}) => evidence.checks.push({ at: new Date().toISOString(), name, ok: true, ...details })
const fail = (name, details = {}) => evidence.checks.push({ at: new Date().toISOString(), name, ok: false, ...details })

async function waitFor(task, message, timeoutMs = 30_000, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const result = await task()
      if (result) return result
    } catch (error) {
      lastError = error
    }
    await sleep(intervalMs)
  }
  throw new Error(`${message}${lastError == null ? '' : `: ${lastError.message}`}`)
}

async function materialize(flavor) {
  await rm(extensionDir, { recursive: true, force: true })
  await mkdir(extensionDir, { recursive: true })
  for (
    const entry of [
      'background.js',
      'content-script.js',
      'cursor-runtime.js',
      'default-tab-favicon.svg',
      'icons',
      'operations',
      'popup.css',
      'popup.html',
      'popup.js'
    ]
  ) {
    await cp(join(sourceExtension, entry), join(extensionDir, entry), { recursive: true })
  }
  await cp(
    join(sourceExtension, flavor === 'e2e' ? 'manifest.e2e.json' : 'manifest.json'),
    join(extensionDir, 'manifest.json')
  )
  await writeFile(join(extensionDir, 'agent-cursor.svg'), createOneWorksCursorSvg({ color: '#625BF6', size: 64 }))
}

async function startFixture() {
  fixtureServer = createServer((request, response) => {
    if (request.url === '/favicon-old.svg' || request.url === '/favicon-latest.svg') {
      const latest = request.url === '/favicon-latest.svg'
      response.setHeader('content-type', 'image/svg+xml')
      response.end(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="${
          latest ? '#0f9f78' : '#7c6cf2'
        }"/><path d="M9 16h14M16 9v14" stroke="white" stroke-width="3" stroke-linecap="round"/></svg>`
      )
      return
    }
    response.setHeader('content-type', 'text/html; charset=utf-8')
    if (request.url === '/frame') {
      response.end(
        '<!doctype html><title>Frame Evidence</title><button id="frame-button">Frame action</button><p id="frame-result">idle</p><script>document.querySelector("#frame-button").onclick=()=>document.querySelector("#frame-result").textContent="frame-clicked"</script>'
      )
      return
    }
    if (request.url === '/frame-host') {
      const port = fixtureServer.address().port
      response.end(
        `<!doctype html><title>Frame Host</title><h1>Frame host</h1><iframe title="Cross origin evidence" src="http://localhost:${port}/frame"></iframe>`
      )
      return
    }
    if (request.url === '/page-a') {
      response.setHeader('set-cookie', 'oneworks_e2e_cookie=cookie-secret; Path=/; SameSite=Lax')
    }
    response.end(
      '<!doctype html><title>Semantic Evidence</title><link id="site-favicon" rel="icon" href="/favicon-old.svg"><style>body{min-height:1900px}#scroll-evidence{margin-top:1200px}</style><h1>Semantic page</h1><label>Evidence input <input aria-label="Evidence input"></label><label>Evidence password <input type="password" aria-label="Evidence password" value="page-secret"></label><button id="action">Run action</button><p id="result">idle</p><p id="scroll-evidence">Scroll evidence reached</p><script>localStorage.setItem("oneworks_e2e_token","storage-secret");document.querySelector("#action").onclick=()=>document.querySelector("#result").textContent="clicked"</script>'
    )
  })
  await new Promise(resolveStart => fixtureServer.listen(0, '127.0.0.1', resolveStart))
  return fixtureServer.address().port
}

async function readCredentials() {
  const key = createHash('sha256').update(workspaceFolder).digest('hex').slice(0, 24)
  const path = join(tmpdir(), 'oneworks-chrome-control', `${key}.protocol-1.json`)
  return waitFor(async () => JSON.parse(await readFile(path, 'utf8')), 'Chrome bridge credentials were not created')
}

async function openWorkspace() {
  const response = await fetch(new URL('/api/launcher/workspaces/open', managerUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-oneworks-client-origin': clientUrl },
    body: JSON.stringify({ workspaceFolder })
  })
  const body = await response.json()
  if (!response.ok || body.success !== true) throw new Error(`Failed to open workspace: ${JSON.stringify(body)}`)
  return body.data
}

async function launchChrome(initialUrl) {
  await rm(join(profileDir, 'DevToolsActivePort'), { force: true })
  chromeProcess = spawn(chromeExecutable, [
    `--user-data-dir=${profileDir}`,
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    `--disable-extensions-except=${extensionDir}`,
    `--load-extension=${extensionDir}`,
    ...(headless ? ['--headless=new', '--hide-scrollbars'] : []),
    '--window-size=1280,900',
    '--window-position=40,40',
    initialUrl
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = ''
  chromeProcess.stderr.on('data', chunk => {
    stderr += chunk.toString()
  })
  const activePort = await waitFor(
    async () => {
      const [port, browserId] = (await readFile(join(profileDir, 'DevToolsActivePort'), 'utf8')).trim().split('\n')
      return port ? { browserId, port: Number(port) } : undefined
    },
    'Chrome did not expose its DevTools port',
    20_000
  )
  chromeProcess.once('exit', code => {
    if (code && code !== 0) fail('chrome-exit', { code, stderr: stderr.slice(-2000) })
  })
  return activePort
}

async function stopChrome() {
  if (chromeProcess == null) return
  const processToStop = chromeProcess
  if (processToStop.exitCode == null) {
    processToStop.kill('SIGTERM')
    await Promise.race([
      new Promise(resolveExit => processToStop.once('exit', resolveExit)),
      sleep(4000).then(() => processToStop.kill('SIGKILL'))
    ])
  }
  await waitFor(
    () =>
      new Promise(resolveCheck => {
        const check = spawn('pgrep', ['-f', `--user-data-dir=${profileDir}`], { stdio: 'ignore' })
        check.once('error', () => resolveCheck(true))
        check.once('exit', code => resolveCheck(code !== 0))
      }),
    'Chrome profile processes did not stop cleanly',
    10_000,
    100
  )
  chromeProcess = undefined
}

class Cdp {
  constructor(url) {
    this.url = url
    this.nextId = 1
    this.pending = new Map()
    this.events = []
  }
  async connect() {
    this.socket = new WebSocket(this.url)
    this.socket.onmessage = event => {
      const message = JSON.parse(String(event.data))
      const pending = this.pending.get(message.id)
      if (pending == null) {
        this.events.push(message)
        if (this.events.length > 500) this.events.shift()
        return
      }
      this.pending.delete(message.id)
      message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result)
    }
    await new Promise((resolveOpen, rejectOpen) => {
      this.socket.onopen = resolveOpen
      this.socket.onerror = rejectOpen
    })
  }
  call(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolveCall, rejectCall) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        rejectCall(new Error(`CDP call timed out: ${method}`))
      }, 15_000)
      this.pending.set(id, {
        reject: error => {
          clearTimeout(timeout)
          rejectCall(error)
        },
        resolve: value => {
          clearTimeout(timeout)
          resolveCall(value)
        }
      })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }
  close() {
    this.socket?.close()
    for (const pending of this.pending.values()) pending.reject(new Error('CDP connection closed.'))
    this.pending.clear()
  }
}

async function pageCdp(port, urlPart) {
  const target = await waitFor(async () => {
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json())
    return targets.find(candidate => candidate.type === 'page' && candidate.url.includes(urlPart))
  }, `Chrome page target was not found: ${urlPart}`)
  const cdp = new Cdp(target.webSocketDebuggerUrl)
  cdp.target = target
  await cdp.connect()
  await cdp.call('Runtime.enable')
  await cdp.call('Page.enable')
  await cdp.call('Network.enable')
  return cdp
}

async function evaluate(cdp, expression) {
  const result = await cdp.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  }
  return result.result.value
}

async function captureStoreAsset(cdp, fileName, position = 'top') {
  if (storeAssetsOutput == null) return
  await mkdir(storeAssetsOutput, { recursive: true })
  await cdp.call('Emulation.setDeviceMetricsOverride', {
    deviceScaleFactor: 1,
    height: 800,
    mobile: false,
    width: 1280
  })
  await evaluate(
    cdp,
    `(()=>{const candidates=[document.scrollingElement,...document.querySelectorAll('*')].filter(item=>item&&item.scrollHeight>item.clientHeight+80);const target=candidates.sort((left,right)=>(right.scrollHeight-right.clientHeight)-(left.scrollHeight-left.clientHeight))[0];if(target)target.scrollTop=${
      position === 'bottom' ? 'target.scrollHeight' : '0'
    };return true})()`
  )
  await sleep(200)
  const screenshot = await cdp.call('Page.captureScreenshot', {
    captureBeyondViewport: false,
    format: 'png',
    fromSurface: true
  })
  await writeFile(join(storeAssetsOutput, fileName), Buffer.from(screenshot.data, 'base64'))
}

async function bridgeRequest(credentials, path, body, allowError = false) {
  const response = await fetch(new URL(path, credentials.baseUrl), {
    method: path === '/v1/status' ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${credentials.controlToken}`, 'content-type': 'application/json' },
    ...(path === '/v1/status' ? {} : { body: JSON.stringify(body ?? {}) })
  })
  const payload = await response.json()
  if (!allowError && (!response.ok || payload.ok !== true)) {
    throw Object.assign(new Error(payload.error?.message ?? `Bridge HTTP ${response.status}`), payload.error)
  }
  return { payload, status: response.status }
}

const control = async (credentials, op, args, riskTier, targetKey, allowError = false) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const result = await bridgeRequest(credentials, '/v1/control', {
        op,
        args,
        risk_tier: riskTier,
        target_key: targetKey
      }, allowError)
      if (result.payload.error?.code !== 'DISCONNECTED') return result
    } catch (error) {
      if (error.code !== 'DISCONNECTED') throw error
    }
    await sleep(100)
  }
  throw new Error(`Chrome connection did not stabilize for ${op}.`)
}
async function pairFromUi(cdp, credentials, previousConnectionId) {
  await waitFor(
    () =>
      evaluate(
        cdp,
        `Boolean(document.querySelector('.chrome-driver'))&&(document.body?.innerText?.includes('External Browser')||document.body?.innerText?.includes('外部浏览器'))`
      ),
    'External Browser plugin did not appear',
    20_000
  ).catch(async error => {
    const state = await evaluate(
      cdp,
      `(async()=>{const runtime=globalThis.__ONEWORKS_PROJECT_RUNTIME_ENV__;const pluginUrl=runtime?.__ONEWORKS_PROJECT_SERVER_BASE_URL__+'/api/plugins';return {url:location.href,title:document.title,text:document.body?.innerText?.slice(0,1600),runtime,stored:localStorage.getItem('oneworks_workspace_connections'),probes:await Promise.allSettled(['http://127.0.0.1:8798/api/launcher/workspaces/w_uADyttsTcEBCwOfkiKye1n/connection',pluginUrl].map(async url=>{try{const response=await fetch(url,{credentials:'include',headers:{'X-OneWorks-Client-Origin':location.origin}});return {url,status:response.status,text:(await response.text()).slice(0,160)}}catch(fetchError){return {url,error:String(fetchError),cause:String(fetchError?.cause)}}})),pluginHosts:[...document.querySelectorAll('[data-plugin-scope]')].map(item=>({scope:item.getAttribute('data-plugin-scope'),view:item.getAttribute('data-plugin-view')})),resources:performance.getEntriesByType('resource').map(item=>item.name).slice(-40)}})()`
    )
    state.networkFailures = cdp.events.filter(event => event.method === 'Network.loadingFailed').slice(-20).map(event =>
      event.params
    )
    state.console = cdp.events.filter(event =>
      event.method === 'Runtime.consoleAPICalled' || event.method === 'Runtime.exceptionThrown'
    ).slice(-30).map(event => event.params)
    throw new Error(`${error.message}; plugin state=${JSON.stringify(state)}`)
  })
  await evaluate(
    cdp,
    `globalThis.__oneWorksPairingMessages=[];globalThis.addEventListener('message',event=>{if(String(event.data?.type??'').includes('CHROME'))globalThis.__oneWorksPairingMessages.push(event.data)})`
  )
  await evaluate(
    cdp,
    `(()=>{const button=[...document.querySelectorAll('button')].find(item=>item.textContent?.includes('Connect browser')||item.textContent?.includes('连接浏览器'));if(!button)throw new Error('connect button missing');button.click();return true})()`
  )
  return waitFor(
    async () => {
      const pairingSucceeded = await evaluate(
        cdp,
        `globalThis.__oneWorksPairingMessages.some(message=>message.type==='ONEWORKS_CHROME_PAIRING_RESULT'&&message.ok===true)`
      )
      if (pairingSucceeded) Object.assign(credentials, await readCredentials())
      const status = (await bridgeRequest(credentials, '/v1/status')).payload.result
      if (
        !status.connected ||
        (previousConnectionId != null && status.connection.connection_id === previousConnectionId && !pairingSucceeded)
      ) return undefined
      await sleep(800)
      const stable = (await bridgeRequest(credentials, '/v1/status')).payload.result
      return stable.connected && stable.connection.connection_id === status.connection.connection_id
        ? stable
        : undefined
    },
    'Extension did not pair with OneWorks',
    20_000
  ).catch(async error => {
    const messages = await evaluate(cdp, `globalThis.__oneWorksPairingMessages`)
    throw new Error(`${error.message}; messages=${JSON.stringify(messages)}`)
  })
}

async function enterWorkspaceThroughLauncher(cdp, workspace, routeUrl) {
  await waitFor(
    () => evaluate(cdp, `Boolean(document.querySelector('input[placeholder*="搜索项目"]'))`),
    'Launcher search did not appear',
    20_000
  ).catch(async error => {
    const state = await evaluate(
      cdp,
      `({url:location.href,title:document.title,text:document.body?.innerText?.slice(0,1200),html:document.body?.innerHTML?.slice(0,500)})`
    )
    throw new Error(`${error.message}; launcher state=${JSON.stringify(state)}`)
  })
  const connection = {
    serverBaseUrl: workspace.serverBaseUrl,
    workspaceFolder: workspace.workspaceFolder,
    workspaceId: workspace.workspaceId,
    managerServerBaseUrl: managerUrl,
    transport: 'local',
    updatedAt: new Date().toISOString()
  }
  await evaluate(
    cdp,
    `localStorage.setItem('oneworks_workspace_connections',${
      JSON.stringify(JSON.stringify({ [workspace.workspaceId]: connection }))
    })`
  )
  await cdp.call('Page.navigate', { url: routeUrl })
}

async function approveFromUi(cdp, confirmationId, operation) {
  await waitFor(
    () =>
      evaluate(
        cdp,
        `document.body?.innerText?.includes(${
          JSON.stringify(operation)
        })&&[...document.querySelectorAll('button')].some(item=>{const label=item.textContent?.replace(/\\s/gu,'');return label?.includes('Approve')||label?.includes('批准')})`
      ),
    `Confirmation did not render: ${confirmationId}`,
    15_000
  ).catch(async error => {
    const [page, credentials] = await Promise.all([
      evaluate(
        cdp,
        `({url:location.href,text:document.body?.innerText?.slice(-2500),pluginHosts:[...document.querySelectorAll('[data-plugin-scope]')].map(item=>({scope:item.getAttribute('data-plugin-scope'),view:item.getAttribute('data-plugin-view')}))})`
      ),
      readCredentials()
    ])
    const status = (await bridgeRequest(credentials, '/v1/status')).payload.result
    throw new Error(
      `${error.message}; page=${JSON.stringify(page)}; pending=${JSON.stringify(status.pending_confirmations)}`
    )
  })
  await evaluate(
    cdp,
    `(()=>{const button=[...document.querySelectorAll('button')].find(item=>{const label=item.textContent?.replace(/\\s/gu,'');return label?.includes('Approve')||label?.includes('批准')});if(!button)throw new Error('approve button missing');button.click();return true})()`
  )
}

async function revealConfirmationFromUi(cdp, operation) {
  await waitFor(
    () =>
      evaluate(
        cdp,
        `(()=>{const operation=${
          JSON.stringify(operation)
        };if(!document.body?.innerText?.includes(operation))return false;const button=[...document.querySelectorAll('button')].find(item=>{const label=item.textContent?.replace(/\\s/gu,'');return label?.includes('Approve')||label?.includes('批准')});if(!button)return false;button.scrollIntoView({block:'center'});return true})()`
      ),
    `Confirmation did not become visible: ${operation}`,
    15_000
  )
}

async function setAdvancedAccessFromUi(cdp, labels, enabled) {
  const serializedLabels = JSON.stringify(labels)
  await waitFor(
    () =>
      evaluate(
        cdp,
        `(()=>{const labels=${serializedLabels};const row=[...document.querySelectorAll('.config-view__field-row')].find(item=>labels.some(label=>item.textContent?.includes(label)));const control=row?.querySelector('button[role="switch"]');if(!control||control.disabled)return false;control.scrollIntoView({block:'center'});const checked=control.getAttribute('aria-checked')==='true';if(checked!==${
          JSON.stringify(enabled)
        })control.click();return true})()`
      ),
    `Advanced access switch was not found: ${labels.join(' / ')}`
  )
  await waitFor(
    () =>
      evaluate(
        cdp,
        `(()=>{const labels=${serializedLabels};const row=[...document.querySelectorAll('.config-view__field-row')].find(item=>labels.some(label=>item.textContent?.includes(label)));return row?.querySelector('button[role="switch"]')?.getAttribute('aria-checked')===${
          JSON.stringify(String(enabled))
        }})()`
      ),
    `Advanced access switch did not become ${enabled}: ${labels.join(' / ')}`
  )
}

async function clickDiscoverFrames(cdp) {
  await waitFor(
    () =>
      evaluate(
        cdp,
        `(()=>{const button=[...document.querySelectorAll('button')].find(item=>item.textContent?.includes('Discover frames')||item.textContent?.includes('发现 Frame'));if(!button||button.disabled)return false;button.click();return true})()`
      ),
    'Discover frames button did not become ready'
  )
}

async function confirmedControl(credentials, ui, op, args, targetKey) {
  const gated = await control(credentials, op, args, 4, targetKey, true)
  if (gated.payload.error?.code !== 'CONFIRMATION_REQUIRED') {
    throw new Error(`${op} did not require an exact R4 confirmation: ${JSON.stringify(gated.payload)}`)
  }
  await approveFromUi(ui, gated.payload.error.confirmation_id, op)
  await waitFor(
    async () =>
      (await bridgeRequest(credentials, '/v1/status')).payload.result.pending_confirmations.every(item =>
        item.confirmation_id !== gated.payload.error.confirmation_id
      ),
    `${op} confirmation was not approved`
  )
  return control(credentials, op, args, 4, targetKey)
}

async function runMcpWorkflow(tabId) {
  const child = spawn(
    process.execPath,
    [join(workspaceFolder, 'packages/plugins/chrome-driver/bin/chrome-driver.cjs')],
    {
      cwd: workspaceFolder,
      env: {
        ...process.env,
        __ONEWORKS_PROJECT_SESSION_ID__: 'chrome-driver-real-e2e',
        __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: workspaceFolder
      },
      stdio: ['pipe', 'pipe', 'pipe']
    }
  )
  let stderr = ''
  let stdout = ''
  child.stderr.on('data', chunk => {
    stderr += chunk.toString()
  })
  const response = new Promise((resolveResponse, rejectResponse) => {
    const timeout = setTimeout(
      () => rejectResponse(new Error(`Chrome Driver MCP timed out: ${stderr.slice(-1000)}`)),
      30_000
    )
    child.stdout.on('data', chunk => {
      stdout += chunk.toString()
      for (const line of stdout.split('\n')) {
        if (!line.trim()) continue
        try {
          const message = JSON.parse(line)
          if (message.id !== 'e2e-workflow') continue
          clearTimeout(timeout)
          resolveResponse(message)
          return
        } catch {}
      }
    })
    child.once('exit', code => {
      if (code !== 0) {
        clearTimeout(timeout)
        rejectResponse(new Error(`Chrome Driver MCP exited ${code}: ${stderr.slice(-1000)}`))
      }
    })
  })
  child.stdin.write(`${
    JSON.stringify({
      jsonrpc: '2.0',
      id: 'e2e-workflow',
      method: 'tools/call',
      params: {
        name: 'execute_chrome_workflow',
        arguments: {
          workflow_id: 'real-chrome-e2e',
          tab_id: tabId,
          steps: [
            { node_id: 'snapshot', op: 'snapshot' },
            { node_id: 'continue', op: 'checkpoint', checkpoint: 'continue' },
            { node_id: 'wait', op: 'wait', duration_ms: 20 }
          ]
        }
      }
    })
  }\n`)
  try {
    const message = await response
    if (message.result?.isError || message.result?.structuredContent?.outcome !== 'succeeded') {
      throw new Error(`Chrome Driver MCP workflow failed: ${JSON.stringify(message)}`)
    }
    return message.result.structuredContent
  } finally {
    child.stdin.end()
    child.kill('SIGTERM')
  }
}

async function run() {
  await mkdir(outputRoot, { recursive: true })
  await mkdir(profileDir, { recursive: true })
  const fixturePort = await startFixture()
  const workspace = await openWorkspace()
  const routeUrl = `${clientUrl}/ui/w/${workspace.workspaceId}/config/plugin%3Achrome%3Aexternal-browser`
  const credentials = await readCredentials()

  await materialize('base')
  let chrome = await launchChrome(`${clientUrl}/ui/launcher`)
  let ui = await pageCdp(chrome.port, '/ui/launcher')
  await enterWorkspaceThroughLauncher(ui, workspace, routeUrl)
  const firstConnection = await pairFromUi(ui, credentials)
  check('base-extension-paired', { connection_id: firstConnection.connection.connection_id })
  const missing = await control(
    credentials,
    'tabs.list',
    { action: 'list', url_patterns: ['http://127.0.0.1/*'] },
    1,
    'tabs',
    true
  )
  if (missing.payload.error?.code !== 'MISSING_PERMISSION') {
    throw new Error(`Expected MISSING_PERMISSION, got ${JSON.stringify(missing.payload)}`)
  }
  check('missing-permission-recoverable', { missing_permissions: missing.payload.error.missing_permissions })
  if (baseHoldReadyPath && baseHoldDonePath) {
    await clickDiscoverFrames(ui)
    await waitFor(
      () =>
        evaluate(
          ui,
          `Boolean(document.querySelector('[role="alert"]')) && (document.body.innerText.includes('已授权，重试') || document.body.innerText.includes('I granted it'))`
        ),
      'Missing-permission recovery UI did not render'
    )
    await evaluate(
      ui,
      `(()=>{const summary=[...document.querySelectorAll('[role="alert"] summary')].find(item=>item.textContent?.includes('技术详情')||item.textContent?.includes('Technical detail'));summary?.click();return true})()`
    )
    const screenshotPath = join(outputRoot, 'base-missing-permission.png')
    await ui.call('Page.bringToFront')
    await writeFile(
      baseHoldReadyPath,
      `${
        JSON.stringify({
          at: new Date().toISOString(),
          bridge: await readCredentials(),
          cdp_http_url: `http://127.0.0.1:${chrome.port}`,
          page_url: ui.target.url,
          screenshot: screenshotPath,
          workspace
        })
      }\n`,
      { mode: 0o600 }
    )
    await waitFor(() => access(baseHoldDonePath).then(() => true), 'Base-extension hold was not released', 120_000)
    await access(screenshotPath)
  }
  await ui.call('Page.close').catch(() => undefined)
  ui.close()
  await stopChrome()

  await materialize('e2e')
  chrome = await launchChrome(routeUrl)
  ui = await pageCdp(chrome.port, '/config/plugin%3Achrome%3Aexternal-browser')
  if (demoMode && demoControlPath && demoStartPath) {
    await writeFile(
      demoControlPath,
      `${
        JSON.stringify({
          chrome_pid: chromeProcess.pid,
          cdp_websocket_url: ui.target.webSocketDebuggerUrl,
          output_root: outputRoot
        })
      }\n`,
      { mode: 0o600 }
    )
    await waitFor(() => access(demoStartPath).then(() => true), 'Demo recorder did not send its start signal', 30_000)
    await demoPause(1_500)
  }
  const autoReconnected = await waitFor(
    async () => {
      const status = (await bridgeRequest(credentials, '/v1/status')).payload.result
      return status.connected && status.connection.connection_id !== firstConnection.connection.connection_id
        ? status
        : undefined
    },
    'Extension did not reconnect after permission upgrade',
    20_000
  )
  check('disconnect-reconnect', {
    before: firstConnection.connection.connection_id,
    after: autoReconnected.connection.connection_id
  })
  let reconnected = await pairFromUi(ui, credentials, autoReconnected.connection.connection_id)
  check('explicit-tab-identity-rebound', { tab_id: reconnected.connection.oneworks_tab_id })
  await captureStoreAsset(ui, 'screenshot-connection.png')
  await setAdvancedAccessFromUi(ui, ['Complete cookie values', '完整 Cookie 值'], true)
  await setAdvancedAccessFromUi(ui, ['Sensitive page fields', '页面敏感字段'], true)
  await setAdvancedAccessFromUi(ui, ['Raw CDP and JavaScript', '原始 CDP 与 JavaScript'], true)
  check('advanced-access-switches-user-enabled', { scope: 'browser_session' })
  if (demoMode) {
    await clickDiscoverFrames(ui)
    await waitFor(
      () =>
        evaluate(
          ui,
          `document.body?.innerText?.includes('Top document')||document.body?.innerText?.includes('顶层文档')`
        ),
      'Paired OneWorks frame inventory did not render'
    )
    await demoPause(1_800)
  }
  await demoPause()
  const listed = await control(credentials, 'tabs.list', { action: 'list' }, 1, 'tabs')
  check('permission-recovery', { tab_count: listed.payload.result.result.length })

  const mismatchNonce = 'e2e-version-mismatch-nonce'
  const versionOffer = (await bridgeRequest(credentials, '/v1/pairing-offer', {
    trusted_origin: new URL(clientUrl).origin,
    extension_id: reconnected.connection.extension_id,
    pairing_nonce: mismatchNonce
  })).payload.result
  const mismatchResponse = await fetch(new URL('/v1/extensions/connect', credentials.baseUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: `chrome-extension://${reconnected.connection.extension_id}`
    },
    body: JSON.stringify({
      protocol_version: 99,
      extension_id: reconnected.connection.extension_id,
      trusted_origin: versionOffer.trusted_origin,
      ticket: versionOffer.ticket
    })
  })
  const mismatch = await mismatchResponse.json()
  if (mismatch.error?.code !== 'VERSION_MISMATCH') {
    throw new Error(`Expected VERSION_MISMATCH: ${JSON.stringify(mismatch)}`)
  }
  check('version-mismatch-recoverable', { code: mismatch.error.code })

  const pageA = (await control(
    credentials,
    'tabs.create',
    { action: 'create', url: `http://127.0.0.1:${fixturePort}/page-a`, active: false },
    2,
    'tabs'
  )).payload.result.result
  const frameHost = (await control(
    credentials,
    'tabs.create',
    { action: 'create', url: `http://127.0.0.1:${fixturePort}/frame-host`, active: false },
    2,
    'tabs'
  )).payload.result.result
  const windowCreated = (await control(
    credentials,
    'windows.create',
    { action: 'create', urls: [`http://127.0.0.1:${fixturePort}/page-window`], focused: false },
    2,
    'windows'
  )).payload.result.result
  check('tabs-and-window-created', { tab_ids: [pageA.id, frameHost.id], window_id: windowCreated.id })
  await waitFor(async () => {
    const [left, right] = await Promise.all([
      control(credentials, 'tabs.get', { action: 'get', tab_id: pageA.id }, 1, `tab:${pageA.id}`),
      control(credentials, 'tabs.get', { action: 'get', tab_id: frameHost.id }, 1, `tab:${frameHost.id}`)
    ])
    return left.payload.result.result.status === 'complete' && right.payload.result.result.status === 'complete'
  }, 'Fixture tabs did not finish loading')

  const [snapshotA, frames] = await Promise.all([
    control(
      credentials,
      'page.snapshot',
      { action: 'snapshot', tab_id: pageA.id, frame_id: 0 },
      1,
      `tab:${pageA.id}:frame:0`
    ),
    control(credentials, 'frames.list', { action: 'list', tab_id: frameHost.id }, 1, `tab:${frameHost.id}`)
  ])
  const pageDocumentId = snapshotA.payload.result.result.document_id
  const elements = snapshotA.payload.result.result.elements
  const inputRef = elements.find(item => item.name === 'Evidence input')?.ref
  const buttonRef = elements.find(item => item.role === 'button')?.ref
  const redactedPassword = elements.find(item => item.name === 'Evidence password')
  if (!inputRef || !buttonRef) throw new Error('Semantic refs were not discovered.')
  if (redactedPassword?.value !== '[redacted]') {
    throw new Error(`Normal snapshot exposed or missed the password field: ${JSON.stringify(redactedPassword)}`)
  }
  await control(
    credentials,
    'tabs.update',
    { action: 'update', tab_id: pageA.id, active: true },
    2,
    `tab:${pageA.id}`
  )
  await demoPause(700)
  const controlledPage = await pageCdp(chrome.port, `/page-a`)
  await evaluate(
    controlledPage,
    `setTimeout(()=>{document.querySelector('#site-favicon').href='/favicon-latest.svg'},100);true`
  )
  const typeOperation = control(
    credentials,
    'page.type',
    { action: 'type', tab_id: pageA.id, frame_id: 0, document_id: pageDocumentId, ref: inputRef, text: 'OneWorks' },
    2,
    `tab:${pageA.id}`
  )
  const activeIndicator = await waitFor(
    async () => {
      const indicator = (await evaluate(
        controlledPage,
        `(()=>{const cursor=document.querySelector('#oneworks-external-browser-agent-cursor');const favicon=document.querySelector('#oneworks-external-browser-agent-favicon');const style=cursor&&getComputedStyle(cursor);return {result:cursor&&favicon&&style.opacity!=='0'?{cursor_src:cursor.src,cursor_opacity:style.opacity,cursor_width:style.width,cursor_height:style.height,cursor_session_id:cursor.dataset.oneworksCursorSessionId,favicon_href:favicon.href}:undefined}})()`
      )).result
      if (indicator == null) return undefined
      const tab = (await control(credentials, 'tabs.get', { action: 'get', tab_id: pageA.id }, 1, `tab:${pageA.id}`))
        .payload.result.result
      if (!tab.fav_icon_url?.includes('agent-cursor.svg')) return undefined
      return {
        ...indicator,
        activity_observation: 'dom-and-tabs-api',
        tab_favicon_url: tab.fav_icon_url
      }
    },
    'Standard cursor and Chrome tab favicon activity did not appear',
    5_000,
    25
  )
  await demoPause(700)
  await typeOperation
  const restoredIndicator = await waitFor(
    () =>
      evaluate(
        controlledPage,
        `(()=>{const agent=document.querySelector('#oneworks-external-browser-agent-favicon');const restored=document.querySelector('#oneworks-external-browser-restored-favicon');return !agent&&restored?.href?.includes('/favicon-latest.svg')?{href:restored.href,source:restored.dataset.oneworksRestoredFavicon}:undefined})()`
      ),
    'Tab favicon activity did not restore after the page action',
    5_000,
    25
  )
  const restoredTab = await waitFor(
    async () => {
      const tab = (await control(credentials, 'tabs.get', { action: 'get', tab_id: pageA.id }, 1, `tab:${pageA.id}`))
        .payload.result.result
      return tab.fav_icon_url?.includes('/favicon-latest.svg') ? tab : undefined
    },
    'Chrome tab UI did not adopt the latest dynamic favicon after the page action',
    5_000,
    50
  )
  if (
    !activeIndicator.cursor_src.includes('agent-cursor.svg') ||
    !activeIndicator.favicon_href.includes('agent-cursor.svg') ||
    activeIndicator.cursor_width !== '28px' ||
    activeIndicator.cursor_height !== '28px'
  ) {
    throw new Error(`Page action did not use the shared cursor asset: ${JSON.stringify(activeIndicator)}`)
  }
  const afterTypeCursor = await evaluate(
    controlledPage,
    `(()=>{const cursor=document.querySelector('#oneworks-external-browser-agent-cursor');return cursor&&getComputedStyle(cursor).opacity!=='0'?{session_id:cursor.dataset.oneworksCursorSessionId,transform:getComputedStyle(cursor).transform}:undefined})()`
  )
  if (afterTypeCursor?.session_id !== activeIndicator.cursor_session_id) {
    throw new Error(`Page cursor did not persist after type: ${JSON.stringify(afterTypeCursor)}`)
  }
  check('standard-cursor-and-tab-favicon-activity', {
    cursor_size_px: 28,
    cursor_session_id: activeIndicator.cursor_session_id,
    activity_observation: activeIndicator.activity_observation,
    favicon_restored: restoredIndicator.source,
    favicon_url: restoredTab.fav_icon_url,
    tab_id: pageA.id
  })
  await control(
    credentials,
    'page.click',
    { action: 'click', tab_id: pageA.id, frame_id: 0, document_id: pageDocumentId, ref: buttonRef },
    2,
    `tab:${pageA.id}`
  )
  const afterClickCursor = await evaluate(
    controlledPage,
    `(()=>{const cursor=document.querySelector('#oneworks-external-browser-agent-cursor');return cursor&&getComputedStyle(cursor).opacity!=='0'?{session_id:cursor.dataset.oneworksCursorSessionId,transform:getComputedStyle(cursor).transform}:undefined})()`
  )
  if (afterClickCursor?.session_id !== afterTypeCursor.session_id) {
    throw new Error(
      `Page cursor did not remain in the same session across actions: ${JSON.stringify(afterClickCursor)}`
    )
  }
  await control(
    credentials,
    'page.scroll',
    { action: 'scroll', tab_id: pageA.id, frame_id: 0, document_id: pageDocumentId, x: 0, y: 520 },
    2,
    `tab:${pageA.id}`
  )
  await demoPause(1_500)
  const afterScrollCursor = await evaluate(
    controlledPage,
    `(()=>{const cursor=document.querySelector('#oneworks-external-browser-agent-cursor');const style=cursor&&getComputedStyle(cursor);const rect=cursor?.getBoundingClientRect();return cursor&&style.opacity!=='0'&&rect&&rect.bottom>0&&rect.right>0&&rect.top<innerHeight&&rect.left<innerWidth?{session_id:cursor.dataset.oneworksCursorSessionId,scroll_y:scrollY,bounds:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},position:style.position}:undefined})()`
  )
  if (afterScrollCursor?.session_id !== afterTypeCursor.session_id || afterScrollCursor.scroll_y < 500) {
    throw new Error(`Page cursor or scroll state did not persist: ${JSON.stringify(afterScrollCursor)}`)
  }
  check('semantic-scroll-with-persistent-cursor', {
    cursor_session_id: afterScrollCursor.session_id,
    scroll_y: afterScrollCursor.scroll_y,
    tab_id: pageA.id
  })
  const afterInteraction = await control(
    credentials,
    'page.snapshot',
    { action: 'snapshot', tab_id: pageA.id, frame_id: 0 },
    1,
    `tab:${pageA.id}:frame:0`
  )
  if (
    !afterInteraction.payload.result.result.text.includes('clicked') ||
    !afterInteraction.payload.result.result.elements.some(item => item.value === 'OneWorks')
  ) throw new Error('Semantic interaction result did not persist.')
  const popupTarget = await ui.call('Target.createTarget', {
    url: `chrome-extension://${reconnected.connection.extension_id}/popup.html`
  })
  const popup = await pageCdp(chrome.port, '/popup.html')
  await waitFor(
    () => evaluate(popup, `document.querySelector('#state')?.textContent?.includes('Connected')`),
    'Extension popup did not show the active connection'
  )
  await evaluate(popup, `document.querySelector('#forget').click()`)
  await waitFor(
    () => evaluate(controlledPage, `!document.querySelector('#oneworks-external-browser-agent-cursor')`),
    'Page cursor did not fade out after the connection session was forgotten',
    5_000,
    25
  )
  popup.close()
  await ui.call('Target.closeTarget', { targetId: popupTarget.targetId }).catch(() => undefined)
  reconnected = await pairFromUi(ui, credentials, reconnected.connection.connection_id)
  check('cursor-session-persistence-and-disconnect-cleanup', {
    cursor_size_px: 28,
    previous_connection_id: autoReconnected.connection.connection_id,
    reconnected_connection_id: reconnected.connection.connection_id,
    tab_id: pageA.id
  })
  controlledPage.close()
  check('semantic-page-interaction', { tab_id: pageA.id, input_ref: inputRef, button_ref: buttonRef })
  if (demoMode) {
    await control(
      credentials,
      'tabs.update',
      { action: 'update', tab_id: pageA.id, active: true },
      2,
      `tab:${pageA.id}`
    )
    await demoPause(1_800)
  }
  const origin = `http://127.0.0.1:${fixturePort}`
  const rawResult = await confirmedControl(credentials, ui, 'raw.evaluate', {
    action: 'evaluate',
    tab_id: pageA.id,
    expected_origin: origin,
    expression:
      '({ token: localStorage.getItem("oneworks_e2e_token"), password: document.querySelector("input[type=password]").value })'
  }, `tab:${pageA.id}`)
  const rawValue = rawResult.payload.result.result.result.result.value
  if (rawValue?.token !== 'storage-secret' || rawValue?.password !== 'page-secret') {
    throw new Error(`Raw Runtime.evaluate did not return page secrets: ${JSON.stringify(rawResult.payload)}`)
  }
  const cookieResult = await confirmedControl(credentials, ui, 'cookies.list_with_values', {
    action: 'list_with_values',
    url: `${origin}/page-a`,
    name: 'oneworks_e2e_cookie',
    max_results: 10
  }, `origin:${origin}`)
  if (
    !cookieResult.payload.result.result.cookies.some(cookie =>
      cookie.name === 'oneworks_e2e_cookie' && cookie.value === 'cookie-secret'
    )
  ) throw new Error(`Complete cookie value was not returned: ${JSON.stringify(cookieResult.payload)}`)
  const sensitiveSnapshot = await confirmedControl(credentials, ui, 'page.snapshot_sensitive', {
    action: 'snapshot_sensitive',
    tab_id: pageA.id,
    frame_id: 0,
    document_id: pageDocumentId
  }, `tab:${pageA.id}`)
  const passwordRef = sensitiveSnapshot.payload.result.result.elements.find(item =>
    item.name === 'Evidence password' && item.value === 'page-secret'
  )?.ref
  if (!passwordRef) {
    throw new Error(
      `Sensitive snapshot did not return the page password value: ${JSON.stringify(sensitiveSnapshot.payload)}`
    )
  }
  await confirmedControl(credentials, ui, 'page.type_sensitive', {
    action: 'type_sensitive',
    tab_id: pageA.id,
    frame_id: 0,
    document_id: pageDocumentId,
    ref: passwordRef,
    text: 'typed-secret',
    clear: true
  }, `tab:${pageA.id}`)
  check('raw-cdp-cookie-and-sensitive-field-access', { tab_id: pageA.id, origin })
  const workflow = await runMcpWorkflow(pageA.id)
  check('mcp-workflow-request-ack-and-progressive-result', { run_id: workflow.run_id, step_ids: workflow.steps.ids })

  const childFrame = frames.payload.result.result.find(frame => frame.frame_id !== 0)
  if (childFrame == null) throw new Error('Cross-origin iframe was not discovered.')
  const frameSnapshot = await control(
    credentials,
    'page.snapshot',
    { action: 'snapshot', tab_id: frameHost.id, frame_id: childFrame.frame_id, document_id: childFrame.document_id },
    1,
    `tab:${frameHost.id}:frame:${childFrame.frame_id}:document:${childFrame.document_id}`
  )
  const frameButton = frameSnapshot.payload.result.result.elements.find(item => item.role === 'button')
  if (demoMode) {
    await control(
      credentials,
      'tabs.update',
      { action: 'update', tab_id: frameHost.id, active: true },
      2,
      `tab:${frameHost.id}`
    )
    await demoPause(700)
  }
  await control(
    credentials,
    'page.click',
    {
      action: 'click',
      tab_id: frameHost.id,
      frame_id: childFrame.frame_id,
      document_id: childFrame.document_id,
      ref: frameButton.ref
    },
    2,
    `tab:${frameHost.id}:frame:${childFrame.frame_id}:document:${childFrame.document_id}`
  )
  const restoredFrameHostTab = await waitFor(
    async () => {
      const tab = (await control(
        credentials,
        'tabs.get',
        { action: 'get', tab_id: frameHost.id },
        1,
        `tab:${frameHost.id}`
      )).payload.result.result
      return tab.fav_icon_url?.includes('default-tab-favicon.svg') ? tab : undefined
    },
    'Chrome tab UI did not restore the controlled default favicon after the iframe action',
    5_000,
    50
  )
  check('iframe-isolation-and-injection', {
    tab_id: frameHost.id,
    frame_id: childFrame.frame_id,
    document_id: childFrame.document_id,
    favicon_url: restoredFrameHostTab.fav_icon_url
  })
  if (demoMode) {
    await control(
      credentials,
      'tabs.update',
      { action: 'update', tab_id: frameHost.id, active: true },
      2,
      `tab:${frameHost.id}`
    )
    await demoPause(1_800)
  }

  const group = await control(
    credentials,
    'tabs.group',
    { action: 'group', tab_ids: [pageA.id, frameHost.id] },
    2,
    `tabs:${pageA.id},${frameHost.id}`
  )
  const groupId = group.payload.result.result.group_id
  await control(
    credentials,
    'groups.update',
    { action: 'update', group_id: groupId, title: 'OneWorks evidence', color: 'blue' },
    2,
    `group:${groupId}`
  )
  await control(
    credentials,
    'tabs.ungroup',
    { action: 'ungroup', tab_ids: [pageA.id, frameHost.id] },
    2,
    `tabs:${pageA.id},${frameHost.id}`
  )
  check('tab-group-control', { group_id: groupId })

  const bookmarkTitle = `OneWorks Chrome evidence ${Date.now()}`
  const createdBookmark = await control(
    credentials,
    'bookmarks.create',
    { action: 'create', title: bookmarkTitle, url: `http://127.0.0.1:${fixturePort}/page-a` },
    2,
    'bookmarks'
  )
  const bookmarkId = createdBookmark.payload.result.result.id
  const foundBookmark = await control(
    credentials,
    'bookmarks.search',
    { action: 'search', query: bookmarkTitle, max_results: 10 },
    1,
    'bookmarks'
  )
  if (!foundBookmark.payload.result.result.some(item => item.id === bookmarkId)) {
    throw new Error('Created bookmark was not found.')
  }
  let bookmarkEvidenceTab
  if (demoMode) {
    bookmarkEvidenceTab = (await control(
      credentials,
      'tabs.create',
      { action: 'create', url: `chrome://bookmarks/?q=${encodeURIComponent(bookmarkTitle)}`, active: true },
      2,
      'tabs'
    )).payload.result.result
    await demoPause(2_500)
  }
  const removalArgs = { action: 'remove', bookmark_id: bookmarkId, recursive: false }
  const gated = await control(credentials, 'bookmarks.remove', removalArgs, 3, `bookmark:${bookmarkId}`, true)
  if (gated.payload.error?.code !== 'CONFIRMATION_REQUIRED') {
    throw new Error('Bookmark removal did not require confirmation.')
  }
  if (demoMode) {
    await control(
      credentials,
      'tabs.update',
      { action: 'update', tab_id: reconnected.connection.oneworks_tab_id, active: true },
      2,
      `tab:${reconnected.connection.oneworks_tab_id}`
    )
    await revealConfirmationFromUi(ui, 'bookmarks.remove')
    await demoPause(2_500)
  }
  await approveFromUi(ui, gated.payload.error.confirmation_id, 'bookmarks.remove')
  await waitFor(async () => {
    const status = (await bridgeRequest(credentials, '/v1/status')).payload.result
    return status.pending_confirmations.every(item => item.confirmation_id !== gated.payload.error.confirmation_id)
  }, 'Confirmation was not approved')
  await control(credentials, 'bookmarks.remove', removalArgs, 3, `bookmark:${bookmarkId}`)
  const afterRemoval = await control(
    credentials,
    'bookmarks.search',
    { action: 'search', query: bookmarkTitle, max_results: 10 },
    1,
    'bookmarks'
  )
  if (afterRemoval.payload.result.result.some(item => item.id === bookmarkId)) {
    throw new Error('Bookmark cleanup failed.')
  }
  check('bookmark-create-verify-confirm-cleanup', {
    bookmark_id: bookmarkId,
    confirmation_id: gated.payload.error.confirmation_id,
    evidence_tab_id: bookmarkEvidenceTab?.id
  })
  if (bookmarkEvidenceTab != null) {
    await control(
      credentials,
      'tabs.update',
      { action: 'update', tab_id: bookmarkEvidenceTab.id, active: true },
      2,
      `tab:${bookmarkEvidenceTab.id}`
    )
  }
  await demoPause(2_500)

  await control(credentials, 'tabs.update', { action: 'update', tab_id: pageA.id, active: true }, 2, `tab:${pageA.id}`)
  const controlledTabIds = [pageA.id, frameHost.id, ...(bookmarkEvidenceTab == null ? [] : [bookmarkEvidenceTab.id])]
  for (
    const [op, args, targetKey] of [
      ['tabs.close', { action: 'close', tab_ids: controlledTabIds }, `tabs:${controlledTabIds.join(',')}`],
      ['windows.close', { action: 'close', window_id: windowCreated.id }, `window:${windowCreated.id}`]
    ]
  ) {
    const gatedClose = await control(credentials, op, args, 3, targetKey, true)
    if (gatedClose.payload.error?.code !== 'CONFIRMATION_REQUIRED') {
      throw new Error(`${op} did not require confirmation.`)
    }
    await approveFromUi(ui, gatedClose.payload.error.confirmation_id, op)
    await waitFor(
      async () =>
        (await bridgeRequest(credentials, '/v1/status')).payload.result.pending_confirmations.every(item =>
          item.confirmation_id !== gatedClose.payload.error.confirmation_id
        ),
      `${op} confirmation was not approved`
    )
    await control(credentials, op, args, 3, targetKey)
  }
  check('tab-switch-and-confirmed-cleanup')
  if (demoMode) {
    await control(
      credentials,
      'tabs.update',
      { action: 'update', tab_id: reconnected.connection.oneworks_tab_id, active: true },
      2,
      `tab:${reconnected.connection.oneworks_tab_id}`
    )
    await demoPause(2_500)
  }

  const finalStatus = (await bridgeRequest(credentials, '/v1/status')).payload.result
  await captureStoreAsset(ui, 'screenshot-audit.png', 'bottom')
  ui.close()
  evidence.completed_at = new Date().toISOString()
  evidence.connection = finalStatus.connection
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 })
  await chmod(evidencePath, 0o600)
  if (demoMode && demoRunCompletePath && demoDonePath) {
    await writeFile(demoRunCompletePath, `${new Date().toISOString()}\n`, { mode: 0o600 })
    await waitFor(
      () => access(demoDonePath).then(() => true),
      'Demo recorder did not finish before Chrome shutdown',
      360_000
    )
  }
  process.stdout.write(`${JSON.stringify({ evidence: evidencePath, output_root: outputRoot })}\n`)
}

try {
  await run()
} catch (error) {
  evidence.completed_at = new Date().toISOString()
  evidence.error = { message: error.message, stack: error.stack }
  await mkdir(dirname(evidencePath), { recursive: true }).catch(() => undefined)
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 }).catch(() => undefined)
  throw error
} finally {
  await stopChrome()
  if (fixtureServer != null) await new Promise(resolveClose => fixtureServer.close(resolveClose))
}
