package ai.oneworks.android.bridge

import ai.oneworks.android.accessibility.AccessibilityActions
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import org.json.JSONObject

class HostBridge(
    private val dispatcher: NativeEventDispatcher,
    private val targetWebViews: TargetWebViewManager,
    private val accessibilityActions: AccessibilityActions,
    private val deviceWorkspaces: DeviceWorkspaceController,
    private val systemAppearance: SystemAppearanceController
) {
    private val mainHandler = Handler(Looper.getMainLooper())

    @JavascriptInterface
    fun postMessage(rawMessage: String) {
        mainHandler.post { dispatchMessage(rawMessage) }
    }

    private fun dispatchMessage(rawMessage: String) {
        var requestId = ""
        runCatching {
            val message = JSONObject(rawMessage)
            requestId = BridgeJson.requireString(message, "id")
            val method = BridgeJson.requireString(message, "method")
            val params = BridgeJson.optionalObject(message, "params")
            val callback = callback(requestId)

            when (method) {
                "target.create" -> callback.resolve(targetWebViews.createTarget(params))
                "target.show" -> callback.resolve(targetWebViews.showTarget(params))
                "target.destroy" -> callback.resolve(targetWebViews.destroyTarget(params))
                "target.snapshot" -> callback.resolve(targetWebViews.snapshotTarget(params))
                "target.evaluate" -> targetWebViews.evaluate(params, callback)
                "target.inject" -> targetWebViews.inject(params, callback)
                "target.query" -> targetWebViews.query(params, callback)
                "target.click" -> targetWebViews.click(params, callback)
                "target.setValue" -> targetWebViews.setValue(params, callback)
                "accessibility.status" -> callback.resolve(accessibilityActions.status())
                "accessibility.openSettings" -> callback.resolve(accessibilityActions.openSettings())
                "accessibility.clickByText" -> callback.resolve(accessibilityActions.clickByText(params))
                "accessibility.setTextByText" -> callback.resolve(accessibilityActions.setTextByText(params))
                "accessibility.globalAction" -> callback.resolve(accessibilityActions.performGlobalAction(params))
                "device.getWorkspaceSelectorState" -> callback.resolve(deviceWorkspaces.getWorkspaceSelectorState())
                "device.listWorkspaceDirectories" -> callback.resolve(deviceWorkspaces.listWorkspaceDirectories(params))
                "device.chooseWorkspace" -> deviceWorkspaces.chooseWorkspace(callback)
                "device.openWorkspace" -> callback.resolve(deviceWorkspaces.openWorkspace(params))
                "device.forgetWorkspace" -> callback.resolve(deviceWorkspaces.forgetWorkspace(params))
                "device.stopWorkspace" -> callback.resolve(deviceWorkspaces.stopWorkspace(params))
                "system.setAppearance" -> callback.resolve(systemAppearance.setAppearance(params))
                else -> callback.reject("unknown_method", "Unknown bridge method: $method")
            }
        }.onFailure { error ->
            if (requestId.isNotEmpty()) {
                dispatcher.reject(requestId, "bridge_dispatch_error", error.message)
            }
        }
    }

    private fun callback(requestId: String) = object : BridgeCallback {
        override fun resolve(result: Any?) {
            dispatcher.resolve(requestId, result)
        }

        override fun reject(code: String, message: String?) {
            dispatcher.reject(requestId, code, message)
        }
    }
}
