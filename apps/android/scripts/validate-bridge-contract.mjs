import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const readText = path => readFileSync(join(root, path), 'utf8')
const fail = message => {
  throw new Error(`[android-bridge-contract] ${message}`)
}

const contract = JSON.parse(readText('app/src/main/assets/bridge/contract.json'))
if (contract.version !== 1) fail('contract version must be 1')
if (!Array.isArray(contract.commands) || contract.commands.length === 0) {
  fail('commands must be a non-empty array')
}
if (!Array.isArray(contract.events) || contract.events.length === 0) {
  fail('events must be a non-empty array')
}

const hostBridge = readText('app/src/main/kotlin/ai/oneworks/android/bridge/HostBridge.kt')
for (const command of contract.commands) {
  if (!hostBridge.includes(`"${command}"`)) {
    fail(`HostBridge does not dispatch command ${command}`)
  }
}

const dispatcher = readText('app/src/main/kotlin/ai/oneworks/android/bridge/NativeEventDispatcher.kt')
if (!dispatcher.includes('"bridge.response"')) {
  fail('NativeEventDispatcher must emit bridge.response')
}

const targetManager = readText('app/src/main/kotlin/ai/oneworks/android/bridge/TargetWebViewManager.kt')
const bundledAssetLoader = readText('app/src/main/kotlin/ai/oneworks/android/bridge/BundledAssetLoader.kt')
const androidLocalBackend = readText('app/src/main/kotlin/ai/oneworks/android/bridge/AndroidLocalBackend.kt')
const mainActivity = readText('app/src/main/kotlin/ai/oneworks/android/MainActivity.kt')
const systemAppearance = readText('app/src/main/kotlin/ai/oneworks/android/bridge/SystemAppearanceController.kt')
const deviceWorkspaceController = readText(
  'app/src/main/kotlin/ai/oneworks/android/bridge/DeviceWorkspaceController.kt'
)
const targetJavascriptBridge = readText('app/src/main/kotlin/ai/oneworks/android/bridge/TargetJavascriptBridge.kt')
const targetProbe = readText('app/src/main/kotlin/ai/oneworks/android/bridge/WebViewBridgeScripts.kt')
const eventSources = [dispatcher, targetManager, targetJavascriptBridge, deviceWorkspaceController]
for (const event of contract.events) {
  if (!eventSources.some(source => source.includes(`"${event}"`))) {
    fail(`No native source emits event ${event}`)
  }
}
if (!targetProbe.includes('window.OneWorksTarget.postMessage')) {
  fail('target probe must post DOM events through OneWorksTarget')
}
if (!targetProbe.includes('document.addEventListener(type, handleDomEvent, true)')) {
  fail('target probe must install capture-phase DOM listeners')
}

const manifest = readText('app/src/main/AndroidManifest.xml')
if (!manifest.includes('android.accessibilityservice.AccessibilityService')) {
  fail('manifest must register the accessibility service')
}
if (!manifest.includes('android.permission.MANAGE_EXTERNAL_STORAGE')) {
  fail('manifest must declare all-files access for Android workspace file validation')
}

const hostPage = readText('app/src/main/assets/host/index.html')
for (
  const command of [
    'target.create',
    'target.query',
    'target.click',
    'target.setValue',
    'target.evaluate',
    'accessibility.status',
    'accessibility.openSettings'
  ]
) {
  if (!hostPage.includes(command)) {
    fail(`host demo does not exercise ${command}`)
  }
}
if (!hostPage.includes('https://oneworks.local/client/')) {
  fail('host demo must be able to open the bundled client asset origin')
}

const appBuild = readText('app/build.gradle.kts')
if (!appBuild.includes('../client/dist') || !appBuild.includes('../server')) {
  fail('Android Gradle build must sync client/server assets')
}
if (!appBuild.includes('into("source")') || !appBuild.includes('into("dist")')) {
  fail('Android Gradle build must package server source and optional dist assets')
}
if (!bundledAssetLoader.includes('oneworks.local') || !bundledAssetLoader.includes('oneworksAndroidBridge')) {
  fail('BundledAssetLoader must serve assets through the local HTTPS origin and inject the web bridge helper')
}
if (!bundledAssetLoader.includes('oneworksDeviceShell') || !bundledAssetLoader.includes('device.chooseWorkspace')) {
  fail('BundledAssetLoader must inject the common device shell workspace bridge')
}
if (!bundledAssetLoader.includes('listCloneDestinationDirectories')) {
  fail('BundledAssetLoader must map the common launcher directory list API to Android')
}
if (
  !bundledAssetLoader.includes('getWorkspaceConnection') || !bundledAssetLoader.includes("location.assign('/client/')")
) {
  fail('BundledAssetLoader must let Android project opening enter the workspace client')
}
if (
  !bundledAssetLoader.includes('__ONEWORKS_PROJECT_SERVER_BASE_URL__') || !bundledAssetLoader.includes('oneworks.local')
) {
  fail('BundledAssetLoader must point Android workspace clients at the local backend origin')
}
if (
  !bundledAssetLoader.includes('system.setAppearance') || !bundledAssetLoader.includes("classList.contains('dark')")
) {
  fail('BundledAssetLoader must sync native appearance from the bundled client theme')
}
if (!deviceWorkspaceController.includes('Intent.ACTION_OPEN_DOCUMENT_TREE')) {
  fail('DeviceWorkspaceController must use the Android directory picker for workspace selection')
}
if (!deviceWorkspaceController.includes('listWorkspaceDirectories')) {
  fail('DeviceWorkspaceController must implement internal launcher directory listing')
}
if (!deviceWorkspaceController.includes('PREFS_ACTIVE_WORKSPACE')) {
  fail('DeviceWorkspaceController must persist the active Android workspace')
}
if (
  !androidLocalBackend.includes('/api/auth/status') ||
  !androidLocalBackend.includes('/api/workspace/tree') ||
  !androidLocalBackend.includes('getActiveWorkspace')
) {
  fail('AndroidLocalBackend must provide the minimal in-emulator workspace API surface')
}
if (!systemAppearance.includes('APPEARANCE_LIGHT_STATUS_BARS') || !systemAppearance.includes('navigationBarColor')) {
  fail('SystemAppearanceController must update status/navigation bar appearance')
}
if (!targetManager.includes('assetLoader.shouldInterceptRequest')) {
  fail('TargetWebViewManager must serve bundled assets through BundledAssetLoader')
}
if (
  !mainActivity.includes('BundledAssetLoader.CLIENT_ENTRY_URL') ||
  !mainActivity.includes('BundledAssetLoader.DEMO_HOST_URL') ||
  !mainActivity.includes('AndroidLocalBackend(deviceWorkspaces)')
) {
  fail('MainActivity must load bundled OneWorks client as the host WebView with a demo fallback and local backend')
}

console.log(`[android-bridge-contract] ok: ${contract.commands.length} commands, ${contract.events.length} events`)
