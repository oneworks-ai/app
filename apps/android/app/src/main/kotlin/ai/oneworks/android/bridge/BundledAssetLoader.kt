package ai.oneworks.android.bridge

import android.content.Context
import android.webkit.ServiceWorkerClient
import android.webkit.ServiceWorkerController
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import java.io.FileNotFoundException
import java.io.IOException
import java.nio.charset.StandardCharsets

class BundledAssetLoader(private val context: Context) {
    companion object {
        private const val ASSET_HOST = "oneworks.local"
        private const val CLIENT_INDEX_PATH = "client/index.html"
        const val CLIENT_ENTRY_URL = "https://oneworks.local/client/launcher"
        const val DEMO_HOST_URL = "file:///android_asset/host/index.html"
    }

    var localBackend: AndroidLocalBackend? = null

    private val bundledClientRuntimeScript = """
        <script>
        ;(() => {
          const androidServerBaseUrl = 'https://oneworks.local';
          const activeWorkspaceStorageKey = 'oneworks_android_active_workspace';
          const parseStoredWorkspace = value => {
            if (typeof value !== 'string' || value.trim() === '') return undefined;
            try {
              const parsed = JSON.parse(value);
              return parsed == null || typeof parsed !== 'object' ? undefined : parsed;
            } catch {
              return undefined;
            }
          };
          const readActiveWorkspace = () => {
            try {
              return parseStoredWorkspace(sessionStorage.getItem(activeWorkspaceStorageKey)) ||
                parseStoredWorkspace(localStorage.getItem(activeWorkspaceStorageKey));
            } catch {
              return undefined;
            }
          };
          const writeActiveWorkspace = workspace => {
            if (workspace == null || typeof workspace !== 'object') return;
            const serialized = JSON.stringify(workspace);
            try {
              sessionStorage.setItem(activeWorkspaceStorageKey, serialized);
              localStorage.setItem(activeWorkspaceStorageKey, serialized);
            } catch {}
          };
          const clearActiveWorkspace = () => {
            try {
              sessionStorage.removeItem(activeWorkspaceStorageKey);
              localStorage.removeItem(activeWorkspaceStorageKey);
            } catch {}
          };
          const normalizeWorkspaceSelection = value => {
            if (value == null || typeof value !== 'object') return undefined;
            const workspaceFolder = String(value.workspaceFolder || '').trim();
            if (workspaceFolder === '') return undefined;
            return {
              ...value,
              workspaceFolder
            };
          };
          const isLauncherPath = () =>
            location.pathname.replace(/\/+$/u, '').endsWith('/launcher');
          const activeWorkspace = normalizeWorkspaceSelection(readActiveWorkspace());
          const isWorkspacePage = activeWorkspace != null && !isLauncherPath();
          globalThis.__ONEWORKS_PROJECT_RUNTIME_ENV__ = {
            ...(globalThis.__ONEWORKS_PROJECT_RUNTIME_ENV__ || {}),
            __ONEWORKS_PROJECT_CLIENT_BASE__: '/client',
            __ONEWORKS_PROJECT_SERVER_BASE_URL__: androidServerBaseUrl,
            ...(isWorkspacePage
              ? {
                __ONEWORKS_PROJECT_CLIENT_MODE__: 'desktop',
                __ONEWORKS_PROJECT_SERVER_ROLE__: 'workspace',
                __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: activeWorkspace.workspaceFolder,
                ...(typeof activeWorkspace.workspaceId === 'string'
                  ? { __ONEWORKS_PROJECT_WORKSPACE_ID__: activeWorkspace.workspaceId }
                  : {})
              }
              : {
                __ONEWORKS_PROJECT_CLIENT_MODE__: 'standalone',
                __ONEWORKS_PROJECT_SERVER_ROLE__: 'manager'
              })
          };

          const diagnostics = globalThis.__ONEWORKS_ANDROID_CLIENT_DIAGNOSTICS__ = {
            errors: []
          };
          addEventListener('error', event => diagnostics.errors.push({
            type: 'error',
            message: String(event.message || ''),
            source: String(event.filename || ''),
            line: event.lineno || 0,
            column: event.colno || 0
          }));
          addEventListener('unhandledrejection', event => diagnostics.errors.push({
            type: 'unhandledrejection',
            message: String(event.reason?.message || event.reason || '')
          }));

          const pendingRequests = new Map();
          const workspaceSelectorListeners = new Set();
          let requestIndex = 1;
          const emitWorkspaceSelectorState = value => {
            for (const listener of Array.from(workspaceSelectorListeners)) {
              try {
                listener(value);
              } catch (error) {
                setTimeout(() => { throw error; }, 0);
              }
            }
          };
          const previousDispatch = globalThis.__oneworksNativeBridgeDispatch;
          globalThis.__oneworksNativeBridgeDispatch = envelope => {
            if (typeof previousDispatch === 'function') {
              previousDispatch(envelope);
            }
            dispatchEvent(new CustomEvent('oneworks:android-bridge-event', { detail: envelope }));
            if (envelope?.type === 'device.workspaceSelectorStateChange') {
              emitWorkspaceSelectorState(envelope.payload);
              return;
            }
            if (envelope?.type !== 'bridge.response') return;
            const request = pendingRequests.get(envelope.payload?.id);
            if (!request) return;
            pendingRequests.delete(envelope.payload.id);
            if (envelope.payload.ok) {
              request.resolve(envelope.payload.result);
            } else {
              request.reject(envelope.payload.error);
            }
          };

          globalThis.oneworksAndroidBridge = {
            available: () => typeof globalThis.OneWorksAndroidBridge?.postMessage === 'function',
            request: (method, params = {}) => new Promise((resolve, reject) => {
              if (typeof globalThis.OneWorksAndroidBridge?.postMessage !== 'function') {
                reject({ code: 'bridge_unavailable', message: 'OneWorks Android bridge is unavailable.' });
                return;
              }
              const id = `client-${'$'}{Date.now()}-${'$'}{requestIndex++}`;
              pendingRequests.set(id, { resolve, reject });
              globalThis.OneWorksAndroidBridge.postMessage(JSON.stringify({ id, method, params }));
            })
          };

          const androidDeviceShell = {
            shellKind: 'android',
            platform: 'android',
            supportsWebviewTag: false,
            systemLocale: navigator.language,
            chooseWorkspace: async () => {
              const selection = normalizeWorkspaceSelection(
                await globalThis.oneworksAndroidBridge.request('device.chooseWorkspace')
              );
              return selection?.workspaceFolder;
            },
            getWorkspaceConnection: async () => {
              const workspace = normalizeWorkspaceSelection(readActiveWorkspace());
              if (workspace == null) return undefined;
              return {
                serverBaseUrl: androidServerBaseUrl,
                workspaceFolder: workspace.workspaceFolder,
                ...(typeof workspace.workspaceId === 'string' ? { workspaceId: workspace.workspaceId } : {})
              };
            },
            getWorkspaceSelectorState: () =>
              globalThis.oneworksAndroidBridge.request('device.getWorkspaceSelectorState'),
            listCloneDestinationDirectories: directory =>
              globalThis.oneworksAndroidBridge.request('device.listWorkspaceDirectories', { directory }),
            onWorkspaceSelectorStateChange: listener => {
              workspaceSelectorListeners.add(listener);
              return () => workspaceSelectorListeners.delete(listener);
            },
            openWorkspace: async workspaceFolder => {
              const workspace = normalizeWorkspaceSelection(
                await globalThis.oneworksAndroidBridge.request('device.openWorkspace', { workspaceFolder })
              );
              if (workspace == null) return;
              writeActiveWorkspace(workspace);
              location.assign('/client/');
            },
            forgetWorkspace: async workspaceFolder => {
              await globalThis.oneworksAndroidBridge.request('device.forgetWorkspace', { workspaceFolder });
              const active = normalizeWorkspaceSelection(readActiveWorkspace());
              if (active?.workspaceFolder === workspaceFolder) {
                clearActiveWorkspace();
              }
            },
            stopWorkspace: async (workspaceFolder, input = {}) =>
              globalThis.oneworksAndroidBridge.request('device.stopWorkspace', {
                workspaceFolder,
                forget: input?.forget === true
              }).then(() => {
                if (input?.forget === true) {
                  const active = normalizeWorkspaceSelection(readActiveWorkspace());
                  if (active?.workspaceFolder === workspaceFolder) {
                    clearActiveWorkspace();
                  }
                }
                return undefined;
              })
          };
          globalThis.oneworksDeviceShell = androidDeviceShell;
          if (globalThis.oneworksDesktop == null) {
            globalThis.oneworksDesktop = androidDeviceShell;
          }

          const resolveAndroidTheme = () => {
            if (document.documentElement.classList.contains('dark')) return 'dark';
            let storedTheme = '';
            try {
              storedTheme = String(localStorage.getItem('theme') || '').trim().toLowerCase();
            } catch {}
            if (storedTheme === 'dark' || storedTheme === 'light') return storedTheme;
            return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
          };

          let lastAndroidTheme = '';
          const syncAndroidAppearance = () => {
            const theme = resolveAndroidTheme();
            if (theme === lastAndroidTheme) return;
            lastAndroidTheme = theme;
            void globalThis.oneworksAndroidBridge
              .request('system.setAppearance', { theme })
              .catch(error => diagnostics.errors.push({
                type: 'android-appearance-sync',
                message: String(error?.message || error)
              }));
          };

          new MutationObserver(syncAndroidAppearance).observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['class']
          });
          globalThis.matchMedia?.('(prefers-color-scheme: dark)')
            .addEventListener?.('change', syncAndroidAppearance);
          syncAndroidAppearance();
          addEventListener('DOMContentLoaded', syncAndroidAppearance, { once: true });
          setTimeout(syncAndroidAppearance, 250);
          setTimeout(syncAndroidAppearance, 1000);
        })();
        </script>
    """.trimIndent()

    fun hasBundledClient(): Boolean = CLIENT_INDEX_PATH.assetExists()

    fun installServiceWorkerClient() {
        ServiceWorkerController.getInstance().setServiceWorkerClient(
            object : ServiceWorkerClient() {
                override fun shouldInterceptRequest(request: WebResourceRequest): WebResourceResponse? =
                    this@BundledAssetLoader.shouldInterceptRequest(request)
            }
        )
    }

    fun shouldInterceptRequest(request: WebResourceRequest): WebResourceResponse? =
        localBackend?.shouldInterceptRequest(request) ?: request.url.toString().toBundledAssetResponse()

    private fun String.toBundledAssetResponse(): WebResourceResponse? {
        val prefix = "https://$ASSET_HOST/"
        if (!startsWith(prefix)) return null
        val rawAssetPath = removePrefix(prefix).substringBefore('?').substringBefore('#')
        val assetPath = rawAssetPath.toAssetPath()
        if (!assetPath.isAllowedBundledAssetPath()) return null

        val responsePath = findBundledAssetPath(assetPath) ?: return null
        return try {
            val body = if (responsePath == CLIENT_INDEX_PATH) {
                context.assets.open(responsePath).use { stream ->
                    stream.readBytes()
                        .toString(StandardCharsets.UTF_8)
                        .replace("<head>", "<head>\n$bundledClientRuntimeScript", ignoreCase = true)
                        .toByteArray(StandardCharsets.UTF_8)
                }.inputStream()
            } else {
                context.assets.open(responsePath)
            }
            WebResourceResponse(responsePath.toMimeType(), responsePath.toCharsetName(), body).apply {
                responseHeaders = mapOf(
                    "Access-Control-Allow-Origin" to "https://$ASSET_HOST",
                    "Cache-Control" to "no-cache"
                )
            }
        } catch (_: IOException) {
            null
        }
    }

    private fun String.toAssetPath(): String =
        if (endsWith("/")) "${this}index.html" else this

    private fun String.isAllowedBundledAssetPath(): Boolean =
        startsWith("client/") || startsWith("server/")

    private fun findBundledAssetPath(assetPath: String): String? {
        if (assetPath.assetExists()) return assetPath
        val lastSegment = assetPath.substringAfterLast('/')
        val isClientSpaRoute = assetPath.startsWith("client/") && !lastSegment.contains('.')
        return if (isClientSpaRoute && CLIENT_INDEX_PATH.assetExists()) {
            CLIENT_INDEX_PATH
        } else {
            null
        }
    }

    private fun String.assetExists(): Boolean =
        try {
            context.assets.open(this).close()
            true
        } catch (_: FileNotFoundException) {
            false
        } catch (_: IOException) {
            false
        }

    private fun String.toMimeType(): String = when (substringAfterLast('.', "").lowercase()) {
        "css" -> "text/css"
        "eot" -> "application/vnd.ms-fontobject"
        "html" -> "text/html"
        "ico" -> "image/x-icon"
        "jpeg", "jpg" -> "image/jpeg"
        "js", "mjs" -> "application/javascript"
        "json" -> "application/json"
        "png" -> "image/png"
        "svg" -> "image/svg+xml"
        "ttf" -> "font/ttf"
        "wasm" -> "application/wasm"
        "webmanifest" -> "application/manifest+json"
        "woff" -> "font/woff"
        "woff2" -> "font/woff2"
        else -> "application/octet-stream"
    }

    private fun String.toCharsetName(): String? =
        when (toMimeType()) {
            "application/javascript",
            "application/json",
            "application/manifest+json",
            "image/svg+xml",
            "text/css",
            "text/html" -> "UTF-8"
            else -> null
        }
}
